package app.spotless.android

import org.junit.Assert.assertEquals
import org.junit.Test

class VersionCodeTest {
    @Test
    fun `version code follows the package json version`() {
        val (major, minor, patch) = BuildConfig.VERSION_NAME.substringBefore('-').split('.').map { it.toInt() }
        assertEquals(major * 10000 + minor * 100 + patch, BuildConfig.VERSION_CODE)
    }
}
