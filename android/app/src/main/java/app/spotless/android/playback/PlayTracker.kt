package app.spotless.android.playback

enum class HistoryEvent(val wire: String) { START("start"), PLAYED("played") }

data class HistoryReport(val trackId: Int, val event: HistoryEvent, val startedAt: Long?)

/**
 * The listening rules from Player.tsx: 'start' once per play (Last.fm "now playing"), 'played' once half the
 * track or 240 s has actually been heard. Only continuous playback counts — a jump between two position
 * samples larger than 2 s is a seek or a source swap, not listening.
 */
class PlayTracker(private val nowSeconds: () -> Long = { System.currentTimeMillis() / 1000 }) {
    private var trackId = 0
    private var library = false
    private var durationSec = 0.0
    private var listened = 0.0
    private var lastPos: Double? = null
    private var startPosted = false
    private var playedPosted = false
    private var startedAt = 0L

    /** A new track, or a replay of this one. */
    fun begin(trackId: Int, durationSec: Double, isLibrary: Boolean) {
        this.trackId = trackId
        this.durationSec = durationSec
        library = isLibrary
        listened = 0.0
        lastPos = null
        startPosted = false
        playedPosted = false
        startedAt = 0
    }

    /** Sound is coming out. */
    fun onPlaying(): HistoryReport? {
        if (startPosted || !library) return null
        startPosted = true
        startedAt = nowSeconds()
        return HistoryReport(trackId, HistoryEvent.START, null)
    }

    /** A position sample (the engine samples once a second while playing). */
    fun onPosition(posSec: Double): HistoryReport? {
        val last = lastPos
        lastPos = posSec
        if (last != null) {
            val delta = posSec - last
            if (delta > 0 && delta <= MAX_LISTEN_DELTA_S) listened += delta
        }
        if (playedPosted || !library) return null
        val threshold = if (durationSec > 0) minOf(durationSec / 2, PLAYED_CAP_S) else PLAYED_CAP_S
        if (listened < threshold) return null
        playedPosted = true
        return HistoryReport(trackId, HistoryEvent.PLAYED, startedAt.takeIf { it > 0 })
    }

    /** A seek or a source swap: the next sample must not count the jump. */
    fun onJump() {
        lastPos = null
    }

    companion object {
        const val PLAYED_CAP_S = 240.0
        const val MAX_LISTEN_DELTA_S = 2.0
    }
}
