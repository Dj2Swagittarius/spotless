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

/**
 * The AI DJ's voice. Clips play on their own player that never takes audio focus (taking it would pause the
 * music); the engine ducks the music while `onDuck(true)` is in force. "Browser voice" mode uses Android's
 * on-device TextToSpeech. Every speak ends with exactly one Speaking(id, false).
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
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED) finish()
                }
                override fun onPlayerError(error: PlaybackException) = finish()
            })
        }

    fun speak(cmd: BridgeCommand.Speak) {
        stop()
        currentId = cmd.id
        onDuck(true)
        emit(BridgeEvent.Speaking(cmd.id, true))
        when {
            cmd.audio != null -> playClip(cmd.audio)
            cmd.text != null -> speakText(cmd.id, cmd.text)
            else -> finish()
        }
    }

    fun stop() {
        player.stop()
        tts?.stop()
        pendingText = null
        finish()
    }

    fun release() {
        stop()
        player.release()
        tts?.shutdown()
        tts = null
    }

    private fun playClip(base64: String) {
        val bytes = runCatching { Base64.decode(base64, Base64.DEFAULT) }.getOrNull() ?: return finish()
        val file = File(context.cacheDir, "dj-voice")
        file.writeBytes(bytes)
        player.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
        player.prepare()
        player.play()
    }

    private fun speakText(id: Int, text: String) {
        val engine = tts
        if (engine != null && ttsReady) {
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "dj-$id")
            return
        }
        pendingText = id to text
        if (engine != null) return // still starting up
        tts = TextToSpeech(context) { status ->
            handler.post {
                ttsReady = status == TextToSpeech.SUCCESS
                val queued = pendingText
                pendingText = null
                if (!ttsReady) finish() else if (queued != null && queued.first == currentId) speakText(queued.first, queued.second)
            }
        }.apply {
            setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { handler.post { finish() } }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { handler.post { finish() } }
            })
        }
    }

    private fun finish() {
        val id = currentId ?: return
        currentId = null
        onDuck(false)
        emit(BridgeEvent.Speaking(id, false))
    }
}
