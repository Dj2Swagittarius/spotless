package app.spotless.android.bridge

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The web's Track (src/lib/types.ts), field for field, so a queue can travel both ways unchanged. */
@Serializable
data class TrackDto(
    val id: Int,
    val title: String = "",
    val artist: String = "",
    val artistId: Int = 0,
    val album: String = "",
    val albumId: Int = 0,
    val duration: Double = 0.0,
    val trackNo: Int = 0,
    val discNo: Int = 0,
    val genre: String? = null,
    val gain: Double? = null,
    val playCount: Int? = null,
    val streamUrl: String? = null,
    val missing: Boolean? = null,
    val placeholderId: Int? = null,
) {
    /** Library tracks go to history and Last.fm; stations (streamUrl) and placeholders never do. */
    val isLibrary: Boolean get() = id > 0 && streamUrl == null
    val isPlayable: Boolean get() = missing != true && (id > 0 || streamUrl != null)
}

/** Messages from the page (see the spec's bridge protocol table). */
@Serializable
sealed interface BridgeCommand {
    @Serializable @SerialName("hello") data object Hello : BridgeCommand
    @Serializable @SerialName("getState") data object GetState : BridgeCommand
    @Serializable @SerialName("setQueue") data class SetQueue(
        val tracks: List<TrackDto>,
        val index: Int,
        val positionMs: Long = 0,
        val play: Boolean = false,
        val baseVersion: Int = 0,
    ) : BridgeCommand
    @Serializable @SerialName("syncQueue") data class SyncQueue(
        val tracks: List<TrackDto>,
        val index: Int,
        val baseVersion: Int = 0,
    ) : BridgeCommand
    @Serializable @SerialName("play") data object Play : BridgeCommand
    @Serializable @SerialName("pause") data object Pause : BridgeCommand
    @Serializable @SerialName("seek") data class Seek(val positionMs: Long) : BridgeCommand
    @Serializable @SerialName("next") data object Next : BridgeCommand
    @Serializable @SerialName("prev") data object Prev : BridgeCommand
    @Serializable @SerialName("jumpTo") data class JumpTo(val index: Int) : BridgeCommand
    @Serializable @SerialName("setRepeat") data class SetRepeat(val mode: String) : BridgeCommand
    @Serializable @SerialName("setVolume") data class SetVolume(val value: Double) : BridgeCommand
    @Serializable @SerialName("setDuck") data class SetDuck(val value: Double) : BridgeCommand
    @Serializable @SerialName("setEq") data class SetEq(val enabled: Boolean, val gains: List<Double>) : BridgeCommand
    @Serializable @SerialName("setQuality") data class SetQuality(val value: String) : BridgeCommand
    @Serializable @SerialName("setSleepTimer") data class SetSleepTimer(val minutes: Int) : BridgeCommand
    @Serializable @SerialName("speak") data class Speak(
        val id: Int,
        val audio: String? = null,
        val mime: String? = null,
        val text: String? = null,
    ) : BridgeCommand
    @Serializable @SerialName("stopSpeaking") data object StopSpeaking : BridgeCommand
    @Serializable @SerialName("changeServer") data object ChangeServer : BridgeCommand
}

/** Messages to the page. */
@Serializable
sealed interface BridgeEvent {
    @Serializable @SerialName("hello") data class Hello(
        val bridgeVersion: Int,
        val appVersion: String,
        val caps: List<String>,
    ) : BridgeEvent
    @Serializable @SerialName("state") data class State(
        val isPlaying: Boolean,
        val index: Int,
        val positionMs: Long,
        val durationMs: Long,
        val buffering: Boolean,
        val queueVersion: Int,
        val sleepUntil: Long? = null,
    ) : BridgeEvent
    @Serializable @SerialName("queue") data class Queue(
        val tracks: List<TrackDto>,
        val index: Int,
        val queueVersion: Int,
        val positionMs: Long,
        val isPlaying: Boolean,
    ) : BridgeEvent
    @Serializable @SerialName("trackError") data class TrackError(val trackId: Int, val reason: String) : BridgeEvent
    @Serializable @SerialName("speaking") data class Speaking(val id: Int, val active: Boolean) : BridgeEvent
    @Serializable @SerialName("authLost") data object AuthLost : BridgeEvent
}

object BridgeJson {
    const val VERSION = 1
    /** Session custom command actions and the bundle key that carries the JSON. */
    const val CMD = "spotless.cmd"
    const val EVT = "spotless.evt"
    const val KEY = "json"

    val json = Json {
        ignoreUnknownKeys = true
        classDiscriminator = "type"
        explicitNulls = false
        encodeDefaults = true
    }

    fun parseCommand(text: String): BridgeCommand? =
        runCatching { json.decodeFromString(BridgeCommand.serializer(), text) }.getOrNull()

    fun encode(event: BridgeEvent): String = json.encodeToString(BridgeEvent.serializer(), event)
}
