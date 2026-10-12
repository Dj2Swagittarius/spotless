# Spotless for Android — P3: Home-Screen Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A home-screen widget showing the current song (cover, title, artist) with previous / play-pause / next buttons.

**Architecture:** A Jetpack Glance widget renders from its own stored state. The playback engine pushes new state only when the song or play state changes (no polling); the cover comes from P2's `ArtworkCache`. Buttons send media-button broadcasts to Media3's `MediaButtonReceiver`, which forwards them to the playback service (and starts it with the last queue if it isn't running). Tapping the widget opens the app.

**Tech Stack:** Kotlin, Jetpack Glance (`androidx.glance:glance-appwidget` 1.1.1), DataStore Preferences, Media3 session.

Spec: `docs/superpowers/specs/2026-10-11-android-app-design.md` (section "P3"). **Prerequisites:** P1 and P2 plans implemented (uses `ArtworkCache` from P2 Task 3).

## Global Constraints

- Everything in P1's Global Constraints still applies.
- Library version: `androidx.glance:glance-appwidget` 1.1.1 (if it fails to resolve, the newest 1.1.x that does).
- No periodic updates: `updatePeriodMillis="0"`; updates come only from the engine.
- Buttons go through `androidx.media3.session.MediaButtonReceiver` (declared in P1), each with a distinct data URI so their PendingIntents don't collide.

## File Structure

```
android/gradle/libs.versions.toml           (modify) glance
android/app/build.gradle.kts                (modify) glance dependency
android/app/src/main/java/app/spotless/android/widget/
  WidgetState.kt        what the widget shows; read/write to Glance preferences
  MediaKeys.kt          media-button broadcast intents
  NowPlayingWidget.kt   Glance UI + receiver
  WidgetUpdater.kt      engine -> widget state
android/app/src/main/java/app/spotless/android/playback/PlaybackEngine.kt  (modify) refreshWidget()
android/app/src/main/res/drawable/{ic_prev,ic_play,ic_pause,ic_next}.xml
android/app/src/main/res/xml/now_playing_widget.xml
android/app/src/main/res/values/strings.xml (modify)
android/app/src/main/AndroidManifest.xml    (modify)
android/app/src/test/java/app/spotless/android/widget/WidgetStateTest.kt
README.md (modify)
```

---

### Task 1: Widget state

**Files:**
- Modify: `android/gradle/libs.versions.toml`, `android/app/build.gradle.kts`
- Create: `android/app/src/main/java/app/spotless/android/widget/WidgetState.kt`
- Test: `android/app/src/test/java/app/spotless/android/widget/WidgetStateTest.kt`

**Interfaces:**
- Consumes: `TrackDto` (P1).
- Produces: `data class WidgetState(title: String, subtitle: String, isPlaying: Boolean, artPath: String?)` with `write(prefs: MutablePreferences)`, companion `EMPTY`, `of(track: TrackDto?, isPlaying: Boolean, artPath: String?)`, `read(prefs: Preferences)`.

- [ ] **Step 1: Add the Glance dependency**

In `libs.versions.toml` under `[versions]` add `glance = "1.1.1"` and under `[libraries]`:

```toml
glance-appwidget = { module = "androidx.glance:glance-appwidget", version.ref = "glance" }
```

In `app/build.gradle.kts` dependencies add `implementation(libs.glance.appwidget)`.

- [ ] **Step 2: Write the failing test**

```kotlin
package app.spotless.android.widget

import androidx.datastore.preferences.core.mutablePreferencesOf
import app.spotless.android.bridge.TrackDto
import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetStateTest {
    @Test fun `nothing queued shows the empty card`() =
        assertEquals(WidgetState("Nothing playing", "Tap to open Spotless", false, null), WidgetState.of(null, false, null))

    @Test fun `a track shows title and artist`() =
        assertEquals(
            WidgetState("Song", "Artist", true, "/cache/album-3"),
            WidgetState.of(TrackDto(id = 1, title = "Song", artist = "Artist", albumId = 3), true, "/cache/album-3"),
        )

    @Test fun `blank titles get a stand-in`() =
        assertEquals("Unknown song", WidgetState.of(TrackDto(id = 1), false, null).title)

    @Test fun `round trips through preferences`() {
        val prefs = mutablePreferencesOf()
        val state = WidgetState("Song", "Artist", true, "/x")
        state.write(prefs)
        assertEquals(state, WidgetState.read(prefs))
        WidgetState("A", "B", false, null).write(prefs)
        assertEquals(WidgetState("A", "B", false, null), WidgetState.read(prefs))
    }

    @Test fun `empty preferences read as the empty card`() = assertEquals(WidgetState.EMPTY, WidgetState.read(mutablePreferencesOf()))
}
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.widget.*"`
Expected: compilation fails.

- [ ] **Step 4: Implement `WidgetState.kt`**

```kotlin
package app.spotless.android.widget

import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import app.spotless.android.bridge.TrackDto

/** Everything the widget draws. */
data class WidgetState(val title: String, val subtitle: String, val isPlaying: Boolean, val artPath: String?) {

    fun write(prefs: MutablePreferences) {
        prefs[TITLE] = title
        prefs[SUBTITLE] = subtitle
        prefs[PLAYING] = isPlaying
        if (artPath == null) prefs.remove(ART) else prefs[ART] = artPath
    }

    companion object {
        private val TITLE = stringPreferencesKey("title")
        private val SUBTITLE = stringPreferencesKey("subtitle")
        private val PLAYING = booleanPreferencesKey("playing")
        private val ART = stringPreferencesKey("art")

        val EMPTY = WidgetState("Nothing playing", "Tap to open Spotless", false, null)

        fun of(track: TrackDto?, isPlaying: Boolean, artPath: String?): WidgetState =
            if (track == null) EMPTY else WidgetState(track.title.ifBlank { "Unknown song" }, track.artist, isPlaying, artPath)

        fun read(prefs: Preferences): WidgetState {
            val title = prefs[TITLE] ?: return EMPTY
            return WidgetState(title, prefs[SUBTITLE].orEmpty(), prefs[PLAYING] ?: false, prefs[ART])
        }
    }
}
```

- [ ] **Step 5: Run the test**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.widget.*"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add android/ && git commit -m "Android: widget state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The widget UI, buttons and declaration

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/widget/MediaKeys.kt`, `widget/NowPlayingWidget.kt`, `res/drawable/ic_prev.xml`, `res/drawable/ic_play.xml`, `res/drawable/ic_pause.xml`, `res/drawable/ic_next.xml`, `res/xml/now_playing_widget.xml`
- Modify: `res/values/strings.xml`, `AndroidManifest.xml`

**Interfaces:**
- Consumes: `WidgetState` (Task 1).
- Produces: `object MediaKeys { fun intent(context, keyCode: Int): Intent }`; `class NowPlayingWidget : GlanceAppWidget`; `class NowPlayingReceiver : GlanceAppWidgetReceiver`.

- [ ] **Step 1: Write `MediaKeys.kt`**

```kotlin
package app.spotless.android.widget

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import androidx.media3.session.MediaButtonReceiver

/** A media-button press for Media3's receiver, which forwards it to the playback service. */
object MediaKeys {
    fun intent(context: Context, keyCode: Int): Intent =
        Intent(Intent.ACTION_MEDIA_BUTTON)
            .setComponent(ComponentName(context, MediaButtonReceiver::class.java))
            // distinct data per key, so the widget's three PendingIntents don't collapse into one
            .setData(Uri.parse("spotless://media-key/$keyCode"))
            .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
}
```

- [ ] **Step 2: Write `NowPlayingWidget.kt`**

```kotlin
package app.spotless.android.widget

import android.content.Context
import android.graphics.BitmapFactory
import android.view.KeyEvent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionSendBroadcast
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.state.GlanceStateDefinition
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.spotless.android.R

class NowPlayingWidget : GlanceAppWidget() {
    override val stateDefinition: GlanceStateDefinition<*> = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent { Content(context, WidgetState.read(currentState<Preferences>())) }
    }

    @Composable
    private fun Content(context: Context, state: WidgetState) {
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val art = state.artPath?.let { runCatching { BitmapFactory.decodeFile(it) }.getOrNull() }
        Row(
            modifier = GlanceModifier.fillMaxSize().background(Color(0xFF181818)).cornerRadius(16.dp).padding(8.dp)
                .let { if (open != null) it.clickable(actionStartActivity(open)) else it },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(
                provider = if (art != null) ImageProvider(art) else ImageProvider(app.spotless.android.R.mipmap.ic_launcher),
                contentDescription = null,
                modifier = GlanceModifier.size(56.dp).cornerRadius(8.dp),
            )
            Column(modifier = GlanceModifier.defaultWeight().padding(horizontal = 10.dp)) {
                Text(state.title, maxLines = 1, style = TextStyle(color = ColorProvider(Color.White), fontWeight = FontWeight.Bold, fontSize = 14.sp))
                Text(state.subtitle, maxLines = 1, style = TextStyle(color = ColorProvider(Color(0xFFB3B3B3)), fontSize = 12.sp))
            }
            Button(context, R.drawable.ic_prev, "Previous", KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            Button(
                context,
                if (state.isPlaying) R.drawable.ic_pause else R.drawable.ic_play,
                if (state.isPlaying) "Pause" else "Play",
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            )
            Button(context, R.drawable.ic_next, "Next", KeyEvent.KEYCODE_MEDIA_NEXT)
        }
    }

    @Composable
    private fun Button(context: Context, icon: Int, label: String, keyCode: Int) {
        Image(
            provider = ImageProvider(icon),
            contentDescription = label,
            modifier = GlanceModifier.size(40.dp).padding(8.dp).clickable(actionSendBroadcast(MediaKeys.intent(context, keyCode))),
        )
    }
}

class NowPlayingReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NowPlayingWidget()
}
```

- [ ] **Step 3: Write the icons** (Material Symbols paths, white)

`res/drawable/ic_play.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M8,5v14l11,-7z" />
</vector>
```

`res/drawable/ic_pause.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M6,19h4V5H6v14zM14,5v14h4V5h-4z" />
</vector>
```

`res/drawable/ic_next.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M6,18l8.5,-6L6,6v12zM16,6v12h2V6h-2z" />
</vector>
```

`res/drawable/ic_prev.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M6,6h2v12H6zM9.5,12l8.5,6V6z" />
</vector>
```

- [ ] **Step 4: Declare the widget**

`res/xml/now_playing_widget.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/widget_description"
    android:initialLayout="@layout/glance_default_loading_layout"
    android:minWidth="250dp"
    android:minHeight="60dp"
    android:resizeMode="horizontal"
    android:targetCellWidth="4"
    android:targetCellHeight="1"
    android:updatePeriodMillis="0"
    android:widgetCategory="home_screen" />
