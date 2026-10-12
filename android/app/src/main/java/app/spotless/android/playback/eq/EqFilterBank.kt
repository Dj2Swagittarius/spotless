package app.spotless.android.playback.eq

import kotlin.math.roundToInt

/**
 * The EQ chain over interleaved PCM16 samples. Bands at 0 dB are left out entirely, so a flat or
 * disabled EQ is inactive and the audio is not touched at all (the web's "exact bypass").
 */
class EqFilterBank(val channels: Int, val sampleRate: Int) {
    private var coeffs: Array<Coefficients> = emptyArray()
    private var state = DoubleArray(0) // per channel, per band: x1, x2, y1, y2

    var active = false
        private set

    fun set(enabled: Boolean, gains: DoubleArray) {
        coeffs = if (!enabled) emptyArray() else EqBands.FREQS.indices.mapNotNull { i ->
            val g = gains.getOrElse(i) { 0.0 }.coerceIn(EqBands.MIN_DB, EqBands.MAX_DB)
            if (g == 0.0) null
            else Coefficients.design(EqBands.typeOf(i), EqBands.FREQS[i], g, EqBands.PEAK_Q, sampleRate.toDouble())
        }.toTypedArray()
        state = DoubleArray(channels * coeffs.size * 4)
        active = coeffs.isNotEmpty()
    }

    fun process(samples: ShortArray, count: Int) {
        val bands = coeffs.size
        for (i in 0 until count) {
            val ch = i % channels
            var x = samples[i].toDouble()
            for (k in 0 until bands) {
                val c = coeffs[k]
                val s = (ch * bands + k) * 4
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
