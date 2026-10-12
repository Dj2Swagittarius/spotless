package app.spotless.android.net

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Same rules as normalizeServer in desktop/main.js: "nas:4000" or "http://nas:4000/library" -> "http://nas:4000". */
object ServerAddress {
    private val SCHEME = Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE)

    /** The origin for what the user typed, or null when it is not an http(s) address. */
    fun normalize(input: String?): String? {
        val text = input?.trim().orEmpty()
        if (text.isEmpty()) return null
        val withScheme = if (SCHEME.containsMatchIn(text)) text else "http://$text"
        // HttpUrl only parses http and https, so every other scheme comes back null here
        val url = withScheme.toHttpUrlOrNull() ?: return null
        return origin(url)
    }

    /** "scheme://host[:port]" with the default port left out, like URL.origin in a browser. */
    fun origin(url: HttpUrl): String {
        val host = if (url.host.contains(':')) "[${url.host}]" else url.host
        val port = if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"
        return "${url.scheme}://$host$port"
    }
}
