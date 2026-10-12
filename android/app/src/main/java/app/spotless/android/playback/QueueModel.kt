package app.spotless.android.playback

import app.spotless.android.bridge.TrackDto
import kotlinx.serialization.Serializable
import kotlin.math.abs

sealed interface QueueChange {
    /** Rebuild the player's playlist. */
    data class Replace(val tracks: List<TrackDto>, val index: Int) : QueueChange
    /** Keep the playing item; replace everything before and after it. */
    data class Around(val before: List<TrackDto>, val after: List<TrackDto>, val index: Int) : QueueChange
    /** Native changed the queue since the page last looked: the page must re-read it. */
    data object Rejected : QueueChange
}

/**
 * The queue as the page sees it, kept in step with ExoPlayer's playlist (same order, same indices).
 * `version` only moves when native changes the contents on its own, so a page message built on an older
 * queue can be told apart from one built on the current queue.
 */
class QueueModel {
    var tracks: List<TrackDto> = emptyList()
        private set
    var index: Int = -1
    var version: Int = 0
        private set

    fun set(tracks: List<TrackDto>, index: Int) {
        this.tracks = tracks
        this.index = if (tracks.isEmpty()) -1 else index.coerceIn(0, tracks.lastIndex)
    }

    fun sync(newTracks: List<TrackDto>, jsIndex: Int, baseVersion: Int): QueueChange {
        if (baseVersion != version) return QueueChange.Rejected
        val current = tracks.getOrNull(index)
        val at = if (current == null) -1 else locate(newTracks, current, jsIndex)
        if (at < 0) {
            set(newTracks, jsIndex)
            return QueueChange.Replace(tracks, this.index)
        }
        tracks = newTracks
        index = at
        return QueueChange.Around(newTracks.subList(0, at), newTracks.subList(at + 1, newTracks.size), at)
    }

    /** A queue native started by itself (restored session; Android Auto in P2). */
    fun replaceFromNative(tracks: List<TrackDto>, index: Int) {
        set(tracks, index)
        version++
    }

    companion object {
        const val PERSIST_MAX = 500

        /** Where `current` sits in `list`: at `hint` if it is there, else the nearest copy, else -1. */
        fun locate(list: List<TrackDto>, current: TrackDto, hint: Int): Int {
            if (list.getOrNull(hint)?.id == current.id) return hint
            var best = -1
            var bestDistance = Int.MAX_VALUE
            list.forEachIndexed { i, t ->
                if (t.id == current.id && abs(i - hint) < bestDistance) {
                    best = i
                    bestDistance = abs(i - hint)
                }
            }
            return best
        }

        /** Same cap as the web's persisted queue: keep the current track and what follows it. */
        fun trimForPersist(tracks: List<TrackDto>, index: Int): Pair<List<TrackDto>, Int> {
            if (tracks.isEmpty()) return Pair(emptyList(), -1)
            val start = maxOf(0, minOf(index, tracks.size - PERSIST_MAX))
            val kept = tracks.subList(start, minOf(tracks.size, start + PERSIST_MAX)).toList()
            val keptIndex = if (index >= 0) minOf(index - start, kept.size - 1) else -1
            return Pair(kept, keptIndex)
        }
    }
}

/** What survives the process being killed: enough to resume where playback stopped. */
@Serializable
data class SessionSnapshot(
    val tracks: List<TrackDto>,
    val index: Int,
    val positionMs: Long,
    val repeat: String,
    val version: Int,
)
