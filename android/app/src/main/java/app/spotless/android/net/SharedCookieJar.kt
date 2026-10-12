package app.spotless.android.net

import android.webkit.CookieManager
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** Where cookies live; the app uses the WebView's store so native requests share the page's sign-in. */
interface CookieSource {
    /** "a=b; c=d" for `url`, or null. */
    fun get(url: String): String?
    fun set(url: String, cookie: String)
}

class WebViewCookieSource : CookieSource {
    override fun get(url: String): String? = CookieManager.getInstance().getCookie(url)
    override fun set(url: String, cookie: String) = CookieManager.getInstance().setCookie(url, cookie)
}

/** Native requests (streams, art, history) carry the WebView's session cookie, HttpOnly included. */
class SharedCookieJar(private val source: CookieSource) : CookieJar {
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val header = source.get(url.toString()) ?: return emptyList()
        return header.split(';').mapNotNull { part -> part.trim().takeIf { it.isNotEmpty() }?.let { Cookie.parse(url, it) } }
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.forEach { source.set(url.toString(), it.toString()) }
    }
}
