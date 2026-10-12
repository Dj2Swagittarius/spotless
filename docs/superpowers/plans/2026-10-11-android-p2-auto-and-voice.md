# Spotless for Android — P2: Android Auto and Voice Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse and play the Spotless library from Android Auto, and start music by voice ("play Daft Punk on Spotless").

**Architecture:** The P1 playback service becomes a Media3 `MediaLibraryService`. A `LibraryTree` turns the server's existing JSON endpoints into a browse tree (Home, Playlists, Liked Songs, Radio, albums). Choosing an item or a voice query resolves to a list of tracks that the engine queues natively (no WebView involved) and reports to the page as a native-originated queue change. Artwork for the car comes from a non-exported `ContentProvider` that fetches album art with the session cookie and caches it.

**Tech Stack:** Kotlin, Media3 1.8 session (`MediaLibraryService`, `MediaLibrarySession`), OkHttp, kotlinx.serialization, JUnit 4 + MockWebServer.

Spec: `docs/superpowers/specs/2026-10-11-android-app-design.md` (section "P2"). **Prerequisite:** P1 plan (`2026-10-11-android-p1-app-and-playback.md`) fully implemented.

## Global Constraints

- Everything in P1's Global Constraints still applies (package, SDK levels, versions, no Play Services, commit trailer, no LAN IPs in commits).
- Browse requests use `AppGraph.http` (session cookie) and `AppGraph.origin`; nothing else talks to the server.
- Artwork provider authority: `app.spotless.android.art`; not exported; read access granted per URI to `com.google.android.projection.gearhead` (Android Auto).
- Media ids: folders `root`, `home`, `home/<i>`, `playlists`, `playlist/<id>`, `liked`, `stations`, `album/<id>`; playable `play:<index>:<parent id>` (parent last so a search query may contain any character).
- Queues started from the car or by voice are native-originated: `QueueModel.replaceFromNative` bumps `queueVersion` and the page is sent a `queue` event.
- Radio-mode refill and DJ sets remain WebView features; they don't run for car-started queues.

## File Structure

```
android/app/src/main/java/app/spotless/android/
  library/LibraryModels.kt     DTOs for /api/home, /api/playlists, /api/albums/<id>, /api/stations, /api/search
  library/LibrarySource.kt     interface + HTTP implementation of the browse endpoints
  library/LibraryTree.kt       media ids, browse nodes, resolving a playable id to (tracks, start)
  library/ArtworkCache.kt      fetch + cache /api/artwork/<albumId> to files
  library/ArtworkProvider.kt   content:// artwork for Android Auto
  playback/PlaybackEngine.kt   (modify) queueFromLibrary()
  playback/SessionCallback.kt  (modify) becomes a MediaLibrarySession.Callback
  playback/PlaybackService.kt  (modify) MediaLibraryService
  ui/VoiceSearch.kt            MEDIA_PLAY_FROM_SEARCH -> session
  ui/MainActivity.kt           (modify) route the voice intent
android/app/src/main/res/xml/automotive_app_desc.xml
android/app/src/main/AndroidManifest.xml (modify)
android/app/src/test/java/app/spotless/android/library/{LibrarySourceTest, LibraryTreeTest, ArtworkCacheTest}.kt
README.md (modify)
```

---

### Task 1: Library models and HTTP source

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/library/LibraryModels.kt`, `library/LibrarySource.kt`
- Test: `android/app/src/test/java/app/spotless/android/library/LibrarySourceTest.kt`

**Interfaces:**
- Consumes: `TrackDto`, `BridgeJson.json` (P1 Task 6).
- Produces: `AlbumDto(id, name, artist, artistId, year?)`, `HomeSectionDto(title, kind, tracks?, albums?)`, `PlaylistDto(id, name, trackCount, artIds?)`, `TrackListDto(id, name, tracks)`, `StationDto(id, name, streamUrl)` with `toTrack(): TrackDto`, `SearchDto(tracks, albums)`; `interface LibrarySource { suspend home(); playlists(); playlist(id); album(id); liked(); stations(); search(query) }`; `class HttpLibrarySource(client: OkHttpClient, origin: () -> String?) : LibrarySource`.

- [ ] **Step 1: Write the failing test**

```kotlin
package app.spotless.android.library

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LibrarySourceTest {
    private val server = MockWebServer().apply { start() }
    private val source = HttpLibrarySource(OkHttpClient()) { server.url("/").toString().trimEnd('/') }
    private val track = """{"id":1,"title":"T","artist":"A","artistId":2,"album":"B","albumId":3,"duration":180,"trackNo":1,"discNo":1,"genre":null}"""

    @After fun tearDown() = server.shutdown()

    @Test fun `home sections`() = runBlocking {
        server.enqueue(MockResponse().setBody("""[{"title":"Recently played","kind":"tracks","tracks":[$track]},{"title":"Recently added","kind":"albums","albums":[{"id":3,"name":"B","artist":"A","artistId":2,"year":2020,"trackCount":9,"duration":2000}]}]"""))
        val home = source.home()
        assertEquals("/api/home", server.takeRequest().path)
        assertEquals(listOf("tracks", "albums"), home.map { it.kind })
        assertEquals(1, home[0].tracks!![0].id)
        assertEquals(3, home[1].albums!![0].id)
    }

    @Test fun `playlist and liked`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"id":5,"name":"Mine","description":null,"createdAt":"x","trackCount":1,"duration":180,"tracks":[$track]}"""))
        assertEquals(1, source.playlist(5)!!.tracks.size)
        assertEquals("/api/playlists/5", server.takeRequest().path)
        server.enqueue(MockResponse().setBody("[$track]"))
        assertEquals(1, source.liked().size)
        assertEquals("/api/likes?full=1", server.takeRequest().path)
    }

    @Test fun `stations become station tracks`() = runBlocking {
        server.enqueue(MockResponse().setBody("""[{"id":4,"name":"Jazz FM","streamUrl":"http://x","homePageUrl":null}]"""))
        val t = source.stations()[0].toTrack()
        assertEquals(-4, t.id)
        assertEquals("Jazz FM", t.title)
        assertEquals("/api/stations/4/stream", t.streamUrl)
    }

    @Test fun `search encodes the query`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"tracks":[$track],"albums":[],"artists":[]}"""))
        assertEquals(1, source.search("daft punk & co").tracks.size)
        assertEquals("/api/search?q=daft%20punk%20%26%20co", server.takeRequest().path)
    }

    @Test fun `errors read as empty`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(500))
        assertTrue(source.playlists().isEmpty())
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals(null, source.album(99))
    }
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.library.LibrarySourceTest"`
Expected: compilation fails.

