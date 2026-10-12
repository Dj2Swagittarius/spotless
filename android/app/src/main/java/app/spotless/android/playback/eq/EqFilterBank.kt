package app.spotless.android.playback.eq

import kotlin.math.roundToInt

/**
 * The EQ chain over interleaved PCM16 samples. Bands at 0 dB are left out entirely, so a flat or
 * disabled EQ is inactive and the audio is not touched at all (the web's "exact bypass").
 *
 * Biquad history is kept per band across [set] calls (like the web's BiquadFilterNode, which keeps
 * its state when a gain changes), so moving a slider does not click. A band's history is only
 * cleared when the band goes from inactive to active, or by [reset].
 */
class EqFilterBank(val channels: Int, val sampleRate: Int) {
    private val bandCount = EqBands.FREQS.size
    private val bandCoeffs = arrayOfNulls<Coefficients>(bandCount)
    private val state = DoubleArray(channels * bandCount * 4) // per channel, per band: x1, x2, y1, y2
    private var activeBands = IntArray(0)

    var active = false
        private set

    fun set(enabled: Boolean, gains: DoubleArray) {
        for (i in 0 until bandCount) {
            val raw = gains.getOrElse(i) { 0.0 }
            val g = if (raw.isFinite()) raw.coerceIn(EqBands.MIN_DB, EqBands.MAX_DB) else 0.0
            val next = if (!enabled || g == 0.0) null
            else Coefficients.design(EqBands.typeOf(i), EqBands.FREQS[i], g, EqBands.PEAK_Q, sampleRate.toDouble())
            if (next != null && bandCoeffs[i] == null) clearBand(i)
            bandCoeffs[i] = next
        }
        activeBands = (0 until bandCount).filter { bandCoeffs[it] != null }.toIntArray()
        active = activeBands.isNotEmpty()
    }

    /** Zero all filter history, e.g. after a seek. */
    fun reset() {
        state.fill(0.0)
    }

    private fun clearBand(band: Int) {
        for (ch in 0 until channels) {
            val s = (ch * bandCount + band) * 4
            state.fill(0.0, s, s + 4)
        }
    }

    fun process(samples: ShortArray, count: Int) {
        val bands = activeBands
        for (i in 0 until count) {
            val ch = i % channels
            var x = samples[i].toDouble()
            for (band in bands) {
                val c = bandCoeffs[band]!!
                val s = (ch * bandCount + band) * 4
                val y = c.b0 * x + c.b1 * state[s] + c.b2 * state[s + 1] - c.a1 * state[s + 2] - c.a2 * state[s + 3]
                state[s + 1] = state[s]
                state[s] = x
                state[s + 3] = state[s + 2]
                state[s + 2] = y
                x = y
            }
            samples[i] = x.roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
    }
}
