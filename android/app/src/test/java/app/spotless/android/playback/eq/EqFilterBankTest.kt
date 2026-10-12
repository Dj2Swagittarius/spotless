package app.spotless.android.playback.eq

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin
import kotlin.math.sqrt

class EqFilterBankTest {
    private val fs = 48000
    private fun sine(freq: Double, frames: Int, amp: Double = 4000.0) =
        ShortArray(frames * 2) { i -> (amp * sin(2 * PI * freq * (i / 2) / fs)).toInt().toShort() }

    private fun rms(s: ShortArray, from: Int) = sqrt(s.drop(from).sumOf { it.toDouble() * it } / (s.size - from))

    @Test fun `disabled or flat is inactive and untouched`() {
        val bank = EqFilterBank(2, fs)
        bank.set(false, DoubleArray(10) { 6.0 })
        assertFalse(bank.active)
        bank.set(true, DoubleArray(10))
        assertFalse(bank.active)
        val input = sine(1000.0, 1000)
        val copy = input.copyOf()
        if (bank.active) bank.process(copy, copy.size)
        assertArrayEquals(input, copy)
    }

    @Test fun `six dB at 1 kHz doubles a 1 kHz tone`() {
        val bank = EqFilterBank(2, fs)
        bank.set(true, DoubleArray(10).also { it[5] = 6.0 })
        assertTrue(bank.active)
        val input = sine(1000.0, 9600)
        val out = input.copyOf()
        bank.process(out, out.size)
        // skip the filter's settling time
        assertEquals(2.0, rms(out, 4800) / rms(input, 4800), 0.05)
    }

    @Test fun `gains are clamped to plus or minus 12 dB`() {
        val loud = EqFilterBank(1, fs).apply { set(true, DoubleArray(10).also { it[5] = 40.0 }) }
        val capped = EqFilterBank(1, fs).apply { set(true, DoubleArray(10).also { it[5] = 12.0 }) }
        val a = ShortArray(4800) { i -> (1000 * sin(2 * PI * 1000.0 * i / fs)).toInt().toShort() }
        val b = a.copyOf()
        loud.process(a, a.size)
        capped.process(b, b.size)
        assertArrayEquals(b, a)
    }
}
