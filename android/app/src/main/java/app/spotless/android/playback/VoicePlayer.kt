package app.spotless.android.playback

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import app.spotless.android.bridge.BridgeCommand
import app.spotless.android.bridge.BridgeEvent
import java.io.File
import java.io.IOException

/**
 * The AI DJ's voice. Clips play on their own player that never takes audio focus (taking it would pause the
 * music); the engine ducks the music while `onDuck(true)` is in force. "Browser voice" mode uses Android's
 * on-device TextToSpeech. Every speak ends with exactly one Speaking(id, false) and one onDuck(false), however
 * TTS or playback fails; callbacks that belong to an earlier speak are ignored.
 */
class VoicePlayer(
    private val context: Context,
    private val onDuck: (Boolean) -> Unit,
    private val emit: (BridgeEvent) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var currentId: Int? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingText: Pair<Int, String>? = null

    private val player: ExoPlayer = ExoPlayer.Builder(context)
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(),
            false,
        )
        .build()
        .apply {
            addListener(object : Player.Listener {
                // Events are delivered after the fact, so check they still describe the clip of the active speak.
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED && isActiveClip() && playbackState == Player.STATE_ENDED) finish()
                }
                override fun onPlayerError(error: PlaybackException) {
                    if (isActiveClip()) finish()
                }
                private fun isActiveClip() = currentMediaItem?.mediaId == "dj-$currentId"
            })
        }

    fun speak(cmd: BridgeCommand.Speak) {
        // Superseding an active speak: end the old one's event but stay ducked so the music doesn't flicker.
        val alreadyDucked = currentId != null
        halt()
        finish(unduck = false)
        currentId = cmd.id
        if (!alreadyDucked) onDuck(true)
        emit(BridgeEvent.Speaking(cmd.id, true))
        when {
            cmd.audio != null -> playClip(cmd.id, cmd.audio)
            cmd.text != null -> speakText(cmd.id, cmd.text)
            else -> finish()
        }
    }

    fun stop() {
        halt()
        finish()
    }

    private fun halt() {
        player.stop()
        tts?.stop()
        pendingText = null
    }

    fun release() {
        stop()
        player.release()
        tts?.shutdown()
        tts = null
        ttsReady = false
    }

    private fun playClip(id: Int, base64: String) {
        val bytes = runCatching { Base64.decode(base64, Base64.DEFAULT) }.getOrNull() ?: return finish()
        val file = File(context.cacheDir, "dj-voice")
        try {
            file.writeBytes(bytes)
        } catch (_: IOException) {
            return finish()
        }
        player.setMediaItem(MediaItem.Builder().setUri(Uri.fromFile(file)).setMediaId("dj-$id").build())
        player.prepare()
        player.play()
    }

    private fun speakText(id: Int, text: String) {
        val engine = tts
        if (engine != null && ttsReady) {
            if (engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "dj-$id") == TextToSpeech.ERROR) finish()
            return
        }
        pendingText = id to text
        if (engine != null) return // still starting up
        ttsReady = false
        tts = TextToSpeech(context) { status ->
            handler.post {
                val queued = pendingText
                pendingText = null
                if (status == TextToSpeech.SUCCESS) {
                    ttsReady = true
                    if (queued != null && queued.first == currentId) speakText(queued.first, queued.second)
                } else {
                    // Drop the dead engine so the next text speak starts a fresh one instead of waiting forever.
                    tts?.shutdown()
                    tts = null
                    ttsReady = false
                    finish()
                }
            }
        }.apply {
            setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) = finishUtterance(utteranceId)
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) = finishUtterance(utteranceId)
                override fun onStop(utteranceId: String?, interrupted: Boolean) = finishUtterance(utteranceId)
            })
        }
    }

    /** Ends the active speak only if the callback is for its utterance, not an earlier one. */
    private fun finishUtterance(utteranceId: String?) {
        handler.post { if (utteranceId != null && utteranceId == "dj-$currentId") finish() }
    }

    private fun finish(unduck: Boolean = true) {
        val id = currentId ?: return
        currentId = null
        if (unduck) onDuck(false)
        emit(BridgeEvent.Speaking(id, false))
    }
}
