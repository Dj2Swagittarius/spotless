package app.spotless.android.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeProtocolTest {
    private val trackJson =
        """{"id":12,"title":"Song","artist":"A","artistId":3,"album":"B","albumId":4,"duration":201.5,"trackNo":1,"discNo":1,"genre":null,"gain":-6.2}"""

    @Test fun `parses setQueue with a web Track`() {
        val cmd = BridgeJson.parseCommand("""{"type":"setQueue","tracks":[$trackJson],"index":0,"positionMs":0,"play":true,"baseVersion":2}""")
        cmd as BridgeCommand.SetQueue
        assertEquals(12, cmd.tracks[0].id)
        assertEquals(-6.2, cmd.tracks[0].gain!!, 1e-9)
        assertTrue(cmd.play)
        assertEquals(2, cmd.baseVersion)
    }

    @Test fun `parses simple commands`() {
        assertEquals(BridgeCommand.Play, BridgeJson.parseCommand("""{"type":"play"}"""))
        assertEquals(BridgeCommand.Seek(1500), BridgeJson.parseCommand("""{"type":"seek","positionMs":1500}"""))
        assertEquals(BridgeCommand.SetRepeat("all"), BridgeJson.parseCommand("""{"type":"setRepeat","mode":"all"}"""))
        assertEquals(BridgeCommand.Speak(4, text = "hi"), BridgeJson.parseCommand("""{"type":"speak","id":4,"text":"hi"}"""))
    }

    @Test fun `unknown types and bad json are ignored`() {
        assertNull(BridgeJson.parseCommand("""{"type":"launchMissiles"}"""))
        assertNull(BridgeJson.parseCommand("not json"))
        assertNull(BridgeJson.parseCommand("""{"no":"type"}"""))
    }

    @Test fun `unknown fields are ignored`() =
        assertEquals(BridgeCommand.Next, BridgeJson.parseCommand("""{"type":"next","extra":1}"""))

    @Test fun `events carry the type discriminator and omit nulls`() {
        val text = BridgeJson.encode(BridgeEvent.State(true, 2, 1000, 200000, false, 0, null))
        val obj = Json.parseToJsonElement(text).jsonObject
        assertEquals("\"state\"", obj["type"].toString())
        assertFalse(obj.containsKey("sleepUntil"))
        assertEquals("""{"type":"authLost"}""", BridgeJson.encode(BridgeEvent.AuthLost))
    }

    @Test fun `track round trip keeps the fields the web uses`() {
        val track = BridgeJson.json.decodeFromString(TrackDto.serializer(), trackJson)
        val back = Json.parseToJsonElement(BridgeJson.json.encodeToString(TrackDto.serializer(), track)).jsonObject
        assertEquals("\"Song\"", back["title"].toString())
        assertEquals("4", back["albumId"].toString())
        assertFalse(back.containsKey("streamUrl"))
    }

    @Test fun `playability`() {
        assertTrue(TrackDto(id = 5).isLibrary)
        assertFalse(TrackDto(id = -2, streamUrl = "http://radio").isLibrary)
        assertTrue(TrackDto(id = -2, streamUrl = "http://radio").isPlayable)
        assertFalse(TrackDto(id = 0, missing = true).isPlayable)
    }
}
