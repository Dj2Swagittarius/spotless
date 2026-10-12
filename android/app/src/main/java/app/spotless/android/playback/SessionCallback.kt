package app.spotless.android.playback

import android.os.Bundle
import android.os.Process
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import app.spotless.android.bridge.BridgeJson
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Only controllers from this app (the activity's bridge, Media3's own notification controller) get the
 * Spotless commands; everyone else — system UI, watches, other apps — gets the standard media commands.
 */
@UnstableApi
class SessionCallback(private val engine: PlaybackEngine) : MediaSession.Callback {
    val ownControllers = LinkedHashSet<MediaSession.ControllerInfo>()

    private val command = SessionCommand(BridgeJson.CMD, Bundle.EMPTY)

    private fun isOwn(controller: MediaSession.ControllerInfo) = controller.uid == Process.myUid()

    override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
        if (!isOwn(controller)) {
            // other apps get transport controls only: changing the playlist behind the engine's back would
            // desync its queue mirror and stream arbitrary URIs through the signed-in client
            val transport = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
                .removeAll(Player.COMMAND_SET_MEDIA_ITEM, Player.COMMAND_CHANGE_MEDIA_ITEMS)
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailablePlayerCommands(transport).build()
        }
        ownControllers += controller
        val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(command).build()
        return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands).build()
    }

    override fun onDisconnected(session: MediaSession, controller: MediaSession.ControllerInfo) {
        ownControllers -= controller
    }

    override fun onCustomCommand(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
        customCommand: SessionCommand,
        args: Bundle,
    ): ListenableFuture<SessionResult> {
        if (customCommand.customAction == BridgeJson.CMD && isOwn(controller)) {
            args.getString(BridgeJson.KEY)?.let(BridgeJson::parseCommand)?.let(engine::handle)
        }
        return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    override fun onPlaybackResumption(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = engine.resumption()
}
