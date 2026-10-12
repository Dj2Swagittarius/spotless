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

    private fun gainsAt5(db: Double) = DoubleArray(10).also { it[5] = db }
    private fun mixedSignal(frames: Int) =
        ShortArray(frames * 2) { i -> (3000 * sin(2 * PI * 700.0 * (i / 2) / fs) + 1500 * sin(2 * PI * 3100.0 * (i / 2) / fs)).toInt().toShort() }

    @Test fun `re-applying identical settings mid-stream keeps filter state`() {
        val input = mixedSignal(2000)
        val whole = input.copyOf()
        EqFilterBank(2, fs).apply { set(true, gainsAt5(6.0)) }.process(whole, whole.size)

        val bank = EqFilterBank(2, fs).apply { set(true, gainsAt5(6.0)) }
        val split = input.copyOf()
        val half = split.size / 2
        bank.process(split, half)
        bank.set(true, gainsAt5(6.0))
        val tail = split.copyOfRange(half, split.size)
        bank.process(tail, tail.size)
        tail.copyInto(split, half)
        assertArrayEquals(whole, split)
    }

    @Test fun `non-finite gain is treated as zero`() {
        val bank = EqFilterBank(2, fs)
        bank.set(true, gainsAt5(Double.NaN))
        assertFalse(bank.active)
        bank.set(true, gainsAt5(Double.POSITIVE_INFINITY))
        assertFalse(bank.active)
        bank.set(true, DoubleArray(10).also { it[2] = Double.NaN; it[5] = 6.0 })
        assertTrue(bank.active)
        val out = sine(1000.0, 4800)
        bank.process(out, out.size)
        assertEquals(2.0, rms(out, 2400) / rms(sine(1000.0, 4800), 2400), 0.05)
    }

    @Test fun `reset clears filter history`() {
        val bank = EqFilterBank(2, fs).apply { set(true, gainsAt5(6.0)) }
        val warmup = mixedSignal(500)
        bank.process(warmup, warmup.size)
        bank.reset()
        val a = mixedSignal(1000)
        val fresh = a.copyOf()
        EqFilterBank(2, fs).apply { set(true, gainsAt5(6.0)) }.process(fresh, fresh.size)
        bank.process(a, a.size)
        assertArrayEquals(fresh, a)
    }
}
