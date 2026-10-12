package app.spotless.android.playback

import kotlin.math.pow

/** Volume math shared with Player.tsx: ReplayGain on top of the user's volume and the DJ duck. */
object Levels {
    /** Music level while the DJ talks (DUCK_GAIN in src/lib/client/djVoice.ts). */
    const val DUCK_GAIN = 0.3

    /** ReplayGain dB -> multiplier, capped so a quiet track can't be pushed past 1.4x. */
    fun gainMult(gain: Double?): Double = if (gain == null) 1.0 else minOf(1.4, 10.0.pow(gain / 20))

    fun level(volume: Double, duck: Double, gain: Double?): Double = minOf(1.0, volume * duck * gainMult(gain))
}
