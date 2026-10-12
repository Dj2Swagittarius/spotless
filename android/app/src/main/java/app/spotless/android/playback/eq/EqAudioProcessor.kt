package app.spotless.android.playback.eq

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer

/** Runs EqFilterBank inside ExoPlayer's audio sink. Only PCM16 is processed; anything else passes through. */
@UnstableApi
class EqAudioProcessor : BaseAudioProcessor() {
    private class Settings(val enabled: Boolean, val gains: DoubleArray)

    @Volatile private var settings = Settings(false, DoubleArray(10))
    private var applied: Settings? = null
    private var bank: EqFilterBank? = null
    private var scratch = ShortArray(0)

    /** Called from the main thread; picked up by the audio thread on the next buffer. */
    fun update(enabled: Boolean, gains: DoubleArray) {
        settings = Settings(enabled, gains.copyOf())
    }

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat =
        if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT) inputAudioFormat else AudioProcessor.AudioFormat.NOT_SET

    override fun queueInput(inputBuffer: ByteBuffer) {
        val size = inputBuffer.remaining()
        if (size == 0) return
        val out = replaceOutputBuffer(size)
        val format = inputAudioFormat
        var b = bank
        if (b == null || b.channels != format.channelCount || b.sampleRate != format.sampleRate) {
            b = EqFilterBank(format.channelCount, format.sampleRate)
            bank = b
            applied = null
        }
        val s = settings
        if (applied !== s) {
            b.set(s.enabled, s.gains)
            applied = s
        }
        if (!b.active) {
            out.put(inputBuffer)
        } else {
            val count = size / 2
            if (scratch.size < count) scratch = ShortArray(count)
            inputBuffer.asShortBuffer().get(scratch, 0, count)
            inputBuffer.position(inputBuffer.position() + count * 2)
            b.process(scratch, count)
            out.asShortBuffer().put(scratch, 0, count)
            out.position(out.position() + count * 2)
        }
        out.flip()
    }

    override fun onFlush() {
        bank?.reset()
    }

    override fun onReset() {
        bank = null
        applied = null
    }
}