- [ ] **Step 3: Implement**

`LibraryModels.kt`:

```kotlin
package app.spotless.android.library

import app.spotless.android.bridge.TrackDto
import kotlinx.serialization.Serializable

@Serializable
data class AlbumDto(val id: Int, val name: String = "", val artist: String = "", val artistId: Int = 0, val year: Int? = null)

/** One row of /api/home: 'tracks' and 'mix' rows carry tracks, 'albums' rows carry albums. */
@Serializable
data class HomeSectionDto(val title: String, val kind: String, val tracks: List<TrackDto>? = null, val albums: List<AlbumDto>? = null)

@Serializable
data class PlaylistDto(val id: Int, val name: String, val trackCount: Int = 0, val artIds: List<Int>? = null)

/** /api/playlists/<id> and /api/albums/<id>: a named list of tracks. */
@Serializable
data class TrackListDto(val id: Int, val name: String = "", val tracks: List<TrackDto> = emptyList())

@Serializable
data class StationDto(val id: Int, val name: String, val streamUrl: String) {
    /** Same as stationTrack() in src/lib/types.ts. */
    fun toTrack() = TrackDto(
        id = -id,
        title = name,
        artist = "Internet radio",
        album = name,
        discNo = 1,
        streamUrl = "/api/stations/$id/stream",
    )
}

@Serializable
data class SearchDto(val tracks: List<TrackDto> = emptyList(), val albums: List<AlbumDto> = emptyList())
```

`LibrarySource.kt`:

```kotlin
package app.spotless.android.library

import app.spotless.android.bridge.BridgeJson
import app.spotless.android.bridge.TrackDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.URLEncoder

/** The server endpoints the car browses. */
interface LibrarySource {
    suspend fun home(): List<HomeSectionDto>
    suspend fun playlists(): List<PlaylistDto>
    suspend fun playlist(id: Int): TrackListDto?
    suspend fun album(id: Int): TrackListDto?
    suspend fun liked(): List<TrackDto>
    suspend fun stations(): List<StationDto>
    suspend fun search(query: String): SearchDto
}

class HttpLibrarySource(private val client: OkHttpClient, private val origin: () -> String?) : LibrarySource {
    private suspend fun <T> get(path: String, serializer: KSerializer<T>): T? = withContext(Dispatchers.IO) {
        val base = origin() ?: return@withContext null
        try {
            client.newCall(Request.Builder().url(base + path).build()).execute().use { res ->
                if (!res.isSuccessful) return@use null
                res.body?.string()?.let { runCatching { BridgeJson.json.decodeFromString(serializer, it) }.getOrNull() }
            }
        } catch (_: IOException) {
            null
        }
    }

    override suspend fun home() = get("/api/home", ListSerializer(HomeSectionDto.serializer())).orEmpty()
    override suspend fun playlists() = get("/api/playlists", ListSerializer(PlaylistDto.serializer())).orEmpty()
    override suspend fun playlist(id: Int) = get("/api/playlists/$id", TrackListDto.serializer())
    override suspend fun album(id: Int) = get("/api/albums/$id", TrackListDto.serializer())
    override suspend fun liked() = get("/api/likes?full=1", ListSerializer(TrackDto.serializer())).orEmpty()
    override suspend fun stations() = get("/api/stations", ListSerializer(StationDto.serializer())).orEmpty()

    override suspend fun search(query: String): SearchDto {
        val q = URLEncoder.encode(query, "UTF-8").replace("+", "%20")
        return get("/api/search?q=$q", SearchDto.serializer()) ?: SearchDto()
    }
}
```

