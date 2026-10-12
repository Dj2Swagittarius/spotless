package app.spotless.android.playback

import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi

/** What StreamPlayer needs to know about the item playing now; the engine implements it. */
interface CurrentStream {
    /** Where the current stream starts within the track (a transcode resumed partway in). */
    fun offsetMs(): Long
    /** The tagged length for library tracks; a transcode pipe may never report one. */
    fun taggedDurationMs(): Long?
    /** Library tracks can always be scrubbed, transcode or not. */
    fun seekable(): Boolean
    fun seekCurrent(positionMs: Long)
}

/**
 * The player the media session sees. A transcoded item's own clock starts at its offset, so positions are
 * shifted back into track time, the tagged duration is reported, and seeks go through the engine (which
 * restarts a transcode at the new offset instead of seeking an unseekable pipe). Lock-screen scrubbing then
 * behaves like the web player's slider.
 */
@UnstableApi
class StreamPlayer(private val exo: Player, private val stream: CurrentStream) : ForwardingPlayer(exo) {
    override fun getCurrentPosition(): Long = exo.currentPosition + stream.offsetMs()
    override fun getContentPosition(): Long = currentPosition
    override fun getBufferedPosition(): Long = exo.bufferedPosition + stream.offsetMs()
    override fun getContentBufferedPosition(): Long = bufferedPosition
    override fun getDuration(): Long = stream.taggedDurationMs() ?: exo.duration
    override fun getContentDuration(): Long = duration

    override fun isCurrentMediaItemSeekable(): Boolean = stream.seekable() || exo.isCurrentMediaItemSeekable

    override fun getAvailableCommands(): Player.Commands {
        val commands = exo.availableCommands
        return if (stream.seekable()) commands.buildUpon().add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM).build() else commands
    }

    override fun isCommandAvailable(command: Int): Boolean =
        (command == Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM && stream.seekable()) || exo.isCommandAvailable(command)

    override fun seekTo(positionMs: Long) = stream.seekCurrent(positionMs)

    override fun seekTo(mediaItemIndex: Int, positionMs: Long) {
        if (mediaItemIndex == exo.currentMediaItemIndex) stream.seekCurrent(positionMs) else exo.seekTo(mediaItemIndex, positionMs)
    }
}
