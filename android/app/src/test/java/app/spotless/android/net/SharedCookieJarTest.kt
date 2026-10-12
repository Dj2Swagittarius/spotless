package app.spotless.android.net

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class SharedCookieJarTest {
    private class FakeSource : CookieSource {
        val jar = HashMap<String, MutableList<String>>()
        override fun get(url: String) = jar[url]?.joinToString("; ")
        override fun set(url: String, cookie: String) { jar.getOrPut(url) { mutableListOf() } += cookie }
    }

    @Test fun `loads the webview cookies for a request`() {
        val source = FakeSource().apply { jar["http://nas:4000/api/stream/1"] = mutableListOf("spotless_session=abc", "x=1") }
        val cookies = SharedCookieJar(source).loadForRequest("http://nas:4000/api/stream/1".toHttpUrl())
        assertEquals(listOf("spotless_session" to "abc", "x" to "1"), cookies.map { it.name to it.value })
    }

    @Test fun `no cookies is an empty list`() =
        assertEquals(emptyList<Cookie>(), SharedCookieJar(FakeSource()).loadForRequest("http://nas/".toHttpUrl()))

    @Test fun `saves response cookies back to the webview`() {
        val source = FakeSource()
        val url = "http://nas:4000/api/history".toHttpUrl()
        SharedCookieJar(source).saveFromResponse(url, listOf(Cookie.parse(url, "a=b; Path=/")!!))
        assertEquals("a=b; path=/", source.get(url.toString()))
    }
}
