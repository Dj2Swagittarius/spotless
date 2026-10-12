package app.spotless.android.playback

import app.spotless.android.bridge.TrackDto
import org.junit.Assert.assertEquals
import org.junit.Test

class QueueModelTest {
    private fun t(id: Int) = TrackDto(id = id, title = "t$id")
    private fun ids(list: List<TrackDto>) = list.map { it.id }

    @Test fun `set replaces and clamps the index`() {
        val q = QueueModel()
        q.set(listOf(t(1), t(2)), 5)
        assertEquals(1, q.index)
        q.set(emptyList(), 0)
        assertEquals(-1, q.index)
    }

    @Test fun `sync keeps the playing item and splits around it`() {
        val q = QueueModel().apply { set(listOf(t(1), t(2), t(3)), 1) }
        val ch = q.sync(listOf(t(9), t(1), t(2), t(3), t(4)), 2, baseVersion = 0) as QueueChange.Around
        assertEquals(listOf(9, 1), ids(ch.before))
        assertEquals(listOf(3, 4), ids(ch.after))
        assertEquals(2, ch.index)
        assertEquals(2, q.index)
    }

    @Test fun `sync finds the playing item near the hint when the index moved`() {
        val q = QueueModel().apply { set(listOf(t(1), t(2), t(3)), 2) }
        // JS still thinks index 1, but native already skipped to track 3
        val ch = q.sync(listOf(t(1), t(2), t(3), t(4)), 1, 0) as QueueChange.Around
        assertEquals(2, ch.index)
    }

    @Test fun `sync replaces when the playing item is gone`() {
        val q = QueueModel().apply { set(listOf(t(1), t(2)), 0) }
        val ch = q.sync(listOf(t(5), t(6)), 1, 0) as QueueChange.Replace
        assertEquals(listOf(5, 6), ids(ch.tracks))
        assertEquals(1, ch.index)
    }

    @Test fun `stale sync is rejected after a native change`() {
        val q = QueueModel().apply { set(listOf(t(1)), 0) }
        q.replaceFromNative(listOf(t(7), t(8)), 0)
        assertEquals(1, q.version)
        assertEquals(QueueChange.Rejected, q.sync(listOf(t(1), t(2)), 0, baseVersion = 0))
        assertEquals(listOf(7, 8), ids(q.tracks))
    }

    @Test fun `locate prefers the hint then the nearest duplicate`() {
        val list = listOf(t(1), t(2), t(1), t(3), t(1))
        assertEquals(2, QueueModel.locate(list, t(1), 2))
        assertEquals(4, QueueModel.locate(list, t(1), 4))
        assertEquals(2, QueueModel.locate(list, t(1), 3))
        assertEquals(-1, QueueModel.locate(list, t(9), 0))
    }

    @Test fun `persist trimming keeps the current track and what follows`() {
        val tracks = (1..800).map(::t)
        val (kept, index) = QueueModel.trimForPersist(tracks, 600)
        assertEquals(500, kept.size)
        assertEquals(301, kept.first().id)
        assertEquals(601, kept[index].id)
        assertEquals(Pair(emptyList<TrackDto>(), -1), QueueModel.trimForPersist(emptyList(), -1))
        val (short, i2) = QueueModel.trimForPersist(tracks.take(10), 3)
        assertEquals(10, short.size)
        assertEquals(3, i2)
    }
}
