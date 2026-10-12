package app.spotless.android.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class LevelsTest {
    @Test fun `no gain tag is unity`() = assertEquals(1.0, Levels.gainMult(null), 1e-9)
    @Test fun `minus six dB halves`() = assertEquals(0.501, Levels.gainMult(-6.0), 1e-3)
    @Test fun `boost is capped at 1_4`() = assertEquals(1.4, Levels.gainMult(12.0), 1e-9)
    @Test fun `level multiplies and caps at one`() {
        assertEquals(0.15, Levels.level(0.5, Levels.DUCK_GAIN, null), 1e-9)
        assertEquals(1.0, Levels.level(1.0, 1.0, 6.0), 1e-9)
    }
}
