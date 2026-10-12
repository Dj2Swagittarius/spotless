package app.spotless.android.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QualityTest {
    private var clock = 1_000_000L
    private fun policy(setting: String = "auto", net: NetworkInfo = NetworkInfo(supported = true, metered = false)) =
        QualityPolicy { clock }.apply { this.setting = setting; network = net }

    @Test fun `fixed settings pick their rung`() {
        assertEquals(Rung.RAW, policy("raw").current())
        assertEquals(Rung.HIGH, policy("high").current())
        assertEquals(Rung.NORMAL, policy("normal").current())
        assertEquals(Rung.SAVER, policy("saver").current())
    }

    @Test fun `unknown setting falls back to raw`() = assertEquals(Rung.RAW, policy("bogus").current())

    @Test fun `auto follows the network`() {
        assertEquals(Rung.RAW, policy(net = NetworkInfo(supported = true, metered = false)).current())
        assertEquals(Rung.HIGH, policy(net = NetworkInfo(supported = true, metered = true)).current())
        assertEquals(Rung.HIGH, policy(net = NetworkInfo(supported = false, metered = false)).current())
        assertEquals(Rung.SAVER, policy(net = NetworkInfo(supported = true, metered = false, saveData = true)).current())
    }

    @Test fun `downlink only pulls the ceiling down`() {
        assertEquals(Rung.SAVER, policy(net = NetworkInfo(true, false, downlinkMbps = 0.5)).current())
        assertEquals(Rung.NORMAL, policy(net = NetworkInfo(true, false, downlinkMbps = 1.5)).current())
        assertEquals(Rung.HIGH, policy(net = NetworkInfo(true, false, downlinkMbps = 3.0)).current())
        assertEquals(Rung.RAW, policy(net = NetworkInfo(true, false, downlinkMbps = 50.0)).current())
        assertEquals(Rung.HIGH, policy(net = NetworkInfo(true, true, downlinkMbps = 50.0)).current())
    }

    @Test fun `each stall steps one rung down and recovers one per window`() {
        val p = policy()
        p.noteStall()
        assertEquals(Rung.HIGH, p.current())
        p.noteStall()
        assertEquals(Rung.NORMAL, p.current())
        clock += QualityPolicy.STALL_RECOVERY_MS
        assertEquals(Rung.HIGH, p.current())
        clock += QualityPolicy.STALL_RECOVERY_MS
        assertEquals(Rung.RAW, p.current())
    }

    @Test fun `stalls cap at the bottom rung`() {
        val p = policy()
        repeat(10) { p.noteStall() }
        assertEquals(Rung.SAVER, p.current())
    }

    @Test fun `choosing a fixed tier forgets stalls`() {
        val p = policy()
        p.noteStall()
        p.setting = "raw"
        p.setting = "auto"
        assertEquals(Rung.RAW, p.current())
    }

    @Test fun `isLower compares ladder positions`() {
        assertTrue(QualityPolicy.isLower(Rung.SAVER, Rung.RAW))
        assertFalse(QualityPolicy.isLower(Rung.RAW, Rung.SAVER))
        assertFalse(QualityPolicy.isLower(Rung.HIGH, Rung.HIGH))
    }

    @Test fun `stream query matches the web`() {
        assertEquals("", QualityPolicy.streamQuery(Rung.RAW))
        assertEquals("", QualityPolicy.streamQuery(Rung.RAW, 12.0))
        assertEquals("?format=mp3&maxBitRate=320", QualityPolicy.streamQuery(Rung.HIGH))
        assertEquals("?format=mp3&maxBitRate=128&offset=12.500", QualityPolicy.streamQuery(Rung.SAVER, 12.5))
    }
}
