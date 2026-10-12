package app.spotless.android.ui

import app.spotless.android.ui.UrlPolicy.Decision.EXTERNAL
import app.spotless.android.ui.UrlPolicy.Decision.IN_APP
import org.junit.Assert.assertEquals
import org.junit.Test

class UrlPolicyTest {
    private val origin = "http://nas:4000"

    @Test fun `same origin stays`() = assertEquals(IN_APP, UrlPolicy.decide(origin, "http://nas:4000/album/3"))
    @Test fun `other port leaves`() = assertEquals(EXTERNAL, UrlPolicy.decide(origin, "http://nas:5000/"))
    @Test fun `spotify sign-in stays`() = assertEquals(IN_APP, UrlPolicy.decide(origin, "https://accounts.spotify.com/authorize?x=1"))
    @Test fun `last fm sign-in stays`() {
        assertEquals(IN_APP, UrlPolicy.decide(origin, "https://www.last.fm/api/auth"))
        assertEquals(IN_APP, UrlPolicy.decide(origin, "https://last.fm/api/auth"))
    }
    @Test fun `lookalikes leave`() {
        assertEquals(EXTERNAL, UrlPolicy.decide(origin, "https://spotify.com.evil.example/"))
        assertEquals(EXTERNAL, UrlPolicy.decide(origin, "https://notlast.fm/"))
    }
    @Test fun `cleartext sign-in pages leave`() {
        assertEquals(EXTERNAL, UrlPolicy.decide(origin, "http://accounts.spotify.com/authorize"))
        assertEquals(EXTERNAL, UrlPolicy.decide(origin, "http://last.fm/api/auth"))
    }
    @Test fun `other sites leave`() = assertEquals(EXTERNAL, UrlPolicy.decide(origin, "https://github.com/"))
    @Test fun `non-http leaves`() = assertEquals(EXTERNAL, UrlPolicy.decide(origin, "mailto:a@b.c"))
}
