package app.spotless.android.net

import org.junit.Assert.assertEquals
import org.junit.Test

class HealthTest {
    private val origin = "http://nas:4000"

    @Test fun `ok true is a working server`() =
        assertEquals(Health.Ok("0.3.1"), HealthCheck.classify(origin, 200, """{"ok":true,"version":"0.3.1"}"""))

    @Test fun `ok false is a sick server`() =
        assertEquals(
            Health.Problem("The Spotless server at http://nas:4000 is running but reported a problem (HTTP 503)."),
            HealthCheck.classify(origin, 503, """{"ok":false}"""),
        )

    @Test fun `html is some other app`() =
        assertEquals(
            Health.Problem("http://nas:4000 answered, but it does not look like a Spotless server."),
            HealthCheck.classify(origin, 200, "<html></html>"),
        )

    @Test fun `json without ok is some other app`() =
        assertEquals(
            Health.Problem("http://nas:4000 answered, but it does not look like a Spotless server."),
            HealthCheck.classify(origin, 200, """{"status":"up"}"""),
        )

    @Test fun `unreachable message`() =
        assertEquals(Health.Problem("Could not reach http://nas:4000: timeout."), HealthCheck.unreachable(origin, "timeout"))
}