```

In `strings.xml` add:

```xml
    <string name="widget_description">What\'s playing, with play, pause and skip</string>
```

In the manifest, inside `<application>`:

```xml
        <receiver
            android:name=".widget.NowPlayingReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/now_playing_widget" />
        </receiver>
```

- [ ] **Step 5: Build**

Run: `cd android && ./gradlew assembleDebug testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`. (If a Glance import moved in the resolved version — e.g. `ColorProvider` — use that version's package.)

- [ ] **Step 6: Commit**

```bash
git add android/app/src && git commit -m "Android: now-playing widget UI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Engine pushes updates to the widget

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/widget/WidgetUpdater.kt`
- Modify: `android/app/src/main/java/app/spotless/android/playback/PlaybackEngine.kt`

**Interfaces:**
- Consumes: `WidgetState`, `NowPlayingWidget` (Tasks 1–2); `AppGraph.artwork`, `AppGraph.appScope` (P1/P2).
- Produces: `class WidgetUpdater(context: Context, graph: AppGraph)` with `fun update(track: TrackDto?, isPlaying: Boolean)`.

- [ ] **Step 1: Write `WidgetUpdater.kt`**

```kotlin
package app.spotless.android.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import app.spotless.android.AppGraph
import app.spotless.android.bridge.TrackDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch

