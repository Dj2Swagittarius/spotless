package app.spotless.android.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.core.os.bundleOf
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import app.spotless.android.bridge.BridgeEvent
import app.spotless.android.bridge.BridgeJson
import app.spotless.android.graph
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors

/** Hosts the engine and the media session: notification, lock screen, Bluetooth, Wear OS. */
@UnstableApi
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private lateinit var engine: PlaybackEngine
    private lateinit var callback: SessionCallback

    override fun onCreate() {
        super.onCreate()
        engine = PlaybackEngine(this, graph, ::sendEvent)
        callback = SessionCallback(engine, packageName)
        val openApp = packageManager.getLaunchIntentForPackage(packageName)
            ?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
        // artwork needs the session cookie, so it loads through the same OkHttp client as the audio
        val bitmaps = CacheBitmapLoader(
            DataSourceBitmapLoader(
                MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor()),
                OkHttpDataSource.Factory(graph.http),
            ),
        )
        session = MediaSession.Builder(this, engine.player)
            .setCallback(callback)
            .setBitmapLoader(bitmaps)
            .apply { openApp?.let(::setSessionActivity) }
            .build()
        engine.start()
    }

    private fun sendEvent(event: BridgeEvent) {
        val s = session ?: return
        val args = bundleOf(BridgeJson.KEY to BridgeJson.encode(event))
        val command = SessionCommand(BridgeJson.EVT, Bundle.EMPTY)
        callback.ownControllers.forEach { s.sendCustomCommand(it, command, args) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        engine.release()
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}
