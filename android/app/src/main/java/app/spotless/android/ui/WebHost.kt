package app.spotless.android.ui

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
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
    @SuppressLint("SetJavaScriptEnabled")
    fun create(
        activity: MainActivity,
        origin: String,
        onMainFrameError: (String) -> Unit,
        onMicrophoneRequest: (PermissionRequest) -> Unit,
        onMicrophoneCanceled: (PermissionRequest) -> Unit,
    ): WebView = WebView(activity).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // the page's own player (fallback when the bridge is unavailable) may start without a tap
        settings.mediaPlaybackRequiresUserGesture = false
        settings.userAgentString = settings.userAgentString + " SpotlessAndroid/" + BuildConfig.VERSION_NAME
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
