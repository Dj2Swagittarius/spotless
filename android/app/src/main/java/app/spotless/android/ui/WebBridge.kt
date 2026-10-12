package app.spotless.android.ui

import android.net.Uri
import android.webkit.WebView
import androidx.media3.common.util.UnstableApi
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import app.spotless.android.BuildConfig
import app.spotless.android.bridge.BridgeCommand
import app.spotless.android.bridge.BridgeEvent
import app.spotless.android.bridge.BridgeJson

/**
 * Relays between the page and the playback service. The page's `SpotlessNative` object only exists for the
 * configured server origin and only main-frame messages are accepted. `hello` (once the controller has
 * connected) and `changeServer` are answered here; everything else goes to the activity's controller (a session custom command), and service
 * events come back through [send].
 */
@UnstableApi
class WebBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val origin: String,
) {
    private var reply: JavaScriptReplyProxy? = null
    private var installed = false

    /** False when this WebView is too old for origin-locked messaging; the page then plays by itself. */
    fun install(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        WebViewCompat.addWebMessageListener(webView, "SpotlessNative", setOf(origin)) { _, message: WebMessageCompat, _: Uri, isMainFrame, replyProxy ->
            if (!isMainFrame) return@addWebMessageListener
            reply = replyProxy
            message.data?.let(::onMessage)
        }
        installed = true
        return true
    }

    private fun onMessage(text: String) {
        when (BridgeJson.parseCommand(text)) {
            null -> Unit
            // Answer once the activity's controller has connected: the page drops its own <audio> on a version match,
            // so an app whose playback service is unreachable must say version 0 and leave the page to play itself.
            BridgeCommand.Hello -> activity.whenControllerSettled { connected ->
                val version = if (connected) BridgeJson.VERSION else 0
                send(BridgeJson.encode(BridgeEvent.Hello(version, BuildConfig.VERSION_NAME, listOf("eq", "quality", "sleep", "speak"))))
            }
            BridgeCommand.ChangeServer -> activity.showSetup()
            else -> activity.relayToService(text)
        }
    }

    /** Service events travel to the page over the reply proxy of the last page message. */
    fun send(json: String) {
        reply?.postMessage(json)
    }

    fun release() {
        if (installed) WebViewCompat.removeWebMessageListener(webView, "SpotlessNative")
        installed = false
        reply = null
    }
}
