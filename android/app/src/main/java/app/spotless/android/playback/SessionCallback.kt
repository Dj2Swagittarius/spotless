package app.spotless.android.playback

import android.os.Bundle
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
class SessionCallback(private val engine: PlaybackEngine, private val ownPackage: String) : MediaSession.Callback {
    val ownControllers = LinkedHashSet<MediaSession.ControllerInfo>()

    private val command = SessionCommand(BridgeJson.CMD, Bundle.EMPTY)

    override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
        if (controller.packageName != ownPackage) return super.onConnect(session, controller)
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
        if (customCommand.customAction == BridgeJson.CMD && controller.packageName == ownPackage) {
            args.getString(BridgeJson.KEY)?.let(BridgeJson::parseCommand)?.let(engine::handle)
        }
        return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    override fun onPlaybackResumption(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = engine.resumption()
}