- [ ] **Step 4: Run the test**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.library.LibrarySourceTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: library browse endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Browse tree and media ids

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/library/LibraryTree.kt`
- Test: `android/app/src/test/java/app/spotless/android/library/LibraryTreeTest.kt`

**Interfaces:**
- Consumes: `LibrarySource` and DTOs (Task 1), `TrackDto`.
- Produces: `object MediaIds { ROOT, HOME, PLAYLISTS, LIKED, STATIONS; homeSection(i); playlist(id); album(id); search(query); play(parent, index); parsePlay(id): Pair<String, Int>? }`; `sealed interface BrowseNode { val id; val title; val subtitle: String?; val albumId: Int? ; Folder; Playable }`; `class LibraryTree(source: LibrarySource)` with `suspend children(parentId): List<BrowseNode>`, `suspend resolve(playId): Pair<List<TrackDto>, Int>?`, `suspend search(query): List<BrowseNode>`, `suspend searchTracks(query): List<TrackDto>`.

- [ ] **Step 1: Write the failing test**

```kotlin
package app.spotless.android.library

import app.spotless.android.bridge.TrackDto
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LibraryTreeTest {
    private fun t(id: Int) = TrackDto(id = id, title = "t$id", artist = "a$id", albumId = id * 10)

    private val source = object : LibrarySource {
        override suspend fun home() = listOf(
            HomeSectionDto("Recently played", "tracks", tracks = listOf(t(1), t(2))),
            HomeSectionDto("Recently added", "albums", albums = listOf(AlbumDto(7, "Album", "Artist"))),
        )
        override suspend fun playlists() = listOf(PlaylistDto(5, "Mine", 2))
        override suspend fun playlist(id: Int) = TrackListDto(id, "Mine", listOf(t(3), t(4)))
        override suspend fun album(id: Int) = TrackListDto(id, "Album", listOf(t(8), t(9)))
        override suspend fun liked() = listOf(t(6))
        override suspend fun stations() = listOf(StationDto(4, "Jazz FM", "http://x"))
        override suspend fun search(query: String) = SearchDto(tracks = listOf(t(11), t(12)))
    }
    private val tree = LibraryTree(source)

    @Test fun `play ids round trip, with anything in the parent`() {
        val id = MediaIds.play(MediaIds.search("a:b|c"), 3)
        assertEquals(MediaIds.search("a:b|c") to 3, MediaIds.parsePlay(id))
        assertNull(MediaIds.parsePlay("playlist/5"))
        assertNull(MediaIds.parsePlay("play:x:home"))
    }

    @Test fun `root lists the four shelves`() = runBlocking {
        assertEquals(listOf("home", "playlists", "liked", "stations"), tree.children(MediaIds.ROOT).map { it.id })
    }

    @Test fun `home rows are folders; track rows hold playables, album rows hold albums`() = runBlocking {
        assertEquals(listOf("home/0", "home/1"), tree.children(MediaIds.HOME).map { it.id })
        val tracks = tree.children("home/0")
        assertEquals(listOf("play:0:home/0", "play:1:home/0"), tracks.map { it.id })
        assertEquals(10, tracks[0].albumId)
        val albums = tree.children("home/1")
        assertEquals(listOf("album/7"), albums.map { it.id })
        assertEquals(true, albums[0] is BrowseNode.Folder)
    }

    @Test fun `playlists, liked, stations, albums`() = runBlocking {
        assertEquals(listOf("playlist/5"), tree.children(MediaIds.PLAYLISTS).map { it.id })
        assertEquals(listOf("play:0:playlist/5", "play:1:playlist/5"), tree.children("playlist/5").map { it.id })
        assertEquals(listOf("play:0:liked"), tree.children(MediaIds.LIKED).map { it.id })
        assertEquals("Jazz FM", tree.children(MediaIds.STATIONS)[0].title)
        assertEquals(listOf("play:0:album/7", "play:1:album/7"), tree.children("album/7").map { it.id })
    }

    @Test fun `resolve queues the whole list from the chosen track`() = runBlocking {
        val (tracks, start) = tree.resolve("play:1:playlist/5")!!
        assertEquals(listOf(3, 4), tracks.map { it.id })
        assertEquals(1, start)
        val (stations, _) = tree.resolve("play:0:stations")!!
        assertEquals(-4, stations[0].id)
        assertNull(tree.resolve("play:9:liked"))
        assertNull(tree.resolve("nonsense"))
    }

    @Test fun `search results are playable from the search list`() = runBlocking {
        val nodes = tree.search("daft")
        assertEquals(listOf("play:0:search/daft", "play:1:search/daft"), nodes.map { it.id })
        assertEquals(listOf(11, 12), tree.resolve(nodes[1].id)!!.first.map { it.id })
    }

    @Test fun `unknown folders are empty`() = runBlocking {
        assertEquals(emptyList<BrowseNode>(), tree.children("bogus"))
    }
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.library.LibraryTreeTest"`
Expected: compilation fails.

- [ ] **Step 3: Implement `LibraryTree.kt`**

```kotlin
package app.spotless.android.library

import app.spotless.android.bridge.TrackDto

object MediaIds {
    const val ROOT = "root"
    const val HOME = "home"
    const val PLAYLISTS = "playlists"
    const val LIKED = "liked"
    const val STATIONS = "stations"

    fun homeSection(i: Int) = "home/$i"
    fun playlist(id: Int) = "playlist/$id"
    fun album(id: Int) = "album/$id"
    fun search(query: String) = "search/$query"

    /** A track inside a list: the list's id goes last so it may contain any character (search queries). */
    fun play(parent: String, index: Int) = "play:$index:$parent"

    fun parsePlay(id: String): Pair<String, Int>? {
        val parts = id.split(':', limit = 3)
        if (parts.size != 3 || parts[0] != "play") return null
        val index = parts[1].toIntOrNull() ?: return null
        return parts[2] to index
    }
}

sealed interface BrowseNode {
    val id: String
    val title: String
    val subtitle: String?
    /** Album whose cover represents this node, if any. */
    val albumId: Int?

    data class Folder(override val id: String, override val title: String, override val subtitle: String? = null, override val albumId: Int? = null) : BrowseNode
    data class Playable(override val id: String, override val title: String, override val subtitle: String? = null, override val albumId: Int? = null) : BrowseNode
}

/** The car's view of the library, built from the same endpoints the web pages use. */
class LibraryTree(private val source: LibrarySource) {

    suspend fun children(parentId: String): List<BrowseNode> = when {
        parentId == MediaIds.ROOT -> listOf(
            BrowseNode.Folder(MediaIds.HOME, "Home"),
            BrowseNode.Folder(MediaIds.PLAYLISTS, "Playlists"),
            BrowseNode.Folder(MediaIds.LIKED, "Liked Songs"),
            BrowseNode.Folder(MediaIds.STATIONS, "Radio"),
        )
        parentId == MediaIds.HOME -> source.home().mapIndexed { i, s ->
            BrowseNode.Folder(MediaIds.homeSection(i), s.title, albumId = s.tracks?.firstOrNull()?.albumId ?: s.albums?.firstOrNull()?.id)
        }
        parentId.startsWith("home/") -> {
            val section = parentId.removePrefix("home/").toIntOrNull()?.let { source.home().getOrNull(it) }
            when {
                section == null -> emptyList()
                section.albums != null -> section.albums.map { BrowseNode.Folder(MediaIds.album(it.id), it.name, it.artist, it.id) }
                else -> playables(parentId, section.tracks.orEmpty().filter { it.isPlayable })
            }
        }
        parentId == MediaIds.PLAYLISTS -> source.playlists().map {
            BrowseNode.Folder(MediaIds.playlist(it.id), it.name, "${it.trackCount} songs", it.artIds?.firstOrNull())
        }
        parentId == MediaIds.LIKED || parentId == MediaIds.STATIONS ||
            parentId.startsWith("playlist/") || parentId.startsWith("album/") -> playables(parentId, tracksOf(parentId))
        else -> emptyList()
    }

    suspend fun searchTracks(query: String): List<TrackDto> = source.search(query).tracks

    suspend fun search(query: String): List<BrowseNode> = playables(MediaIds.search(query), searchTracks(query))

    /** A playable id -> the whole list it belongs to and where to start in it. */
    suspend fun resolve(playId: String): Pair<List<TrackDto>, Int>? {
        val (parent, index) = MediaIds.parsePlay(playId) ?: return null
        val tracks = tracksOf(parent)
        return if (index in tracks.indices) tracks to index else null
    }

    private suspend fun tracksOf(parentId: String): List<TrackDto> = when {
        parentId == MediaIds.LIKED -> source.liked()
        parentId == MediaIds.STATIONS -> source.stations().map { it.toTrack() }
        parentId.startsWith("home/") -> parentId.removePrefix("home/").toIntOrNull()?.let { source.home().getOrNull(it)?.tracks }.orEmpty()
        parentId.startsWith("playlist/") -> parentId.removePrefix("playlist/").toIntOrNull()?.let { source.playlist(it)?.tracks }.orEmpty()
        parentId.startsWith("album/") -> parentId.removePrefix("album/").toIntOrNull()?.let { source.album(it)?.tracks }.orEmpty()
        parentId.startsWith("search/") -> searchTracks(parentId.removePrefix("search/"))
        else -> emptyList()
    }.filter { it.isPlayable }

    private fun playables(parent: String, tracks: List<TrackDto>) = tracks.mapIndexed { i, t ->
        BrowseNode.Playable(MediaIds.play(parent, i), t.title, t.artist, t.albumId.takeIf { it > 0 })
    }
}
```

Placeholders are dropped in both `children` and `tracksOf`, so a `play:<i>` index means the same track when it is listed and when it is resolved.

- [ ] **Step 4: Run the test**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.library.LibraryTreeTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: library browse tree for Android Auto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Artwork cache and provider

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/library/ArtworkCache.kt`, `library/ArtworkProvider.kt`
- Modify: `android/app/src/main/java/app/spotless/android/AppGraph.kt` (add `artwork`), `android/app/src/main/AndroidManifest.xml`
- Test: `android/app/src/test/java/app/spotless/android/library/ArtworkCacheTest.kt`

**Interfaces:**
- Produces: `class ArtworkCache(dir: File, client: OkHttpClient, origin: () -> String?)` with `fun file(albumId: Int): File?` (blocking; call off the main thread) and `fun clear()`; `class ArtworkProvider : ContentProvider` with companion `AUTHORITY = "app.spotless.android.art"`, `uriFor(albumId: Int): Uri`, `grantToCar(context, uri)`; `AppGraph.artwork: ArtworkCache`.

- [ ] **Step 1: Write the failing test**

```kotlin
package app.spotless.android.library

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ArtworkCacheTest {
    @get:Rule val tmp = TemporaryFolder()
    private val server = MockWebServer().apply { start() }
    private val cache by lazy { ArtworkCache(tmp.root, OkHttpClient()) { server.url("/").toString().trimEnd('/') } }

    @After fun tearDown() = server.shutdown()

    @Test fun `fetches once, then serves from disk`() {
        server.enqueue(MockResponse().setBody(Buffer().write(byteArrayOf(1, 2, 3))))
        assertArrayEquals(byteArrayOf(1, 2, 3), cache.file(7)!!.readBytes())
        assertArrayEquals(byteArrayOf(1, 2, 3), cache.file(7)!!.readBytes())
        assertEquals(1, server.requestCount)
        assertEquals("/api/artwork/7", server.takeRequest().path)
    }

    @Test fun `missing art is null and not cached`() {
        server.enqueue(MockResponse().setResponseCode(404))
        assertNull(cache.file(8))
        server.enqueue(MockResponse().setBody("x"))
        assertEquals("x", cache.file(8)!!.readText())
    }

    @Test fun `bad album ids are refused without a request`() {
        assertNull(cache.file(0))
        assertEquals(0, server.requestCount)
    }
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.library.ArtworkCacheTest"`
Expected: compilation fails.

- [ ] **Step 3: Implement**

`ArtworkCache.kt`:

```kotlin
package app.spotless.android.library

import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException

/** Album covers on disk, fetched with the session cookie. Blocking: call from a background thread. */
class ArtworkCache(private val dir: File, private val client: OkHttpClient, private val origin: () -> String?) {

    fun file(albumId: Int): File? {
        if (albumId <= 0) return null
        val target = File(dir, "album-$albumId")
        if (target.isFile && target.length() > 0) return target
        val base = origin() ?: return null
        return try {
            client.newCall(Request.Builder().url("$base/api/artwork/$albumId").build()).execute().use { res ->
                val body = res.body
                if (!res.isSuccessful || body == null) return null
                dir.mkdirs()
                val partial = File(dir, "album-$albumId.part")
                partial.outputStream().use { out -> body.byteStream().copyTo(out) }
                if (partial.renameTo(target)) target else null
            }
        } catch (_: IOException) {
            null
        }
    }

    /** Switching servers: the album ids mean something else now. */
    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }
}
```

`ArtworkProvider.kt`:

```kotlin
package app.spotless.android.library

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import app.spotless.android.graph
import java.io.FileNotFoundException

/**
 * content://app.spotless.android.art/album/<id> — album covers for Android Auto, which can't send the
 * session cookie itself. Not exported: the car gets read access per URI (grantToCar).
 */
class ArtworkProvider : ContentProvider() {
    override fun onCreate() = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("read only")
        val albumId = uri.pathSegments.takeIf { it.size == 2 && it[0] == "album" }?.get(1)?.toIntOrNull()
            ?: throw FileNotFoundException(uri.toString())
        val file = context!!.graph.artwork.file(albumId) ?: throw FileNotFoundException(uri.toString())
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri) = "image/*"
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

    companion object {
        const val AUTHORITY = "app.spotless.android.art"
        private const val ANDROID_AUTO = "com.google.android.projection.gearhead"

        fun uriFor(albumId: Int): Uri = Uri.Builder().scheme("content").authority(AUTHORITY).appendPath("album").appendPath(albumId.toString()).build()

        fun grantToCar(context: Context, uri: Uri) =
            context.grantUriPermission(ANDROID_AUTO, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
}
```

In `AppGraph.kt` add (the constructor already receives `context`; store it as a property first: change `class AppGraph(context: Context)` to `class AppGraph(private val context: Context)`):

```kotlin
    val artwork = ArtworkCache(java.io.File(context.cacheDir, "artwork"), http) { origin }
```

declared after `http`. In `setOrigin`, clear covers when the server changes:

```kotlin
    suspend fun setOrigin(value: String?) {
        if (value != origin) artwork.clear()
        serverStore.set(value)
        origin = value
    }
```

In the manifest, inside `<application>`:

```xml
        <provider
            android:name=".library.ArtworkProvider"
            android:authorities="app.spotless.android.art"
            android:exported="false"
            android:grantUriPermissions="true" />
```

- [ ] **Step 4: Run the test and build**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.library.*" assembleDebug`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: album art for the car via a content provider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Library session — browse, play, search

**Files:**
- Modify: `android/app/src/main/java/app/spotless/android/playback/PlaybackEngine.kt` (add `queueFromLibrary`)
- Modify: `android/app/src/main/java/app/spotless/android/playback/SessionCallback.kt` (replace the whole file)
- Modify: `android/app/src/main/java/app/spotless/android/playback/PlaybackService.kt`
- Create: `android/app/src/main/res/xml/automotive_app_desc.xml`
- Modify: `android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: `LibraryTree`, `MediaIds`, `BrowseNode`, `HttpLibrarySource` (Tasks 1–2); `ArtworkProvider` (Task 3); `QueueModel.replaceFromNative`, engine internals (P1).
- Produces: `PlaybackEngine.queueFromLibrary(tracks: List<TrackDto>, index: Int): List<MediaItem>`; `class SessionCallback(engine, tree, context) : MediaLibrarySession.Callback`.

> **Updated after P1 shipped:** P1's `SessionCallback` identifies the app's own controllers by `controller.uid == Process.myUid()` (Media3 takes `packageName` from the connecting app unverified), takes no `ownPackage` parameter, and gives other apps transport commands only (no `COMMAND_SET_MEDIA_ITEM` / `COMMAND_CHANGE_MEDIA_ITEMS`). Keep the UID gate. For P2, other controllers (Android Auto, assistants) need the library commands and `COMMAND_SET_MEDIA_ITEM` so they can play a browse id or a search; that is safe because `onSetMediaItems` below resolves only `play:` ids and search queries and rejects anything else for non-own controllers (do not fall through to `super.onSetMediaItems` for them — that would let another app queue arbitrary URIs). Still withhold `COMMAND_CHANGE_MEDIA_ITEMS` from them. Adapt the code below accordingly: replace `controller.packageName != ownPackage` / `== ownPackage` with the UID check, and in `onSetMediaItems` return a failed future for non-own controllers whose items are neither a `play:` id nor a search.

- [ ] **Step 1: Add `queueFromLibrary` to `PlaybackEngine`**

Add this public method in the "Commands from the page" section:

```kotlin
    /**
     * A queue chosen in the car or by voice. Native owns it: the page is told through a `queue` event with a
     * new version. Returns the items for the session to put on the player.
     */
    fun queueFromLibrary(tracks: List<TrackDto>, index: Int): List<MediaItem> {
        queue.replaceFromNative(tracks, index)
        items.clear()
        currentId = null
        val media = tracks.map { buildItem(it) }
        handler.post { emitQueue(); persistSoon() }
        return media
    }
```

- [ ] **Step 2: Replace `SessionCallback.kt`**

```kotlin
package app.spotless.android.playback

import android.content.Context
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import app.spotless.android.bridge.BridgeJson
import app.spotless.android.library.ArtworkProvider
import app.spotless.android.library.BrowseNode
import app.spotless.android.library.LibraryTree
import app.spotless.android.library.MediaIds
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.guava.future

/**
 * The session's answers: Spotless commands for this app's own controllers (as in P1), and the browse tree,
 * search and play-by-id for Android Auto and voice assistants.
 */
@UnstableApi
class SessionCallback(
    private val engine: PlaybackEngine,
    private val ownPackage: String,
    private val tree: LibraryTree,
    private val context: Context,
) : MediaLibrarySession.Callback {
    val ownControllers = LinkedHashSet<MediaSession.ControllerInfo>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val command = SessionCommand(BridgeJson.CMD, Bundle.EMPTY)

    // --- P1: the page's commands -------------------------------------------------------------------

    override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
        if (controller.packageName != ownPackage) return super.onConnect(session, controller)
        ownControllers += controller
        val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon().add(command).build()
        return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands).build()
    }

    override fun onDisconnected(session: MediaSession, controller: MediaSession.ControllerInfo) {
        ownControllers -= controller
    }

    override fun onCustomCommand(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
        customCommand: SessionCommand,
        args: Bundle,
    ): ListenableFuture<SessionResult> {
        if (customCommand.customAction == BridgeJson.CMD && controller.packageName == ownPackage) {
            args.getString(BridgeJson.KEY)?.let(BridgeJson::parseCommand)?.let(engine::handle)
        }
        return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    override fun onPlaybackResumption(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = engine.resumption()

    // --- P2: browsing ------------------------------------------------------------------------------

    override fun onGetLibraryRoot(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> =
        Futures.immediateFuture(LibraryResult.ofItem(toItem(BrowseNode.Folder(MediaIds.ROOT, "Spotless")), params))

    override fun onGetChildren(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        parentId: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = scope.future {
        val nodes = tree.children(parentId)
        LibraryResult.ofItemList(pageOf(nodes, page, pageSize).map(::toItem), params)
    }

    override fun onGetItem(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> = scope.future {
        tree.children(MediaIds.ROOT).firstOrNull { it.id == mediaId }?.let { LibraryResult.ofItem(toItem(it), null) }
            ?: LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
    }

    override fun onSearch(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        query: String,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<Void>> = scope.future {
        session.notifySearchResultChanged(browser, query, tree.search(query).size, params)
        LibraryResult.ofVoid()
    }

    override fun onGetSearchResult(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        query: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = scope.future {
        LibraryResult.ofItemList(pageOf(tree.search(query), page, pageSize).map(::toItem), params)
    }

    // --- P2: playing what was picked (or asked for) -------------------------------------------------

    override fun onSetMediaItems(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaItems: MutableList<MediaItem>,
        startIndex: Int,
        startPositionMs: Long,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
        val single = mediaItems.singleOrNull()
        val query = single?.requestMetadata?.searchQuery
        val playId = single?.mediaId?.takeIf { MediaIds.parsePlay(it) != null }
        if (query == null && playId == null) {
            return super.onSetMediaItems(mediaSession, controller, mediaItems, startIndex, startPositionMs)
        }
        return scope.future {
            val (tracks, start) = when {
                playId != null -> tree.resolve(playId) ?: (emptyList<app.spotless.android.bridge.TrackDto>() to 0)
                // "play X on Spotless": the best matches, best first; an empty query means "play something"
                !query.isNullOrBlank() -> tree.searchTracks(query) to 0
                else -> tree.resolve(MediaIds.play(MediaIds.LIKED, 0))?.let { it.first.shuffled() to 0 } ?: (emptyList<app.spotless.android.bridge.TrackDto>() to 0)
            }
            if (tracks.isEmpty()) throw IllegalStateException("nothing to play")
            MediaSession.MediaItemsWithStartPosition(engine.queueFromLibrary(tracks, start), start, 0)
        }
    }

    // --- helpers -----------------------------------------------------------------------------------

    private fun <T> pageOf(list: List<T>, page: Int, pageSize: Int): List<T> {
        if (pageSize <= 0 || pageSize == Int.MAX_VALUE) return list
        val from = (page * pageSize).coerceAtMost(list.size)
        return list.subList(from, (from + pageSize).coerceAtMost(list.size))
    }

    private fun toItem(node: BrowseNode): MediaItem {
        val art = node.albumId?.let { ArtworkProvider.uriFor(it).also { uri -> ArtworkProvider.grantToCar(context, uri) } }
        val metadata = MediaMetadata.Builder()
            .setTitle(node.title)
            .setSubtitle(node.subtitle)
            .setArtist(node.subtitle)
            .setArtworkUri(art)
            .setIsBrowsable(node is BrowseNode.Folder)
            .setIsPlayable(node is BrowseNode.Playable)
            .setMediaType(if (node is BrowseNode.Folder) MediaMetadata.MEDIA_TYPE_FOLDER_MIXED else MediaMetadata.MEDIA_TYPE_MUSIC)
            .build()
        return MediaItem.Builder().setMediaId(node.id).setMediaMetadata(metadata).build()
    }
}
```

(If the resolved Media3 version lacks `SessionError`, use `LibraryResult.RESULT_ERROR_BAD_VALUE`; if `DEFAULT_SESSION_AND_LIBRARY_COMMANDS` is named differently, use that version's library default command set.)

- [ ] **Step 3: Make the service a `MediaLibraryService`**

In `PlaybackService.kt`:

- change `class PlaybackService : MediaSessionService()` to `class PlaybackService : MediaLibraryService()`,
- change `private var session: MediaSession? = null` to `private var session: MediaLibrarySession? = null`,
- build the callback with the tree:

```kotlin
        val tree = LibraryTree(HttpLibrarySource(graph.http) { graph.origin })
        callback = SessionCallback(engine, packageName, tree, this)
```

- build the session with `MediaLibrarySession.Builder(this, engine.player, callback)` instead of `MediaSession.Builder(this, engine.player).setCallback(callback)` (keep `.setBitmapLoader(...)`, `setSessionActivity`, `.build()`),
- change `onGetSession` to `override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session`,
- update imports: `androidx.media3.session.MediaLibraryService`, `androidx.media3.session.MediaLibraryService.MediaLibrarySession`, `app.spotless.android.library.HttpLibrarySource`, `app.spotless.android.library.LibraryTree`; drop `MediaSessionService`.

- [ ] **Step 4: Declare Android Auto support**

`res/xml/automotive_app_desc.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<automotiveApp>
    <uses name="media" />
</automotiveApp>
```

In the manifest, inside `<application>`:

```xml
        <meta-data
            android:name="com.google.android.gms.car.application"
            android:resource="@xml/automotive_app_desc" />
```

and give the service's intent filter the library and legacy browser actions:

```xml
            <intent-filter>
                <action android:name="androidx.media3.session.MediaLibraryService" />
                <action android:name="android.media.browse.MediaBrowserService" />
            </intent-filter>
```

- [ ] **Step 5: Build and run all tests**

Run: `cd android && ./gradlew assembleDebug testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add android/app/src && git commit -m "Android: Android Auto browse, search and play

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Voice search from the phone

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/ui/VoiceSearch.kt`
- Modify: `android/app/src/main/java/app/spotless/android/ui/MainActivity.kt`, `android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: `PlaybackService` session (Task 4 `onSetMediaItems` search path).
- Produces: `object VoiceSearch { fun play(context: Context, query: String?) }`; `MainActivity` handles `android.media.action.MEDIA_PLAY_FROM_SEARCH`.

- [ ] **Step 1: Write `VoiceSearch.kt`**

```kotlin
package app.spotless.android.ui

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.spotless.android.playback.PlaybackService

/** "Play X on Spotless" outside the car: hand the query to the session, which searches and plays. */
object VoiceSearch {
    fun play(context: Context, query: String?) {
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        future.addListener({
            val controller = runCatching { future.get() }.getOrNull() ?: return@addListener
            val request = MediaItem.RequestMetadata.Builder().setSearchQuery(query.orEmpty()).build()
            controller.setMediaItem(MediaItem.Builder().setRequestMetadata(request).build())
            controller.prepare()
            controller.play()
            MediaController.releaseFuture(future)
        }, ContextCompat.getMainExecutor(context))
    }
}
```

- [ ] **Step 2: Route the intent in `MainActivity`**

At the end of `onCreate`, replace

```kotlin
        if (intent?.action == ACTION_CHANGE_SERVER) showSetup() else start(graph.origin)
```

with

```kotlin
        if (intent?.action == ACTION_CHANGE_SERVER) showSetup() else start(graph.origin)
        handleVoice(intent)
```

and in `onNewIntent` add `handleVoice(intent)` after the existing line. Add:

```kotlin
    private fun handleVoice(intent: Intent?) {
        if (intent?.action != MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH || graph.origin == null) return
        VoiceSearch.play(this, intent.getStringExtra(SearchManager.QUERY))
    }
```

with imports `android.app.SearchManager` and `android.provider.MediaStore`.

- [ ] **Step 3: Declare the intent filter**

Inside the `MainActivity` `<activity>` element, after the launcher filter:

```xml
            <intent-filter>
                <action android:name="android.media.action.MEDIA_PLAY_FROM_SEARCH" />
                <category android:name="android.intent.category.DEFAULT" />
            </intent-filter>
```

- [ ] **Step 4: Build**

Run: `cd android && ./gradlew assembleDebug testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: play from voice search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verify in a car (or the Desktop Head Unit) and document

**Files:**
- Modify: `README.md` (Android app section)

Needs the user's phone. **Ask the user to connect it** before starting.

- [ ] **Step 1: Prepare Android Auto for a sideloaded app**

On the phone: Android Auto settings → tap "Version" 10 times to unlock developer settings → ⋮ → Developer settings → enable "Unknown sources". Install the debug APK: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 2: Connect the Desktop Head Unit (or a car)**

DHU: in Android Auto developer settings choose "Start head unit server"; on the PC run `adb forward tcp:5277 tcp:5277` and start `desktop-head-unit.exe` from `%LOCALAPPDATA%\Android\Sdk\extras\google\auto\` (install "Android Auto Desktop Head Unit Emulator" with the SDK manager if missing).

- [ ] **Step 3: Checklist**

1. Spotless appears among media apps; Home, Playlists, Liked Songs, Radio show with covers.
2. Picking a playlist track plays from that track and continues through the playlist.
3. Album rows in Home open the album; radio stations play live.
4. Car search (magnifier) finds a song and plays it.
5. Voice: "Hey Google, play <artist> on Spotless" (on the phone and in the car) starts matching music. Record whether the phone's assistant (Assistant or Gemini) supports it; best effort.
6. Opening the app on the phone afterwards shows the car's queue in the web player (queue event).
7. Previous / next / pause from the car and from the steering wheel.

- [ ] **Step 4: Document**

Append to the README's Android app section:

```markdown
**Android Auto:** Spotless shows up as a media app with Home, Playlists, Liked Songs and Radio. Because the app is
installed from GitHub rather than the Play Store, Android Auto only lists it after you turn on its developer
setting "Unknown sources" (Android Auto settings → tap Version ten times → ⋮ → Developer settings).
"Hey Google, play … on Spotless" searches your library and plays the best match where your phone's assistant
supports media apps.
```

- [ ] **Step 5: Commit**

```bash
git add README.md && git commit -m "Docs: Android Auto and voice search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
