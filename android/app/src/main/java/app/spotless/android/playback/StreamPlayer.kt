package app.spotless.android.playback

import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy

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

    override fun getAvailableCommands(): Player.Commands = augment(exo.availableCommands)

    private fun augment(commands: Player.Commands): Player.Commands =
        if (stream.seekable()) commands.buildUpon().add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM).build() else commands

    override fun isCommandAvailable(command: Int): Boolean =
        (command == Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM && stream.seekable()) || exo.isCommandAvailable(command)

    private val wrapped = HashMap<Player.Listener, Player.Listener>()

    // ForwardingPlayer hands listeners ExoPlayer's raw commands; wrap them so they see ours. Kotlin's `by` delegation
    // skips Java default methods (all of Player.Listener), so a proxy forwards every callback, including future ones.
    private fun withOurCommands(listener: Player.Listener): Player.Listener =
        Proxy.newProxyInstance(Player.Listener::class.java.classLoader, arrayOf(Player.Listener::class.java)) { proxy, method, args ->
            when {
                method.declaringClass == Any::class.java -> when (method.name) {
                    "equals" -> proxy === args[0]
                    "hashCode" -> System.identityHashCode(proxy)
                    else -> "StreamPlayer listener for $listener"
                }
                method.name == "onAvailableCommandsChanged" -> listener.onAvailableCommandsChanged(availableCommands)
                else -> try {
                    method.invoke(listener, *(args ?: emptyArray()))
                } catch (e: InvocationTargetException) {
                    throw e.cause ?: e
                }
            }
        } as Player.Listener

    override fun addListener(listener: Player.Listener) {
        val wrapper = withOurCommands(listener)
        wrapped.put(listener, wrapper)?.let { super.removeListener(it) }
        super.addListener(wrapper)
    }

    override fun removeListener(listener: Player.Listener) {
        super.removeListener(wrapped.remove(listener) ?: listener)
    }

    /** Every seek within the current item lands here, in track time. */
    private fun seekWithinTrack(positionMs: Long) {
        if (!stream.seekable()) return
        stream.seekCurrent(if (positionMs == C.TIME_UNSET) 0 else maxOf(0, positionMs))
    }

    private fun stepTo(positionMs: Long) {
        val duration = duration
        seekWithinTrack(if (duration == C.TIME_UNSET) positionMs else positionMs.coerceIn(0, duration))
    }

    override fun seekTo(positionMs: Long) = seekWithinTrack(positionMs)

    override fun seekTo(mediaItemIndex: Int, positionMs: Long) {
        if (mediaItemIndex == exo.currentMediaItemIndex) seekWithinTrack(positionMs) else exo.seekTo(mediaItemIndex, positionMs)
    }

    override fun seekToDefaultPosition() = seekWithinTrack(0)

    override fun seekToDefaultPosition(mediaItemIndex: Int) {
        if (mediaItemIndex == exo.currentMediaItemIndex) seekWithinTrack(0) else exo.seekToDefaultPosition(mediaItemIndex)
    }

    override fun seekBack() = stepTo(currentPosition - seekBackIncrement)

    override fun seekForward() = stepTo(currentPosition + seekForwardIncrement)

    override fun seekToPrevious() {
        // Same rule as Player, but on track time: past the threshold (or nowhere to go back to) restarts the track.
        val canSkip = exo.hasPreviousMediaItem() && (!stream.seekable() || currentPosition <= maxSeekToPreviousPosition)
        if (canSkip) exo.seekToPreviousMediaItem() else seekWithinTrack(0)
    }
}
