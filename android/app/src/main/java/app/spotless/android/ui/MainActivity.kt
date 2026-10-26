package app.spotless.android.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.ComponentName
import android.os.Bundle
import android.view.KeyEvent
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import app.spotless.android.bridge.BridgeEvent
import app.spotless.android.bridge.BridgeJson
import app.spotless.android.graph
import app.spotless.android.net.Health
import app.spotless.android.net.ServerAddress
import app.spotless.android.playback.PlaybackService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

@UnstableApi
class MainActivity : ComponentActivity() {
    private sealed interface Screen {
        data object Loading : Screen
        data class Setup(val initial: String?, val error: String?, val checking: Boolean) : Screen
        data class Web(val origin: String) : Screen
        data class Unreachable(val origin: String, val message: String) : Screen
    }

    private var screen by mutableStateOf<Screen>(Screen.Loading)
    private var webView: WebView? = null
    private var bridge: WebBridge? = null
    private var pendingMic: PermissionRequest? = null
    private var authReloadPending = false
    private var checkJob: Job? = null

    // One controller for the activity's lifetime. Page commands that arrive before it connects wait in
    // pendingCommands and are flushed once; if the connection fails they are dropped (the page plays by itself).
    private var controller: MediaController? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controllerSettled = false
    private val pendingCommands = ArrayDeque<String>()
    private val settleWaiters = ArrayList<(Boolean) -> Unit>()
    private val serviceCommand = SessionCommand(BridgeJson.CMD, Bundle.EMPTY)

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingMic?.let { if (granted) it.grant(it.resources) else it.deny() }
        pendingMic = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        connectController()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                when (val s = screen) {
                    Screen.Loading -> Unit
                    is Screen.Setup -> SetupScreen(s.initial, s.error, s.checking) { input -> connect(input) }
                    // keyed on the instance: a new WebView (after Retry or a server change) gets a fresh AndroidView
                    is Screen.Web -> webView?.let { view ->
                        key(view) {
                            AndroidView(
                                factory = { view },
                                modifier = Modifier.fillMaxSize().safeDrawingPadding(),
                                // focused from the start, so the remote's D-pad reaches the page
                                update = { if (!it.hasFocus()) it.requestFocus() },
                            )
                        }
                    }
                    is Screen.Unreachable -> UnreachableScreen(s.origin, s.message, onRetry = { start(s.origin) }, onChangeServer = ::showSetup)
                }
            }
        }
        onBackPressedDispatcher.addCallback(this) {
            val view = webView
            if (screen !is Screen.Web || view == null) {
                moveTaskToBack(true)
                return@addCallback
            }
            // the page closes its newest open menu or dialog first; only then does back leave the page
            view.evaluateJavascript("window.__spotlessBack ? window.__spotlessBack() : false") { handled ->
                if (handled == "true" || view !== webView) return@evaluateJavascript
                if (view.canGoBack()) view.goBack() else moveTaskToBack(true)
            }
        }
        if (intent?.action == ACTION_CHANGE_SERVER) showSetup() else start(graph.origin)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_CHANGE_SERVER) showSetup()
    }

    private fun start(origin: String?) {
        if (origin == null) {
            showSetup()
            return
        }
        screen = Screen.Loading
        checkJob?.cancel()
        checkJob = lifecycleScope.launch {
            when (val health = graph.api.health(origin)) {
                is Health.Ok -> openWeb(origin)
                is Health.Problem -> screen = Screen.Unreachable(origin, health.message)
            }
        }
    }

    private fun connect(input: String) {
        val origin = ServerAddress.normalize(input)
        if (origin == null) {
            screen = Screen.Setup(input, "Enter a server address like nas:4000 or http://192.168.1.10:3000.", false)
            return
        }
        screen = Screen.Setup(input, null, true)
        checkJob?.cancel()
        checkJob = lifecycleScope.launch {
            when (val health = graph.api.health(origin)) {
                is Health.Ok -> {
                    if (origin != graph.origin) stopPlayback()
                    graph.setOrigin(origin)
                    openWeb(origin)
                }
                is Health.Problem -> screen = Screen.Setup(input, health.message, false)
            }
        }
    }

    fun showSetup() {
        // a late health result must not overwrite the setup screen (openWeb's own teardown runs inside that job, so it does not cancel)
        checkJob?.cancel()
        checkJob = null
        teardownWeb()
        screen = Screen.Setup(graph.origin, null, false)
    }

    /**
     * The server said the session is gone: load the server again, which lands on its sign-in page. Every 401
     * reports this (artwork too), so one reload is enough until that page has finished loading; more would wipe
     * what the user is typing into the sign-in form.
     */
    fun onAuthLost() {
        val origin = (screen as? Screen.Web)?.origin ?: return
        if (authReloadPending) return
        authReloadPending = true
        webView?.loadUrl(origin)
    }

    private fun openWeb(origin: String) {
        teardownWeb()
        val view = WebHost.create(
            activity = this,
            origin = origin,
            // don't destroy the WebView from inside its own callback; Retry's openWeb tears it down
            onMainFrameError = { message ->
                authReloadPending = false
                screen = Screen.Unreachable(origin, message)
            },
            onPageFinished = { authReloadPending = false },
            onMicrophoneRequest = ::onMicrophoneRequest,
            onMicrophoneCanceled = { request -> if (pendingMic === request) pendingMic = null },
        )
        view.setOnKeyListener { _, _, event -> onMediaKey(event) }
        bridge = WebBridge(this, view, origin).also { it.install() }
        webView = view
        view.loadUrl(origin)
        screen = Screen.Web(origin)
    }

    private fun teardownWeb() {
        authReloadPending = false
        bridge?.release()
        bridge = null
        pendingMic?.deny()
        pendingMic = null
        webView?.let { view ->
            // still attached to the Compose AndroidView: detach before destroying
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        webView = null
    }

    /**
     * A TV remote's media keys go straight to the player, before the WebView can swallow them. Down does the work
     * and the matching up is consumed with it.
     */
    private fun onMediaKey(event: KeyEvent): Boolean {
        val c = controller
        if (c == null || event.keyCode !in MEDIA_KEYS) return false
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK -> if (c.isPlaying) c.pause() else c.play()
                KeyEvent.KEYCODE_MEDIA_PLAY -> c.play()
                KeyEvent.KEYCODE_MEDIA_PAUSE -> c.pause()
                KeyEvent.KEYCODE_MEDIA_NEXT -> if (event.repeatCount == 0) c.seekToNext()
                KeyEvent.KEYCODE_MEDIA_PREVIOUS -> if (event.repeatCount == 0) c.seekToPrevious()
                KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> c.seekTo((c.currentPosition + SEEK_STEP_MS).coerceAtMost(c.duration.coerceAtLeast(0)))
                KeyEvent.KEYCODE_MEDIA_REWIND -> c.seekTo((c.currentPosition - SEEK_STEP_MS).coerceAtLeast(0))
            }
        }
        return true
    }

    /** A page command for the playback service; queued until the controller connects, dropped if it never does. */
    fun relayToService(json: String) {
        val c = controller
        when {
            c != null -> c.sendCustomCommand(serviceCommand, bundleOf(BridgeJson.KEY to json))
            !controllerSettled -> pendingCommands += json
        }
    }

    /** Runs [block] with whether the controller connected, immediately if the connection already settled. */
    fun whenControllerSettled(block: (Boolean) -> Unit) {
        if (controllerSettled) block(controller != null) else settleWaiters += block
    }

    /** Stop and forget the queue (switching servers). */
    private fun stopPlayback() {
        pendingCommands.clear()
        controller?.run {
            stop()
            clearMediaItems()
        }
    }

    private fun connectController() {
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        val future = MediaController.Builder(this, token)
            .setListener(object : MediaController.Listener {
                override fun onCustomCommand(
                    controller: MediaController,
                    command: SessionCommand,
                    args: Bundle,
                ): ListenableFuture<SessionResult> {
                    if (command.customAction == BridgeJson.EVT) args.getString(BridgeJson.KEY)?.let(::onServiceEvent)
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
            })
            .buildAsync()
        controllerFuture = future
        future.addListener({
            controllerSettled = true
            val connected = runCatching { future.get() }.getOrNull()
            controller = connected
            val queued = pendingCommands.toList()
            pendingCommands.clear()
            if (connected != null) queued.forEach { connected.sendCustomCommand(serviceCommand, bundleOf(BridgeJson.KEY to it)) }
            val waiters = settleWaiters.toList()
            settleWaiters.clear()
            waiters.forEach { it(connected != null) }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun onServiceEvent(json: String) {
        bridge?.send(json)
        val event = runCatching { BridgeJson.json.decodeFromString(BridgeEvent.serializer(), json) }.getOrNull()
        if (event == BridgeEvent.AuthLost) onAuthLost()
    }

    private fun onMicrophoneRequest(request: PermissionRequest) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(request.resources)
        } else {
            pendingMic?.deny()
            pendingMic = request
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    override fun onDestroy() {
        teardownWeb()
        controllerFuture?.let(MediaController::releaseFuture)
        controllerFuture = null
        controller = null
        pendingCommands.clear()
        settleWaiters.clear()
        super.onDestroy()
    }

    companion object {
        const val ACTION_CHANGE_SERVER = "app.spotless.android.CHANGE_SERVER"
        private const val SEEK_STEP_MS = 10_000L
        private val MEDIA_KEYS = setOf(
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_HEADSETHOOK,
            KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PAUSE,
            KeyEvent.KEYCODE_MEDIA_NEXT,
            KeyEvent.KEYCODE_MEDIA_PREVIOUS,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
            KeyEvent.KEYCODE_MEDIA_REWIND,
        )
    }
}
