package app.spotless.android.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlayTrackerTest {
    private var now = 1_700_000_000L
    private val tracker = PlayTracker { now }

    private fun listen(from: Double, to: Double, step: Double = 1.0): HistoryReport? {
        var pos = from
        var last: HistoryReport? = null
        while (pos <= to) {
            tracker.onPosition(pos)?.let { last = it }
            pos += step
        }
        return last
    }

    @Test fun `start is reported once per play`() {
        tracker.begin(7, 200.0, isLibrary = true)
        assertEquals(HistoryReport(7, HistoryEvent.START, null), tracker.onPlaying())
        assertNull(tracker.onPlaying())
    }

    @Test fun `played after half the track`() {
        tracker.begin(7, 200.0, true)
        tracker.onPlaying()
        assertNull(listen(0.0, 99.0))
        assertEquals(HistoryReport(7, HistoryEvent.PLAYED, now), listen(100.0, 101.0))
        assertNull(listen(102.0, 150.0))
    }

    @Test fun `long tracks need 240 seconds`() {
        tracker.begin(7, 3600.0, true)
        tracker.onPlaying()
        assertNull(listen(0.0, 239.0))
        assertEquals(HistoryEvent.PLAYED, listen(240.0, 241.0)?.event)
    }

    @Test fun `seeking does not count as listening`() {
        tracker.begin(7, 200.0, true)
        tracker.onPlaying()
        tracker.onPosition(0.0)
        tracker.onPosition(150.0) // jump of 150 s: ignored
        assertNull(listen(151.0, 160.0))
    }

    @Test fun `onJump forgets the last position`() {
        tracker.begin(7, 20.0, true)
        tracker.onPlaying()
        tracker.onPosition(1.0)
        tracker.onJump()
        tracker.onPosition(2.5) // first sample after a jump scores nothing
        assertNull(listen(3.5, 11.0))
        assertEquals(HistoryEvent.PLAYED, listen(12.0, 13.0)?.event)
    }

    @Test fun `stations and placeholders are never reported`() {
        tracker.begin(-3, 0.0, isLibrary = false)
        assertNull(tracker.onPlaying())
        assertNull(listen(0.0, 400.0))
    }

    @Test fun `begin resets for a replay`() {
        tracker.begin(7, 4.0, true)
        tracker.onPlaying()
        listen(0.0, 3.0)
        tracker.begin(7, 4.0, true)
        assertEquals(HistoryEvent.START, tracker.onPlaying()?.event)
    }
}
