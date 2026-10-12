package app.spotless.android.playback.eq

import org.junit.Assert.assertEquals
import org.junit.Test

class BiquadTest {
    private val rates = listOf(44100.0, 48000.0)

    @Test fun `peaking hits its gain at the centre frequency`() {
        for (fs in rates) for (f in listOf(62.0, 1000.0, 8000.0)) for (g in listOf(-12.0, -3.0, 6.0, 12.0)) {
            val c = Coefficients.design(FilterType.PEAKING, f, g, EqBands.PEAK_Q, fs)
            assertEquals("f=$f g=$g fs=$fs", g, c.magnitudeDb(f, fs), 0.01)
        }
    }

    @Test fun `lowshelf hits its gain at DC`() {
        for (fs in rates) for (g in listOf(-12.0, 5.5, 12.0)) {
            val c = Coefficients.design(FilterType.LOWSHELF, 31.0, g, EqBands.PEAK_Q, fs)
            assertEquals(g, c.magnitudeDb(0.0, fs), 0.01)
        }
    }

    @Test fun `highshelf hits its gain at Nyquist`() {
        for (fs in rates) for (g in listOf(-12.0, 4.5, 12.0)) {
            val c = Coefficients.design(FilterType.HIGHSHELF, 16000.0, g, EqBands.PEAK_Q, fs)
            assertEquals(g, c.magnitudeDb(fs / 2, fs), 0.01)
        }
    }

    @Test fun `zero gain is a pass-through`() {
        for (type in FilterType.entries) {
            val c = Coefficients.design(type, 1000.0, 0.0, EqBands.PEAK_Q, 48000.0)
            assertEquals(1.0, c.b0, 1e-12)
            assertEquals(c.a1, c.b1, 1e-12)
            assertEquals(c.a2, c.b2, 1e-12)
        }
    }

    @Test fun `bands match the web layout`() {
        assertEquals(10, EqBands.FREQS.size)
        assertEquals(FilterType.LOWSHELF, EqBands.typeOf(0))
        assertEquals(FilterType.PEAKING, EqBands.typeOf(5))
        assertEquals(FilterType.HIGHSHELF, EqBands.typeOf(9))
    }
}
