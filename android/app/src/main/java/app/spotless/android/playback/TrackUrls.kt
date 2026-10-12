package app.spotless.android.playback

import app.spotless.android.bridge.TrackDto

/** What a media item streams: the URL, the rung it was built at (null for stations) and its start offset. */
data class StreamSpec(val url: String, val rung: Rung?, val offsetSec: Double)

object TrackUrls {
    /** URI for playlist placeholders; the engine skips items carrying it. */
    const val MISSING = "spotless:missing"

    /**
     * Same rules as setSrc in Player.tsx: stations play their own URL (the server hands out
     * "/api/stations/<id>/stream", relative to itself); a transcode starts at `offsetSec` (its clock then
     * begins there); the original file is range-seekable, so it starts at 0 and seeks.
     */
    fun stream(origin: String, track: TrackDto, rung: Rung, offsetSec: Double = 0.0): StreamSpec {
        if (!track.isPlayable) return StreamSpec(MISSING, null, 0.0)
        track.streamUrl?.let { return StreamSpec(if (it.startsWith("/")) origin + it else it, null, 0.0) }
        val offset = if (rung.bitrate > 0) offsetSec else 0.0
        return StreamSpec("$origin/api/stream/${track.id}${QualityPolicy.streamQuery(rung, offset)}", rung, offset)
    }

    fun artwork(origin: String, track: TrackDto): String? =
        if (track.albumId > 0 && track.streamUrl == null) "$origin/api/artwork/${track.albumId}" else null
}
