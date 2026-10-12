package app.spotless.android.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerAddressTest {
    @Test fun `adds http to a bare host and port`() = assertEquals("http://nas:4000", ServerAddress.normalize("nas:4000"))
    @Test fun `keeps only the origin`() = assertEquals("http://nas:4000", ServerAddress.normalize("http://nas:4000/library?x=1"))
    @Test fun `trims whitespace`() = assertEquals("http://192.168.1.10:3000", ServerAddress.normalize("  192.168.1.10:3000  "))
    @Test fun `keeps https`() = assertEquals("https://music.example.com", ServerAddress.normalize("https://music.example.com/"))
    @Test fun `drops the default port and lowercases`() = assertEquals("http://nas", ServerAddress.normalize("HTTP://NAS:80/"))
    @Test fun `brackets ipv6 hosts`() = assertEquals("http://[::1]:3000", ServerAddress.normalize("http://[::1]:3000"))
    @Test fun `rejects other schemes`() = assertNull(ServerAddress.normalize("ftp://nas"))
    @Test fun `rejects junk`() = assertNull(ServerAddress.normalize("javascript:alert(1)"))
    @Test fun `rejects empty`() {
        assertNull(ServerAddress.normalize(""))
        assertNull(ServerAddress.normalize("   "))
        assertNull(ServerAddress.normalize(null))
    }
}
