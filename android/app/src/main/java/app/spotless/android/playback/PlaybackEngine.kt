package app.spotless.android.playback

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import app.spotless.android.AppGraph
import app.spotless.android.bridge.BridgeCommand
import app.spotless.android.bridge.BridgeEvent
import app.spotless.android.bridge.TrackDto
import app.spotless.android.playback.eq.EqAudioProcessor
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * Owns playback in the app: the ExoPlayer, the queue mirror, and everything the web player did on top of an
 * <audio> element — ReplayGain, EQ, adaptive quality, stall recovery, history, sleep timer and DJ voice.
 * Lives in the playback service and runs on the main thread.
 */
@UnstableApi
class PlaybackEngine(
    private val context: Context,
    private val graph: AppGraph,
    private val emit: (BridgeEvent) -> Unit,
) : Player.Listener, CurrentStream {

    private class ItemInfo(val track: TrackDto, var spec: StreamSpec, var restreams: Int = 0)

    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val eq = EqAudioProcessor()
    private val exo: ExoPlayer = buildExo()
    val player = StreamPlayer(exo, this)

    private val queue = QueueModel()
    private val quality = QualityPolicy { SystemClock.elapsedRealtime() }
    private val tracker = PlayTracker()
    private val sessions = SessionStore(context)
    private val voice = VoicePlayer(context, onDuck = { ducked -> speechDuck = if (ducked) Levels.DUCK_GAIN else 1.0; applyVolume() }, emit = emit)
    private val network = NetworkWatcher(context) { info -> handler.post { onNetwork(info) } }

    /** Per media item (keyed by MediaItem.mediaId): the track and the stream it is playing. */
    private val items = HashMap<String, ItemInfo>()
    private var nextUid = 0
    private var currentId: String? = null
    private var playedThisStream = false

    /** Media id of an early-ended transcode we are returning to; the hop to the next track and back is not a new play. */
    private var pendingReturn: String? = null

    /** Failed or unplayable tracks in a row since playback last actually started. */
    private var consecutiveFailures = 0
    private var volume = 1.0
    private var duck = 1.0
    private var speechDuck = 1.0
    private var lastSwitchAt = 0L
    private var sleepUntil: Long? = null
    private var ticks = 0

    private fun now() = SystemClock.elapsedRealtime()

    init {
        // Registered at construction, not in start(): StreamPlayer forwards onAvailableCommandsChanged to the media
        // session's listener and reads CurrentStream.seekable(), so currentId must be updated before that listener runs.
        exo.addListener(this)
    }

    private fun buildExo(): ExoPlayer {
        val renderers = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean,
            ): AudioSink = DefaultAudioSink.Builder(context).setAudioProcessors(arrayOf(eq)).build()
        }
        val sources = DefaultMediaSourceFactory(OkHttpDataSource.Factory(graph.http))
        return ExoPlayer.Builder(context, renderers, sources)
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true, // pause for calls, duck for navigation prompts
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
    }

    fun start() {
        network.start()
        scope.launch { graph.authLost.collect { exo.pause(); emit(BridgeEvent.AuthLost) } }
        scope.launch { restore() }
    }

    fun release() {
        saveNow()
        handler.removeCallbacksAndMessages(null)
        network.stop()
        voice.release()
        exo.removeListener(this)
        scope.cancel()
    }

    // ---------------------------------------------------------------------------------------------
    // Commands from the page

    fun handle(cmd: BridgeCommand) {
        when (cmd) {
            BridgeCommand.Hello, BridgeCommand.ChangeServer -> Unit // answered by the activity
            BridgeCommand.GetState -> { emitQueue(); emitState() }
            is BridgeCommand.SetQueue -> replaceAll(cmd.tracks, cmd.index, cmd.positionMs, cmd.play)
            is BridgeCommand.SyncQueue -> when (val change = queue.sync(cmd.tracks, cmd.index, cmd.baseVersion)) {
                QueueChange.Rejected -> emitQueue()
                is QueueChange.Replace -> replaceAll(change.tracks, change.index, 0, null)
                is QueueChange.Around -> {
                    val cur = exo.currentMediaItemIndex
                    exo.replaceMediaItems(cur + 1, exo.mediaItemCount, change.after.map { buildItem(it) })
                    exo.replaceMediaItems(0, cur, change.before.map { buildItem(it) })
                    pruneItems()
                    persistSoon()
                    emitState()
                }
            }
            BridgeCommand.Play -> play()
            BridgeCommand.Pause -> exo.pause()
            is BridgeCommand.Seek -> seekCurrent(cmd.positionMs)
            BridgeCommand.Next -> if (exo.hasNextMediaItem()) { exo.seekToNextMediaItem(); play() } else exo.pause()
            BridgeCommand.Prev -> { if (exo.hasPreviousMediaItem()) exo.seekToPreviousMediaItem() else seekCurrent(0); play() }
            is BridgeCommand.JumpTo -> if (cmd.index in 0 until exo.mediaItemCount) { exo.seekTo(cmd.index, 0); play() }
            is BridgeCommand.SetRepeat -> { exo.repeatMode = repeatOf(cmd.mode); persistSoon() }
            is BridgeCommand.SetVolume -> { volume = cmd.value.coerceIn(0.0, 1.0); applyVolume() }
            is BridgeCommand.SetDuck -> { duck = cmd.value.coerceIn(0.0, 1.0); applyVolume() }
            is BridgeCommand.SetEq -> eq.update(cmd.enabled, cmd.gains.toDoubleArray())
            is BridgeCommand.SetQuality -> { quality.setting = cmd.value; refreshNext() }
            is BridgeCommand.SetSleepTimer -> setSleep(cmd.minutes)
            is BridgeCommand.Speak -> voice.speak(cmd)
            BridgeCommand.StopSpeaking -> voice.stop()
        }
    }

    private fun play() {
        when (exo.playbackState) {
            Player.STATE_IDLE -> exo.prepare()
            Player.STATE_ENDED -> exo.seekTo(exo.currentMediaItemIndex.coerceAtLeast(0), 0)
        }
        exo.play()
    }

    private fun replaceAll(tracks: List<TrackDto>, index: Int, positionMs: Long, play: Boolean?) {
        val wasPlaying = exo.playWhenReady
        queue.set(tracks, index)
        items.clear()
        currentId = null
        pendingReturn = null
        consecutiveFailures = 0
        if (queue.index < 0) {
            exo.clearMediaItems()
        } else {
            exo.setMediaItems(tracks.map { buildItem(it) }, queue.index, positionMs)
            // a restored queue waits paused without fetching anything until the first play
            if (play ?: wasPlaying) { exo.prepare(); exo.play() } else exo.pause()
        }
        persistSoon()
        emitState()
    }

    private fun buildItem(track: TrackDto, rung: Rung = quality.current(), offsetSec: Double = 0.0, reuseId: String? = null): MediaItem {
        val origin = graph.origin.orEmpty()
        val id = reuseId ?: "t${track.id}#${nextUid++}"
        val spec = TrackUrls.stream(origin, track, rung, offsetSec)
        val existing = items[id]
        if (existing != null) existing.spec = spec else items[id] = ItemInfo(track, spec)
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setArtworkUri(TrackUrls.artwork(origin, track)?.let(Uri::parse))
            .setDurationMs(if (track.duration > 0 && track.streamUrl == null) (track.duration * 1000).toLong() else null)
            .setIsPlayable(track.isPlayable)
            .setIsBrowsable(false)
            .build()
        return MediaItem.Builder().setMediaId(id).setUri(spec.url).setMediaMetadata(metadata).build()
    }

    /** Forget items that are no longer in the playlist. */
    private fun pruneItems() {
        val live = (0 until exo.mediaItemCount).map { exo.getMediaItemAt(it).mediaId }.toSet()
        items.keys.retainAll(live)
    }

    private fun repeatOf(mode: String) = when (mode) {
        "all" -> Player.REPEAT_MODE_ALL
        "one" -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
    }

    private fun repeatName() = when (exo.repeatMode) {
        Player.REPEAT_MODE_ALL -> "all"
        Player.REPEAT_MODE_ONE -> "one"
        else -> "off"
    }

    // ---------------------------------------------------------------------------------------------
    // CurrentStream (used by StreamPlayer)

    private fun current(): ItemInfo? = currentId?.let(items::get)

    override fun offsetMs(): Long = ((current()?.spec?.offsetSec ?: 0.0) * 1000).toLong()

    override fun taggedDurationMs(): Long? =
        current()?.track?.takeIf { it.streamUrl == null && it.duration > 0 }?.let { (it.duration * 1000).toLong() }

    override fun seekable(): Boolean = current()?.track?.isLibrary == true

    override fun seekCurrent(positionMs: Long) {
        val info = current() ?: return
        if (info.track.streamUrl != null) return // live: nothing to seek
        tracker.onJump()
        lastSwitchAt = now()
        val rung = info.spec.rung
        if (rung != null && rung.bitrate > 0) restreamCurrent(rung, positionMs / 1000.0, countRetry = false)
        else exo.seekTo(positionMs)
        emitState()
    }

    // ---------------------------------------------------------------------------------------------
    // Adaptive quality and recovery (the restream logic of Player.tsx)

    private fun positionSec() = player.currentPosition / 1000.0

    /**
     * Reload the current item at `rung`, resuming at `atSec`. A transcode restarts at that offset; the
     * original file seeks. Counted reloads respect the switch cooldown and the per-track cap.
     */
    private fun restreamCurrent(rung: Rung, atSec: Double, countRetry: Boolean): Boolean {
        val id = currentId ?: return false
        val info = items[id] ?: return false
        if (info.track.streamUrl != null) return false
        if (countRetry) {
            if (!canRestream(info)) return false
            info.restreams++
        }
        val rungChanged = info.spec.rung != rung
        lastSwitchAt = now()
        playedThisStream = false
        tracker.onJump()
        val index = exo.currentMediaItemIndex
        val wasPlaying = exo.playWhenReady
        exo.replaceMediaItem(index, buildItem(info.track, rung, atSec, reuseId = id))
        exo.seekTo(index, if (rung.bitrate == 0) (atSec * 1000).toLong() else 0L)
        exo.prepare()
        exo.playWhenReady = wasPlaying
        // the new stream may stall before it plays, and the state staying BUFFERING raises no event: re-arm the watchdog
        handler.removeCallbacks(startStall)
        if (wasPlaying) handler.postDelayed(startStall, START_STALL_MS)
        if (rungChanged) refreshNext()
        return true
    }

    /** Whether a counted reload is allowed right now: past the switch cooldown and under the per-track cap. */
    private fun canRestream(info: ItemInfo) =
        now() - lastSwitchAt >= SWITCH_COOLDOWN_MS && info.restreams < MAX_RESTREAMS_PER_TRACK

    /** The rung a retry of this item should use: Auto re-evaluates, a fixed setting keeps the item's own. */
    private fun retryRung(info: ItemInfo): Rung = if (quality.isAuto) quality.current() else info.spec.rung ?: quality.current()

    /**
     * Where a library transcode stopped (track seconds) if it ended more than 5 s short of the tagged duration,
     * i.e. the pipe died cleanly and it only looks like the song ended; null when it really ended.
     */
    private fun endedEarlyAt(info: ItemInfo, streamPositionMs: Long): Double? {
        val rung = info.spec.rung ?: return null
        if (!info.track.isLibrary || rung.bitrate == 0 || info.track.duration <= 0) return null
        val endedAt = info.spec.offsetSec + streamPositionMs / 1000.0
        return endedAt.takeIf { info.track.duration - it > 5 }
    }

    /**
     * Quality follows the setting for the track queued after the current one: rebuild it (library tracks only,
     * from the start) if it was built at another rung. The playing track is never reloaded for this.
     */
    private fun refreshNext() {
        val index = exo.nextMediaItemIndex
        if (index == C.INDEX_UNSET || index == exo.currentMediaItemIndex) return
        val id = exo.getMediaItemAt(index).mediaId
        val info = items[id] ?: return
        val rung = quality.current()
        if (!info.track.isLibrary || info.spec.rung == rung) return
        exo.replaceMediaItem(index, buildItem(info.track, rung, 0.0, reuseId = id))
    }

    /** A genuine rebuffer: score it (Auto walks down) and reload where a reload can help. */
    private fun recoverStall() {
        val info = current() ?: return
        val have = info.spec.rung ?: return
        if (quality.isAuto) quality.noteStall()
        val target = if (quality.isAuto) quality.current() else have
        if (!QualityPolicy.isLower(target, have) && have.bitrate == 0) return // the original file re-buffers by itself
        restreamCurrent(target, positionSec(), countRetry = true)
    }

    /** Nothing audible this long after a stream started: treat it as a stall after all. */
    private val startStall = Runnable {
        if (exo.playWhenReady && exo.playbackState == Player.STATE_BUFFERING && !playedThisStream) recoverStall()
    }

    private fun onNetwork(info: NetworkInfo) {
        quality.network = info
        if (!quality.isAuto) return
        val have = current()?.spec?.rung
        val want = quality.current()
        // only ever reload the playing track to go down; an upgrade (or a downgrade the cooldown declined)
        // still reaches the track queued next
        if (have != null && QualityPolicy.isLower(want, have)) restreamCurrent(want, positionSec(), countRetry = true)
        refreshNext()
    }

    /** Consecutive failures after which we stop skipping and wait for the user (a short queue is capped by its size). */
    private fun failureLimit() = minOf(exo.mediaItemCount, MAX_SKIPS_IN_A_ROW)

    /** Report the track and stop where it is; the next Play re-prepares it. */
    private fun pauseFailed(info: ItemInfo?) {
        info?.let { emit(BridgeEvent.TrackError(it.track.id, "could not be played")) }
        exo.pause()
        emitState()
    }

    private fun skipFailed(info: ItemInfo?) {
        info?.let { emit(BridgeEvent.TrackError(it.track.id, "could not be played")) }
        if (exo.hasNextMediaItem()) {
            exo.seekToNextMediaItem()
            exo.prepare()
        } else {
            exo.pause()
        }
        emitState()
    }

    // ---------------------------------------------------------------------------------------------
    // Player.Listener

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        val id = mediaItem?.mediaId
        pendingReturn?.let { returning ->
            if (id == returning) {
                // back on the track whose transcode died: it is being restreamed, not newly played
                pendingReturn = null
                applyVolume()
                emitState()
                return
            }
            if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) return // only passing through on the way back
            pendingReturn = null // something else took over
        }
        // a restream replaced the playing item with itself: not a new play
        if (id != null && id == currentId && reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) {
            applyVolume()
            emitState()
            return
        }
        currentId = id
        queue.index = if (exo.mediaItemCount > 0) exo.currentMediaItemIndex else -1
        handler.removeCallbacks(startStall)
        // a gapless hop is already playing; anything else has to start before the first rebuffer counts
        playedThisStream = exo.isPlaying && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
        val info = id?.let(items::get)
        if (info == null) { emitState(); return }
        if (!info.track.isPlayable) {
            // a placeholder counts as a failure so a queue of them cannot skip forever
            if (++consecutiveFailures >= failureLimit()) exo.pause()
            else handler.post { if (exo.hasNextMediaItem()) exo.seekToNextMediaItem() else exo.pause() }
            emitState()
            return
        }
        info.restreams = 0
        if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED && info.spec.offsetSec > 0) {
            // a transcode built partway in (restored, or restreamed earlier) was reached again: start it from the top
            handler.post { if (currentId == id) restreamCurrent(info.spec.rung ?: quality.current(), 0.0, countRetry = false) }
        }
        tracker.begin(info.track.id, info.track.duration, info.track.isLibrary)
        if (exo.isPlaying) tracker.onPlaying()?.let(::report)
        applyVolume()
        emitState()
        persistSoon()
        refreshNext()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        handler.removeCallbacks(tick)
        if (isPlaying) {
            playedThisStream = true
            consecutiveFailures = 0
            handler.removeCallbacks(startStall)
            tracker.onPlaying()?.let(::report)
            handler.postDelayed(tick, 1000)
        }
        emitState()
        persistSoon()
    }

    override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_BUFFERING && exo.playWhenReady) {
            val info = current()
            if (info != null && info.track.streamUrl == null) {
                if (!playedThisStream) {
                    handler.removeCallbacks(startStall)
                    handler.postDelayed(startStall, START_STALL_MS)
                } else if (now() - lastSwitchAt >= STALL_GRACE_MS) {
                    recoverStall()
                }
            }
        }
        if (state == Player.STATE_READY) handler.removeCallbacks(startStall)
        if (state == Player.STATE_ENDED && restreamEndedEarly()) return
        emitState()
    }

    override fun onPlayerError(error: PlaybackException) {
        val info = current()
        if (isUnauthorized(error)) return // AuthInterceptor already reported it; the next play re-prepares
        val unsupported = error.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
            error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED
        if (info != null && info.track.streamUrl == null && !unsupported) {
            if (quality.isAuto) quality.noteStall()
            if (restreamCurrent(retryRung(info), positionSec(), countRetry = true)) return
        }
        consecutiveFailures++
        // no connection: the next track would fail too, so wait for the user instead of skipping through the queue
        val offline = error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
            error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
        if (offline || consecutiveFailures >= failureLimit()) pauseFailed(info) else skipFailed(info)
    }

    /** A 401 anywhere in the cause chain (the data source wraps it). */
    private fun isUnauthorized(error: Throwable) =
        generateSequence(error) { it.cause }.any { it is HttpDataSource.InvalidResponseCodeException && it.responseCode == 401 }

    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
        if (reason != Player.DISCONTINUITY_REASON_AUTO_TRANSITION) return
        // a transcode pipe that died cleanly reads as the song ending early: go back and pick it up
        val id = oldPosition.mediaItem?.mediaId ?: return
        val info = items[id] ?: return
        val endedAt = endedEarlyAt(info, oldPosition.positionMs) ?: return
        if (!canRestream(info)) return
        // recorded now: ExoPlayer announces the hop to the next track right after this, and it must not count as a play
        pendingReturn = id
        handler.post {
            if (currentId != id) return@post // overtaken by another change
            exo.seekTo(oldPosition.mediaItemIndex, 0)
            pendingReturn = null
            restreamCurrent(retryRung(info), endedAt, countRetry = true)
        }
    }

    /** The final track's transcode died early: nothing follows it, so reload it where it stopped. */
    private fun restreamEndedEarly(): Boolean {
        val info = current() ?: return false
        val endedAt = endedEarlyAt(info, exo.currentPosition) ?: return false
        return canRestream(info) && restreamCurrent(retryRung(info), endedAt, countRetry = true)
    }

    override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) {
        // the playlist was cleared from outside the page (Change server, a controller's stop + clear)
        if (exo.mediaItemCount == 0 && queue.tracks.isNotEmpty()) {
            queue.replaceFromNative(emptyList(), -1)
            items.clear()
            currentId = null
            emitQueue()
            persistSoon()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Volume, history, sleep timer

    private fun applyVolume() {
        exo.volume = Levels.level(volume, duck * speechDuck, current()?.track?.gain).toFloat()
    }

    private fun report(r: HistoryReport) = graph.api.postHistory(r.trackId, r.event.wire, r.startedAt)

    private val tick = object : Runnable {
        override fun run() {
            tracker.onPosition(positionSec())?.let(::report)
            emitState()
            if (++ticks % 10 == 0) saveNow()
            if (exo.isPlaying) handler.postDelayed(this, 1000)
        }
    }

    private val sleepFire = Runnable {
        exo.pause()
        sleepUntil = null
        emitState()
    }

    private fun setSleep(minutes: Int) {
        handler.removeCallbacks(sleepFire)
        sleepUntil = if (minutes > 0) System.currentTimeMillis() + minutes * 60_000L else null
        if (minutes > 0) handler.postDelayed(sleepFire, minutes * 60_000L)
        emitState()
    }

    // ---------------------------------------------------------------------------------------------
    // Events to the page

    private fun isPlayingNow(): Boolean {
        val state = exo.playbackState
        return exo.playWhenReady && (state == Player.STATE_READY || state == Player.STATE_BUFFERING)
    }

    private fun emitState() {
        val duration = player.duration
        emit(
            BridgeEvent.State(
                isPlaying = isPlayingNow(),
                index = if (exo.mediaItemCount > 0) exo.currentMediaItemIndex else -1,
                positionMs = player.currentPosition.coerceAtLeast(0),
                durationMs = if (duration == C.TIME_UNSET || duration < 0) 0 else duration,
                buffering = exo.playbackState == Player.STATE_BUFFERING,
                queueVersion = queue.version,
                sleepUntil = sleepUntil,
            ),
        )
    }

    private fun emitQueue() {
        emit(BridgeEvent.Queue(queue.tracks, queue.index, queue.version, player.currentPosition.coerceAtLeast(0), isPlayingNow()))
    }

    // ---------------------------------------------------------------------------------------------
    // Session persistence and resumption

    private val persistRunnable = Runnable { saveNow() }

    private fun persistSoon() {
        handler.removeCallbacks(persistRunnable)
        handler.postDelayed(persistRunnable, 1000)
    }

    private fun saveNow() {
        val (tracks, index) = QueueModel.trimForPersist(queue.tracks, queue.index)
        val snapshot = SessionSnapshot(
            tracks = tracks,
            index = index,
            positionMs = if (index >= 0) player.currentPosition.coerceAtLeast(0) else 0,
            repeat = repeatName(),
            version = queue.version,
        )
        graph.appScope.launch {
            try {
                sessions.save(snapshot)
            } catch (_: IOException) {
                // best effort: the next save will try again
            }
        }
    }

    /** Put the last session back, paused, if nothing is queued yet. */
    private suspend fun restore() {
        if (exo.mediaItemCount > 0) return
        val snap = sessions.load() ?: return
        if (snap.tracks.isEmpty() || snap.index < 0 || exo.mediaItemCount > 0) return
        val index = snap.index.coerceIn(0, snap.tracks.lastIndex)
        queue.replaceFromNative(snap.tracks, index)
        exo.repeatMode = repeatOf(snap.repeat)
        val rung = quality.current()
        val atSec = snap.positionMs / 1000.0
        val media = snap.tracks.mapIndexed { i, t -> if (i == index) buildItem(t, rung, atSec) else buildItem(t) }
        exo.setMediaItems(media, index, if (rung.bitrate == 0) snap.positionMs else 0)
        emitQueue()
        emitState()
    }

    /** For MediaSession.Callback.onPlaybackResumption (Bluetooth "play" after a restart, the resume card). */
    fun resumption(): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = scope.future {
        if (exo.mediaItemCount == 0) restore()
        val media = (0 until exo.mediaItemCount).map(exo::getMediaItemAt)
        MediaSession.MediaItemsWithStartPosition(media, exo.currentMediaItemIndex.coerceAtLeast(0), exo.currentPosition)
    }

    companion object {
        const val SWITCH_COOLDOWN_MS = 8_000L
        const val STALL_GRACE_MS = 4_000L
        const val START_STALL_MS = 12_000L
        const val MAX_RESTREAMS_PER_TRACK = 4
        const val MAX_SKIPS_IN_A_ROW = 5
    }
}
