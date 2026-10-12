package app.spotless.android.ui

import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import app.spotless.android.BuildConfig
import app.spotless.android.bridge.BridgeCommand
import app.spotless.android.bridge.BridgeEvent
import app.spotless.android.bridge.BridgeJson
import app.spotless.android.playback.PlaybackService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Relays between the page and the playback service. The page's `SpotlessNative` object only exists for the
 * configured server origin and only main-frame messages are accepted. `hello` and `changeServer` are
 * answered here; everything else goes to the service as a session custom command, and service events come
 * back the same way.
 */
@UnstableApi
class WebBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val origin: String,
) {
    private var reply: JavaScriptReplyProxy? = null
    private var controller: MediaController? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private val pending = ArrayDeque<String>()
    private val command = SessionCommand(BridgeJson.CMD, Bundle.EMPTY)

    /** False when this WebView is too old for origin-locked messaging; the page then plays by itself. */
    fun install(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        WebViewCompat.addWebMessageListener(webView, "SpotlessNative", setOf(origin)) { _, message: WebMessageCompat, _: Uri, isMainFrame, replyProxy ->
            if (!isMainFrame) return@addWebMessageListener
            reply = replyProxy
            message.data?.let(::onMessage)
        }
        connect()
        return true
    }

    private fun onMessage(text: String) {
        when (BridgeJson.parseCommand(text)) {
            null -> Unit
            BridgeCommand.Hello -> send(
                BridgeJson.encode(BridgeEvent.Hello(BridgeJson.VERSION, BuildConfig.VERSION_NAME, listOf("eq", "quality", "sleep", "speak"))),
            )
            BridgeCommand.ChangeServer -> activity.showSetup()
            else -> forward(text)
        }
    }

    private fun forward(text: String) {
        val c = controller
        if (c == null) pending += text else c.sendCustomCommand(command, bundleOf(BridgeJson.KEY to text))
    }

    private fun send(json: String) {
        reply?.postMessage(json)
    }

    private fun connect() {
        val token = SessionToken(activity, ComponentName(activity, PlaybackService::class.java))
        val future = MediaController.Builder(activity, token)
            .setListener(object : MediaController.Listener {
                override fun onCustomCommand(
                    controller: MediaController,
                    command: SessionCommand,
                    args: Bundle,
                ): ListenableFuture<SessionResult> {
                    if (command.customAction == BridgeJson.EVT) {
                        args.getString(BridgeJson.KEY)?.let { json ->
                            send(json)
                            if (json == BridgeJson.encode(BridgeEvent.AuthLost)) activity.onAuthLost()
                        }
                    }
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
            })
            .buildAsync()
        controllerFuture = future
        future.addListener({
            controller = runCatching { future.get() }.getOrNull()
            while (pending.isNotEmpty()) forward(pending.removeFirst())
        }, ContextCompat.getMainExecutor(activity))
    }

    /** Stop and forget the queue (switching servers). */
    fun stopPlayback() {
        controller?.run {
            stop()
            clearMediaItems()
        }
    }

    fun release() {
        WebViewCompat.removeWebMessageListener(webView, "SpotlessNative")
        controllerFuture?.let(MediaController::releaseFuture)
        controller = null
        reply = null
    }
}
