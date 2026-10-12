package app.spotless.android.playback

import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

@UnstableApi
class StreamPlayerTest {
    private class FakeStream(
        var offset: Long = 0,
        var tagged: Long? = null,
        var seekable: Boolean = true,
    ) : CurrentStream {
        val seeks = mutableListOf<Long>()
        override fun offsetMs() = offset
        override fun taggedDurationMs() = tagged
        override fun seekable() = seekable
        override fun seekCurrent(positionMs: Long) { seeks += positionMs }
    }

    /** Configurable values plus a record of every call that reaches the wrapped player. */
    private class Exo {
        var position = 0L
        var buffered = 0L
        var duration = C.TIME_UNSET
        var index = 0
        var hasPrevious = false
        var maxSeekToPrevious = 3000L
        var seekBackIncrement = 5000L
        var seekForwardIncrement = 15000L
        var commands: Player.Commands = Player.Commands.EMPTY
        val calls = mutableListOf<String>()
        val listeners = mutableListOf<Player.Listener>()

        val player: Player = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, method, args ->
            when (method.name) {
                "getCurrentPosition" -> position
                "getBufferedPosition" -> buffered
                "getDuration" -> duration
                "getCurrentMediaItemIndex" -> index
                "hasPreviousMediaItem" -> hasPrevious
                "getMaxSeekToPreviousPosition" -> maxSeekToPrevious
                "getSeekBackIncrement" -> seekBackIncrement
                "getSeekForwardIncrement" -> seekForwardIncrement
                "getAvailableCommands" -> commands
                "isCommandAvailable" -> commands.contains(args[0] as Int)
                "isCurrentMediaItemSeekable" -> false
                "addListener" -> { listeners += args[0] as Player.Listener; null }
                "removeListener" -> { listeners -= args[0] as Player.Listener; null }
                "seekTo", "seekToDefaultPosition", "seekToPreviousMediaItem", "seekToPrevious", "seekBack", "seekForward" -> {
                    calls += method.name + (args?.joinToString(",", "(", ")") ?: "()")
                    null
                }
                else -> when (method.returnType) {
                    java.lang.Boolean.TYPE -> false
                    Integer.TYPE -> 0
                    java.lang.Long.TYPE -> 0L
                    java.lang.Float.TYPE -> 0f
                    else -> null
                }
            }
        } as Player
    }

    private val exo = Exo()
    private val stream = FakeStream()
    private val player = StreamPlayer(exo.player, stream)

    @Test fun `position and duration are in track time`() {
        stream.offset = 120_000
        stream.tagged = 300_000
        exo.position = 5_000
        exo.buffered = 9_000
        exo.duration = C.TIME_UNSET
        assertEquals(125_000, player.currentPosition)
        assertEquals(125_000, player.contentPosition)
        assertEquals(129_000, player.bufferedPosition)
        assertEquals(300_000, player.duration)
    }

    @Test fun `duration falls back to the wrapped player when untagged`() {
        exo.duration = 42_000
        assertEquals(42_000, player.duration)
    }

    @Test fun `seekToPrevious restarts the track when far enough in track time`() {
        stream.offset = 120_000
        exo.position = 5_000 // 125 s in track time, though the stream is only 5 s old
        exo.hasPrevious = true
        player.seekToPrevious()
        assertEquals(listOf(0L), stream.seeks)
        assertFalse(exo.calls.any { it.startsWith("seekToPreviousMediaItem") })
    }

    @Test fun `seekToPrevious goes to the previous item when near the start`() {
        exo.position = 1_000
        exo.hasPrevious = true
        player.seekToPrevious()
        assertEquals(listOf("seekToPreviousMediaItem()"), exo.calls)
        assertTrue(stream.seeks.isEmpty())
    }

    @Test fun `seekToPrevious restarts when there is no previous item`() {
        exo.position = 1_000
        exo.hasPrevious = false
        player.seekToPrevious()
        assertEquals(listOf(0L), stream.seeks)
        assertTrue(exo.calls.isEmpty())
    }

    @Test fun `seekToPrevious skips back when the current item cannot be scrubbed`() {
        stream.seekable = false
        exo.position = 90_000
        exo.hasPrevious = true
        player.seekToPrevious()
        assertEquals(listOf("seekToPreviousMediaItem()"), exo.calls)
        assertTrue(stream.seeks.isEmpty())
    }

    @Test fun `seekBack and seekForward step from the shifted position`() {
        stream.offset = 120_000
        stream.tagged = 300_000
        exo.position = 5_000
        player.seekBack()
        player.seekForward()
        assertEquals(listOf(120_000L, 140_000L), stream.seeks)
    }

    @Test fun `seekBack clamps at zero and seekForward at the duration`() {
        stream.tagged = 20_000
        exo.position = 2_000
        player.seekBack()
        exo.position = 18_000
        player.seekForward()
        assertEquals(listOf(0L, 20_000L), stream.seeks)
    }

    @Test fun `seekForward is not clamped when the duration is unknown`() {
        exo.position = 18_000
        player.seekForward()
        assertEquals(listOf(33_000L), stream.seeks)
    }

    @Test fun `seekToDefaultPosition restarts the current item`() {
        exo.index = 2
        player.seekToDefaultPosition()
        player.seekToDefaultPosition(2)
        assertEquals(listOf(0L, 0L), stream.seeks)
        assertTrue(exo.calls.isEmpty())
    }

    @Test fun `seekToDefaultPosition of another item goes to the wrapped player`() {
        exo.index = 2
        player.seekToDefaultPosition(5)
        assertEquals(listOf("seekToDefaultPosition(5)"), exo.calls)
        assertTrue(stream.seeks.isEmpty())
    }

    @Test fun `seekTo normalises unset and negative positions to zero`() {
        player.seekTo(C.TIME_UNSET)
        player.seekTo(-500)
        player.seekTo(0, C.TIME_UNSET)
        player.seekTo(0, -1)
        player.seekTo(7_000)
        assertEquals(listOf(0L, 0L, 0L, 0L, 7_000L), stream.seeks)
    }

    @Test fun `seekTo another item goes to the wrapped player untouched`() {
        exo.index = 0
        player.seekTo(3, 1_500)
        assertEquals(listOf("seekTo(3,1500)"), exo.calls)
        assertTrue(stream.seeks.isEmpty())
    }

    @Test fun `an unseekable current item ignores seeks`() {
        stream.seekable = false
        exo.position = 10_000
        player.seekTo(5_000)
        player.seekTo(0, 5_000)
        player.seekBack()
        player.seekForward()
        player.seekToDefaultPosition()
        player.seekToDefaultPosition(0)
        assertTrue(stream.seeks.isEmpty())
        assertTrue(exo.calls.isEmpty())
    }

    // FlagSet is backed by android.util.SparseBooleanArray (a no-op stub on the JVM), so commands are compared
    // by identity rather than by contents.
    @Test fun `a wrapped listener receives the player's commands, not the raw ones`() {
        val mine = Player.Commands.Builder().build()
        val raw = Player.Commands.Builder().build()
        exo.commands = mine
        stream.seekable = false // augmenting is then the identity, so the listener must get exactly exo's commands
        val received = mutableListOf<Player.Commands>()
        val listener = object : Player.Listener {
            override fun onAvailableCommandsChanged(availableCommands: Player.Commands) { received += availableCommands }
        }
        player.addListener(listener)
        assertEquals(1, exo.listeners.size)
        exo.listeners.single().onAvailableCommandsChanged(raw)
        assertEquals(1, received.size)
        assertSame(player.availableCommands, received.single())
        assertNotSame(raw, received.single())
    }

    @Test fun `a wrapped listener still gets the other callbacks`() {
        var forwarded = 0
        val listener = object : Player.Listener {
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) { forwarded++ }
        }
        player.addListener(listener)
        exo.listeners.single().onPlayWhenReadyChanged(true, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
        assertEquals(1, forwarded)
    }

    @Test fun `removeListener detaches the wrapper`() {
        val listener = object : Player.Listener {}
        player.addListener(listener)
        player.removeListener(listener)
        assertTrue(exo.listeners.isEmpty())
    }
}
