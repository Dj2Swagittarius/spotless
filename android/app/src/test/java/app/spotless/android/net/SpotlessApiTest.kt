package app.spotless.android.net

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class SpotlessApiTest {
    private val server = MockWebServer().apply { start() }
    private val origin = server.url("/").toString().trimEnd('/')
    private var authLost = 0
    private val client = OkHttpClient.Builder().addInterceptor(AuthInterceptor { authLost++ }).build()
    private val api = SpotlessApi(client) { origin }

    @After fun tearDown() = server.shutdown()

    @Test fun `health ok`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"version":"0.3.1"}"""))
        assertEquals(Health.Ok("0.3.1"), api.health(origin))
        assertEquals("/api/health", server.takeRequest().path)
    }

    @Test fun `health unreachable`() = runBlocking {
        server.shutdown()
        val result = api.health(origin)
        assertTrue(result is Health.Problem && result.message.startsWith("Could not reach $origin"))
    }

    @Test fun `history posts the web's JSON body`() {
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        api.postHistory(12, "played", 1_700_000_000L)
        val req = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", req.method)
        assertEquals("/api/history", req.path)
        assertEquals("""{"trackId":12,"event":"played","startedAt":1700000000}""", req.body.readUtf8())
    }

    @Test fun `history start omits startedAt`() {
        server.enqueue(MockResponse())
        api.postHistory(12, "start", null)
        assertEquals("""{"trackId":12,"event":"start"}""", server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8())
    }

    @Test fun `401 reports a lost session`() {
        server.enqueue(MockResponse().setResponseCode(401))
        client.newCall(Request.Builder().url("$origin/api/stream/1").build()).execute().close()
        assertEquals(1, authLost)
    }
}