/** Pushes the engine's song and play state to every placed widget — only when they change. */
@OptIn(ExperimentalCoroutinesApi::class)
class WidgetUpdater(private val context: Context, private val graph: AppGraph) {
    // one at a time, in order: a quick pause/play must not land out of order
    private val serial = Dispatchers.IO.limitedParallelism(1)
    private var last: WidgetState? = null

    fun update(track: TrackDto?, isPlaying: Boolean) {
        graph.appScope.launch(serial) {
            val art = track?.takeIf { it.streamUrl == null }?.albumId?.let { graph.artwork.file(it)?.absolutePath }
            val state = WidgetState.of(track, isPlaying, art)
            if (state == last) return@launch
            last = state
            val ids = GlanceAppWidgetManager(context).getGlanceIds(NowPlayingWidget::class.java)
            ids.forEach { id ->
                updateAppWidgetState(context, PreferencesGlanceStateDefinition, id) { prefs ->
                    prefs.toMutablePreferences().apply { state.write(this) }
                }
                NowPlayingWidget().update(context, id)
            }
        }
    }
}
```

- [ ] **Step 2: Hook it into `PlaybackEngine`**

Add a field next to the other helpers:

```kotlin
    private val widgets = app.spotless.android.widget.WidgetUpdater(context, graph)
```

Add a method in the "Volume, history, sleep timer" section:

```kotlin
    private fun refreshWidget() = widgets.update(current()?.track, isPlayingNow())
```

Call `refreshWidget()`:
- at the end of `onMediaItemTransition` (after `persistSoon()`), and in its two early-return paths (before each `return`),
- at the end of `onIsPlayingChanged`,
- at the end of `onPlaybackStateChanged`,
- at the end of `onTimelineChanged`'s `if` block.

- [ ] **Step 3: Build**

Run: `cd android && ./gradlew assembleDebug testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add android/app/src && git commit -m "Android: keep the widget in step with playback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verify on the phone and document

Needs the user's phone. **Ask the user to connect it** before starting.

- [ ] **Step 1: Install and place the widget**

`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, then long-press the home screen → Widgets → Spotless.

- [ ] **Step 2: Checklist**

1. Before anything plays: "Nothing playing — Tap to open Spotless"; tapping opens the app.
2. Start a song in the app: cover, title and artist appear within a second; the middle button shows pause.
3. Pause / next / previous from the widget work and the widget follows.
4. Skip from the lock screen or headset: the widget follows.
5. Force-stop the app, press play on the widget: the last queue resumes.
6. Internet radio station: station name shows, app icon instead of a cover.
7. Resize the widget wider: it stretches; text truncates rather than wraps.

- [ ] **Step 3: Document**

Add to the README's Android app section:

```markdown
**Home-screen widget:** long-press your home screen → Widgets → Spotless for the current song with play/pause and skip.
```

- [ ] **Step 4: Commit**

```bash
git add README.md && git commit -m "Docs: Android widget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
