package app.spotless.android.playback

import app.spotless.android.bridge.TrackDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrackUrlsTest {
    private val origin = "http://nas:4000"

    @Test fun `raw library track`() =
        assertEquals(StreamSpec("http://nas:4000/api/stream/12", Rung.RAW, 0.0), TrackUrls.stream(origin, TrackDto(id = 12), Rung.RAW))

    @Test fun `raw ignores the offset (it seeks instead)`() =
        assertEquals(StreamSpec("http://nas:4000/api/stream/12", Rung.RAW, 0.0), TrackUrls.stream(origin, TrackDto(id = 12), Rung.RAW, 30.0))

    @Test fun `transcode starts at the offset`() =
        assertEquals(
            StreamSpec("http://nas:4000/api/stream/12?format=mp3&maxBitRate=192&offset=30.000", Rung.NORMAL, 30.0),
            TrackUrls.stream(origin, TrackDto(id = 12), Rung.NORMAL, 30.0),
        )

    @Test fun `stations play their own url`() =
        assertEquals(
            StreamSpec("http://radio.example/live", null, 0.0),
            TrackUrls.stream(origin, TrackDto(id = -3, streamUrl = "http://radio.example/live"), Rung.HIGH),
        )

    @Test fun `station urls from the server are relative`() =
        assertEquals(
            StreamSpec("http://nas:4000/api/stations/3/stream", null, 0.0),
            TrackUrls.stream(origin, TrackDto(id = -3, streamUrl = "/api/stations/3/stream"), Rung.HIGH),
        )

    @Test fun `placeholders get the missing marker`() =
        assertEquals(TrackUrls.MISSING, TrackUrls.stream(origin, TrackDto(id = 0, missing = true), Rung.RAW).url)

    @Test fun `artwork by album`() {
        assertEquals("http://nas:4000/api/artwork/4", TrackUrls.artwork(origin, TrackDto(id = 1, albumId = 4)))
        assertNull(TrackUrls.artwork(origin, TrackDto(id = -3, streamUrl = "http://radio")))
    }
}
