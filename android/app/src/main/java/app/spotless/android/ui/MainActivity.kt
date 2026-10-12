package app.spotless.android.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import app.spotless.android.graph
import app.spotless.android.net.Health
import app.spotless.android.net.ServerAddress
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

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingMic?.let { if (granted) it.grant(it.resources) else it.deny() }
        pendingMic = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                when (val s = screen) {
                    Screen.Loading -> Unit
                    is Screen.Setup -> SetupScreen(s.initial, s.error, s.checking) { input -> lifecycleScope.launch { connect(input) } }
                    // keyed on the instance: a new WebView (after Retry or a server change) gets a fresh AndroidView
                    is Screen.Web -> webView?.let { view -> key(view) { AndroidView(factory = { view }) } }
                    is Screen.Unreachable -> UnreachableScreen(s.origin, s.message, onRetry = { start(s.origin) }, onChangeServer = ::showSetup)
                }
            }
        }
        onBackPressedDispatcher.addCallback(this) {
            val view = webView
            if (screen is Screen.Web && view != null && view.canGoBack()) view.goBack() else moveTaskToBack(true)
        }
        if (intent?.action == ACTION_CHANGE_SERVER) showSetup() else start(graph.origin)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_CHANGE_SERVER) showSetup()
    }

    private fun start(origin: String?) {
        if (origin == null) {
            showSetup()
            return
        }
        screen = Screen.Loading
        lifecycleScope.launch {
            when (val health = graph.api.health(origin)) {
                is Health.Ok -> openWeb(origin)
                is Health.Problem -> screen = Screen.Unreachable(origin, health.message)
            }
        }
    }

    private suspend fun connect(input: String) {
        val origin = ServerAddress.normalize(input)
        if (origin == null) {
            screen = Screen.Setup(input, "Enter a server address like nas:4000 or http://192.168.1.10:3000.", false)
            return
        }
        screen = Screen.Setup(input, null, true)
        when (val health = graph.api.health(origin)) {
            is Health.Ok -> {
                if (origin != graph.origin) bridge?.stopPlayback()
                graph.setOrigin(origin)
                openWeb(origin)
            }
            is Health.Problem -> screen = Screen.Setup(input, health.message, false)
        }
    }

    fun showSetup() {
        teardownWeb()
        screen = Screen.Setup(graph.origin, null, false)
    }

    /** The server said the session is gone: load the server again, which lands on its sign-in page. */
    fun onAuthLost() {
        val origin = (screen as? Screen.Web)?.origin ?: return
        webView?.loadUrl(origin)
    }

    private fun openWeb(origin: String) {
        teardownWeb()
        val view = WebHost.create(
            activity = this,
            origin = origin,
            // don't destroy the WebView from inside its own callback; Retry's openWeb tears it down
            onMainFrameError = { message -> screen = Screen.Unreachable(origin, message) },
            onMicrophoneRequest = ::onMicrophoneRequest,
        )
        bridge = WebBridge(this, view, origin).also { it.install() }
        webView = view
        view.loadUrl(origin)
        screen = Screen.Web(origin)
    }

    private fun teardownWeb() {
        bridge?.release()
        bridge = null
        webView?.destroy()
        webView = null
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
        super.onDestroy()
    }

    companion object {
        const val ACTION_CHANGE_SERVER = "app.spotless.android.CHANGE_SERVER"
    }
}
