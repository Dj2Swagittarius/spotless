package app.spotless.android.ui

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import app.spotless.android.BuildConfig

/** Builds the WebView that shows the server's pages. */
object WebHost {
    fun isTv(context: Context): Boolean =
        (context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)

    @SuppressLint("SetJavaScriptEnabled")
    fun create(
        activity: MainActivity,
        origin: String,
        onMainFrameError: (String) -> Unit,
        onPageFinished: () -> Unit,
        onMicrophoneRequest: (PermissionRequest) -> Unit,
        onMicrophoneCanceled: (PermissionRequest) -> Unit,
    ): WebView = WebView(activity).apply {
        // chrome://inspect for test builds only
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        // Without explicit match_parent the WebView is wrap_content inside Compose's AndroidView, and Chromium
        // then resolves every viewport unit (vh/dvh) to 0 — the page's h-dvh layout collapses to nothing.
        layoutParams = android.view.ViewGroup.LayoutParams(
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
        )
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // the page's own player (fallback when the bridge is unavailable) may start without a tap
        settings.mediaPlaybackRequiresUserGesture = false
        // the page turns on D-pad navigation when it sees SpotlessTV
        settings.userAgentString = settings.userAgentString + " SpotlessAndroid/" + BuildConfig.VERSION_NAME +
            if (isTv(activity)) " SpotlessTV" else ""
        // key events (the remote's D-pad) only reach a focused WebView
        isFocusable = true
        isFocusableInTouchMode = true
        setBackgroundColor(android.graphics.Color.BLACK)

        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (UrlPolicy.decide(origin, url) == UrlPolicy.Decision.IN_APP) return false
                // only a main-frame navigation may leave the app, and only to a browser or mail app; file:, content:,
                // intent:, javascript: and the rest are dropped, and so is any other frame's attempt
                val scheme = request.url.scheme?.lowercase()
                if (request.isForMainFrame && (scheme == "http" || scheme == "https" || scheme == "mailto")) {
                    try {
                        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (_: ActivityNotFoundException) {
                        // nothing can open it; stay put
                    }
                }
                return true
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (!view.hasFocus()) view.requestFocus()
                onPageFinished()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) onMainFrameError(error.description?.toString() ?: "the page did not load")
            }
        }

        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val fromServer = request.origin?.let { "${it.scheme}://${it.authority}" } == origin
                if (fromServer && request.resources.contentEquals(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))) {
                    onMicrophoneRequest(request)
                } else {
                    request.deny()
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                onMicrophoneCanceled(request)
            }
        }
    }
}
