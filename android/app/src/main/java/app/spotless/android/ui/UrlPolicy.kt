package app.spotless.android.ui

import app.spotless.android.net.ServerAddress
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Which navigations stay in the WebView. The server's own pages do; so do the Spotify and Last.fm sign-in
 * pages (same list as desktop/main.js), because their callback must come back with this WebView's session
 * cookie. Everything else opens in the system browser.
 */
object UrlPolicy {
    enum class Decision { IN_APP, EXTERNAL }

    private val SIGN_IN_HOSTS = listOf(Regex("^(?:.+\\.)?spotify\\.com$"), Regex("^(?:www\\.)?last\\.fm$"))

    fun decide(origin: String, url: String): Decision {
        val parsed = url.toHttpUrlOrNull() ?: return Decision.EXTERNAL
        if (ServerAddress.origin(parsed) == origin) return Decision.IN_APP
        if (SIGN_IN_HOSTS.any { it.matches(parsed.host) }) return Decision.IN_APP
        return Decision.EXTERNAL
    }
}
