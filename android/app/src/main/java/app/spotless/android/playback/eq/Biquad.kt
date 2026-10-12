package app.spotless.android.playback.eq

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

enum class FilterType { LOWSHELF, PEAKING, HIGHSHELF }

/**
 * Normalized biquad coefficients (a0 = 1). The formulas are the ones the Web Audio spec gives for
 * BiquadFilterNode (Audio EQ Cookbook, shelf slope S = 1), so the app's EQ curve is the browser's.
 */
data class Coefficients(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {

    /** Magnitude response in dB at `freq` Hz for sample rate `fs`. */
    fun magnitudeDb(freq: Double, fs: Double): Double {
        val w = 2 * PI * freq / fs
        val nr = b0 + b1 * cos(w) + b2 * cos(2 * w)
        val ni = -(b1 * sin(w) + b2 * sin(2 * w))
        val dr = 1 + a1 * cos(w) + a2 * cos(2 * w)
        val di = -(a1 * sin(w) + a2 * sin(2 * w))
        return 10 * log10((nr * nr + ni * ni) / (dr * dr + di * di))
    }

    companion object {
        fun design(type: FilterType, freq: Double, gainDb: Double, q: Double, fs: Double): Coefficients {
            val f0 = minOf(freq, fs / 2 * 0.999) // a band above Nyquist (low sample rates) sits just under it
            val a = 10.0.pow(gainDb / 40)
            val w0 = 2 * PI * f0 / fs
            val cosw = cos(w0)
            val sinw = sin(w0)
            val b0: Double; val b1: Double; val b2: Double
            val a0: Double; val a1: Double; val a2: Double
            when (type) {
                FilterType.PEAKING -> {
                    val alpha = sinw / (2 * q)
                    b0 = 1 + alpha * a; b1 = -2 * cosw; b2 = 1 - alpha * a
                    a0 = 1 + alpha / a; a1 = -2 * cosw; a2 = 1 - alpha / a
                }
                FilterType.LOWSHELF -> {
                    val k = 2 * sqrt(a) * (sinw / 2 * sqrt(2.0))
                    b0 = a * ((a + 1) - (a - 1) * cosw + k)
                    b1 = 2 * a * ((a - 1) - (a + 1) * cosw)
                    b2 = a * ((a + 1) - (a - 1) * cosw - k)
                    a0 = (a + 1) + (a - 1) * cosw + k
                    a1 = -2 * ((a - 1) + (a + 1) * cosw)
                    a2 = (a + 1) + (a - 1) * cosw - k
                }
                FilterType.HIGHSHELF -> {
                    val k = 2 * sqrt(a) * (sinw / 2 * sqrt(2.0))
                    b0 = a * ((a + 1) + (a - 1) * cosw + k)
                    b1 = -2 * a * ((a - 1) + (a + 1) * cosw)
                    b2 = a * ((a + 1) + (a - 1) * cosw - k)
                    a0 = (a + 1) - (a - 1) * cosw + k
                    a1 = 2 * ((a - 1) - (a + 1) * cosw)
                    a2 = (a + 1) - (a - 1) * cosw - k
                }
            }
            return Coefficients(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
        }
    }
}

/** The band layout of src/lib/eq.ts. */
object EqBands {
    val FREQS = doubleArrayOf(31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)
    const val MIN_DB = -12.0
    const val MAX_DB = 12.0
    const val PEAK_Q = 1.1

    fun typeOf(i: Int): FilterType = when (i) {
        0 -> FilterType.LOWSHELF
        FREQS.lastIndex -> FilterType.HIGHSHELF
        else -> FilterType.PEAKING
    }
}
