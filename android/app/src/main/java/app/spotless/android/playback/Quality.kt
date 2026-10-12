package app.spotless.android.playback

import java.util.Locale

/** Quality ladder, best first. The ids double as the stored setting (same as RUNGS in src/lib/adaptive.ts). */
enum class Rung(val id: String, val bitrate: Int) {
    RAW("raw", 0),
    HIGH("high", 320),
    NORMAL("normal", 192),
    SAVER("saver", 128);

    companion object {
        fun byId(id: String?): Rung? = entries.firstOrNull { it.id == id }
    }
}

/** What Android tells us about the connection. */
data class NetworkInfo(
    val supported: Boolean,
    val metered: Boolean,
    val downlinkMbps: Double? = null,
    val saveData: Boolean = false,
)

/** Port of src/lib/adaptive.ts: the stored setting, the network ceiling and the stall history. */
class QualityPolicy(private val now: () -> Long = System::currentTimeMillis) {
    var setting: String = "raw"
        set(value) {
            field = if (value == "auto" || Rung.byId(value) != null) value else "raw"
            if (field != "auto") resetStalls()
        }

    var network: NetworkInfo = NetworkInfo(supported = false, metered = false)

    private var stalls = 0
    private var lastStallAt = 0L

    val isAuto: Boolean get() = setting == "auto"

    /** Rung to stream at right now, resolving "auto" against the live connection. */
    fun current(): Rung = if (isAuto) autoRung() else Rung.byId(setting) ?: Rung.RAW

    private fun autoRung(): Rung = Rung.entries[minOf(BOTTOM, networkRung(network) + stallPenalty())]

    /** Playback rebuffered; returns the penalty now in force. */
    fun noteStall(): Int {
        stalls = minOf(BOTTOM, stallPenalty() + 1)
        lastStallAt = now()
        return stalls
    }

    fun resetStalls() {
        stalls = 0
        lastStallAt = 0
    }

    /** Rungs currently forfeited by rebuffering, decaying one rung per recovery window. */
    private fun stallPenalty(): Int {
        if (stalls == 0) return 0
        val recovered = ((now() - lastStallAt) / STALL_RECOVERY_MS).toInt()
        return maxOf(0, stalls - recovered)
    }

    companion object {
        const val STALL_RECOVERY_MS = 90_000L
        private val BOTTOM = Rung.entries.size - 1

        /** Best rung the network allows before stall history (networkRung in adaptive.ts). */
        fun networkRung(net: NetworkInfo): Int {
            if (net.saveData) return BOTTOM
            if (!net.supported) return Rung.HIGH.ordinal
            var rung = if (net.metered) Rung.HIGH.ordinal else Rung.RAW.ordinal
            // the downlink estimate rolls, so it only ever pulls the ceiling down
            net.downlinkMbps?.let { mbps ->
                rung = when {
                    mbps < 1 -> BOTTOM
                    mbps < 2 -> maxOf(rung, Rung.NORMAL.ordinal)
                    mbps < 5 -> maxOf(rung, Rung.HIGH.ordinal)
                    else -> rung
                }
            }
            return minOf(rung, BOTTOM)
        }

        /** True when `a` sounds worse than `b` (further down the ladder). */
        fun isLower(a: Rung, b: Rung): Boolean = a.ordinal > b.ordinal

        /** Query string for /api/stream/<id> (streamQuery in adaptive.ts). */
        fun streamQuery(rung: Rung, offsetSec: Double = 0.0): String {
            if (rung.bitrate == 0) return ""
            val offset = if (offsetSec > 0) "&offset=" + String.format(Locale.US, "%.3f", offsetSec) else ""
            return "?format=mp3&maxBitRate=${rung.bitrate}$offset"
        }
    }
}
