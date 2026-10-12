# Spotless for Android — P1: App Shell and Native Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installable Android app that shows the Spotless web UI and plays music through a native Media3 engine, so playback survives the screen being off and gets lock-screen, notification, Bluetooth and Wear OS controls.

**Architecture:** A Kotlin app in `android/` hosts the server's pages in a WebView. A Media3 `MediaSessionService` owns an ExoPlayer and everything the web `<audio>` engine did (ReplayGain, 10-band EQ, adaptive quality, stall recovery, history/scrobbles, sleep timer, DJ voice). The page and the service talk over an origin-locked web-message bridge (JSON), relayed by the activity through a `MediaController` custom command. On the web side, a small sync module mirrors the zustand player store to native and native events back into the store; `Player.tsx` stops rendering its `<audio>` elements when native is active.

**Tech Stack:** Kotlin 2.2, Android Gradle Plugin 8.12, Media3 1.8 (ExoPlayer, session, OkHttp data source), androidx.webkit, Jetpack Compose (setup/error screens), DataStore, OkHttp 4, kotlinx.serialization, JUnit 4. Web: TypeScript, zustand, vitest.

Spec: `docs/superpowers/specs/2026-10-11-android-app-design.md`.

## Global Constraints

- Package and application id: `app.spotless.android`. minSdk 26, compileSdk 36, targetSdk 36. Java/Kotlin JVM target 17.
- Library versions (pin exactly; if one fails to resolve, use the newest patch release of the same minor that resolves and note it in the commit message): AGP 8.12.0, Gradle 8.14.3, Kotlin 2.2.10, Media3 1.8.0, androidx.webkit 1.14.0, Compose BOM 2025.08.00, activity-compose 1.10.1, core-ktx 1.16.0, lifecycle-runtime-ktx 2.9.2, datastore-preferences 1.1.7, OkHttp 4.12.0, kotlinx-serialization-json 1.9.0, kotlinx-coroutines 1.10.2, JUnit 4.13.2.
- No Google Play Services, no Firebase, no analytics: the app must stay F-Droid and Play compatible.
- `versionName` = root `package.json` `version`; `versionCode` = `major*10000 + minor*100 + patch`.
- Bridge protocol version: `1`. JS object name: `SpotlessNative`. Session custom command actions: `spotless.cmd` (to the service) and `spotless.evt` (from the service); the JSON travels in the bundle key `json`.
- Browser and desktop playback behavior must not change. Every web change is gated on native being active.
- Never commit LAN IPs, NAS paths, keystores or `local.properties`.
- All Android work is on the JVM-testable side where possible; Android-framework glue is verified by building and by the manual checklist in Task 18.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Work happens on branch `android-app` (already created).

## File Structure

```
android/
  .gitignore
  settings.gradle.kts, build.gradle.kts, gradle.properties
  gradle/libs.versions.toml, gradle/wrapper/*, gradlew, gradlew.bat
  app/build.gradle.kts
  app/src/main/AndroidManifest.xml
  app/src/main/res/{mipmap-xxxhdpi/ic_launcher.png, values/strings.xml, values/themes.xml, xml/network_security_config.xml, xml/shortcuts.xml}
  app/src/main/java/app/spotless/android/
    SpotlessApp.kt                 Application; owns AppGraph
    AppGraph.kt                    shared OkHttp client, API, server origin, app scope
    net/ServerAddress.kt           normalize "nas:4000" -> "http://nas:4000"
    net/Health.kt                  classify /api/health answers
    net/ServerStore.kt             DataStore for the server origin
    net/SharedCookieJar.kt         WebView cookies -> OkHttp
    net/SpotlessApi.kt             health check, history POST, 401 interceptor
    bridge/BridgeProtocol.kt       TrackDto, BridgeCommand, BridgeEvent, BridgeJson
    playback/Quality.kt            Rung ladder, NetworkInfo, QualityPolicy (port of adaptive.ts)
    playback/Levels.kt             ReplayGain / duck volume formula
    playback/PlayTracker.kt        history/scrobble rules
    playback/QueueModel.kt         queue mirror, sync rules, persistence trimming, SessionSnapshot
    playback/TrackUrls.kt          stream / artwork URLs for a track
    playback/eq/Biquad.kt          Web Audio biquad coefficient formulas
    playback/eq/EqFilterBank.kt    10-band filter chain over PCM16 samples
    playback/eq/EqAudioProcessor.kt Media3 AudioProcessor wrapper
    playback/StreamPlayer.kt       ForwardingPlayer: transcode offsets, tagged duration, seeks
    playback/NetworkWatcher.kt     ConnectivityManager -> NetworkInfo
    playback/SessionStore.kt       DataStore for the last queue
    playback/VoicePlayer.kt        DJ talk-over clips + Android TextToSpeech
    playback/PlaybackEngine.kt     owns ExoPlayer; handles bridge commands; emits events
    playback/PlaybackService.kt    MediaSessionService
    playback/SessionCallback.kt    custom commands, own-package gate, resumption
    ui/UrlPolicy.kt                which URLs stay in the WebView
    ui/WebBridge.kt                web messages <-> MediaController custom commands
    ui/WebHost.kt                  WebView factory: settings, clients, permissions
    ui/Screens.kt                  Compose setup + can't-reach-server screens
    ui/MainActivity.kt
  app/src/test/java/app/spotless/android/...  JUnit tests mirroring the files above
src/lib/client/nativeBridge.ts     (new) handshake + typed messages
src/lib/client/nativeSync.ts       (new) store <-> native mirror, useNative store
src/lib/client/__tests__/nativeBridge.test.ts, nativeSync.test.ts, djVoice.test.ts (new)
src/lib/client/djVoice.ts          (modify) route DJ voice to native
src/components/Player.tsx          (modify) native engine switch
src/app/settings/page.tsx          (modify) crossfade note, Change server button
vitest.config.ts                   (no change: already includes src/**/__tests__/**/*.test.ts)
.github/workflows/android.yml      (new)
.github/workflows/docker.yml       (modify) release attaches the APK
README.md, CHANGELOG.md            (modify)
```

---

### Task 1: Android project skeleton that builds

**Files:**
- Create: `android/.gitignore`, `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/gradle/libs.versions.toml`, `android/app/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/values/strings.xml`, `android/app/src/main/res/values/themes.xml`, `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` (copy), `android/gradlew`, `android/gradlew.bat`, `android/gradle/wrapper/gradle-wrapper.jar`, `android/gradle/wrapper/gradle-wrapper.properties`
- Test: `android/app/src/test/java/app/spotless/android/VersionCodeTest.kt`

**Interfaces:**
- Produces: a Gradle project at `android/` with module `:app`; `./gradlew testDebugUnitTest assembleDebug` works; `BuildConfig.VERSION_NAME` available to later tasks.

- [ ] **Step 1: Write `android/.gitignore`**

```gitignore
.gradle/
.kotlin/
build/
local.properties
.idea/
captures/
*.iml
*.jks
*.keystore
dist/
```

- [ ] **Step 2: Write `android/settings.gradle.kts`**

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "spotless-android"
include(":app")
```

- [ ] **Step 3: Write `android/build.gradle.kts` and `android/gradle.properties`**

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
```

```properties
org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
```

- [ ] **Step 4: Write `android/gradle/libs.versions.toml`**

```toml
[versions]
agp = "8.12.0"
kotlin = "2.2.10"
media3 = "1.8.0"
webkit = "1.14.0"
composeBom = "2025.08.00"
activityCompose = "1.10.1"
coreKtx = "1.16.0"
lifecycle = "2.9.2"
datastore = "1.1.7"
okhttp = "4.12.0"
serialization = "1.9.0"
coroutines = "1.10.2"
junit = "4.13.2"

[libraries]
androidx-core-ktx = { module = "androidx.core:core-ktx", version.ref = "coreKtx" }
androidx-activity-compose = { module = "androidx.activity:activity-compose", version.ref = "activityCompose" }
androidx-lifecycle-runtime = { module = "androidx.lifecycle:lifecycle-runtime-ktx", version.ref = "lifecycle" }
androidx-webkit = { module = "androidx.webkit:webkit", version.ref = "webkit" }
androidx-datastore = { module = "androidx.datastore:datastore-preferences", version.ref = "datastore" }
compose-bom = { module = "androidx.compose:compose-bom", version.ref = "composeBom" }
compose-ui = { module = "androidx.compose.ui:ui" }
compose-material3 = { module = "androidx.compose.material3:material3" }
media3-exoplayer = { module = "androidx.media3:media3-exoplayer", version.ref = "media3" }
media3-session = { module = "androidx.media3:media3-session", version.ref = "media3" }
media3-okhttp = { module = "androidx.media3:media3-datasource-okhttp", version.ref = "media3" }
okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }
okhttp-mockwebserver = { module = "com.squareup.okhttp3:mockwebserver", version.ref = "okhttp" }
kotlinx-serialization-json = { module = "org.jetbrains.kotlinx:kotlinx-serialization-json", version.ref = "serialization" }
kotlinx-coroutines-android = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-android", version.ref = "coroutines" }
kotlinx-coroutines-guava = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-guava", version.ref = "coroutines" }
junit = { module = "junit:junit", version.ref = "junit" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

- [ ] **Step 5: Write `android/app/build.gradle.kts`**

```kotlin
import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// The app carries the server's version: read it from the repository's package.json.
val pkgVersion: String =
    (JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>)["version"] as String

/** "0.3.1" -> 301, "1.12.4-rc.1" -> 11204. */
fun versionCodeOf(version: String): Int {
    val (major, minor, patch) = version.substringBefore('-').split('.').map { it.toInt() }
    return major * 10000 + minor * 100 + patch
}

// Release signing comes from CI secrets (see .github/workflows/android.yml); without them the release
// build is unsigned and only the debug APK is installable.
val keystoreFile: String? = System.getenv("ANDROID_KEYSTORE_FILE")

android {
    namespace = "app.spotless.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.spotless.android"
        minSdk = 26
        targetSdk = 36
        versionName = pkgVersion
        versionCode = versionCodeOf(pkgVersion)
    }

    signingConfigs {
        create("release") {
            if (keystoreFile != null) {
                storeFile = file(keystoreFile)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystoreFile != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        // android.* calls in JVM tests return defaults instead of throwing
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.datastore)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.session)
    implementation(libs.media3.okhttp)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.guava)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
}
```

- [ ] **Step 6: Write the manifest and resources**

`android/app/src/main/AndroidManifest.xml` (activity and service are added in later tasks):

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.Spotless" />
</manifest>
```

`android/app/src/main/res/values/strings.xml`:

```xml
<resources>
    <string name="app_name">Spotless</string>
    <string name="shortcut_change_server">Change server</string>
</resources>
```

`android/app/src/main/res/values/themes.xml`:

```xml
<resources>
    <style name="Theme.Spotless" parent="android:Theme.Material.NoActionBar">
        <item name="android:windowBackground">@android:color/black</item>
        <item name="android:statusBarColor">@android:color/black</item>
        <item name="android:navigationBarColor">@android:color/black</item>
    </style>
</resources>
```

Copy the icon (run from the repo root):

```bash
mkdir -p android/app/src/main/res/mipmap-xxxhdpi && cp public/icon-maskable-512.png android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
```

- [ ] **Step 7: Write a failing test for the version code rule**

`versionCodeOf` lives in the Gradle script, so the test pins the same rule in a tiny Kotlin helper that the app also uses for its "About" string later. Create `android/app/src/test/java/app/spotless/android/VersionCodeTest.kt`:

```kotlin
package app.spotless.android

import org.junit.Assert.assertEquals
import org.junit.Test

class VersionCodeTest {
    @Test
    fun `version code follows the package json version`() {
        val (major, minor, patch) = BuildConfig.VERSION_NAME.substringBefore('-').split('.').map { it.toInt() }
        assertEquals(major * 10000 + minor * 100 + patch, BuildConfig.VERSION_CODE)
    }
}
```

- [ ] **Step 8: Generate the Gradle wrapper**

No Gradle is installed on this machine; download the distribution once into the scratchpad and use it to write the wrapper (run in Git Bash from the repo root; `$SCRATCH` is the session scratchpad directory):

```bash
SCRATCH="$(mktemp -d)" && curl -fsSL -o "$SCRATCH/gradle.zip" https://services.gradle.org/distributions/gradle-8.14.3-bin.zip && unzip -q "$SCRATCH/gradle.zip" -d "$SCRATCH" && (cd android && "$SCRATCH/gradle-8.14.3/bin/gradle" wrapper --gradle-version 8.14.3 --distribution-type bin)
```

Expected: `android/gradlew`, `android/gradlew.bat`, `android/gradle/wrapper/gradle-wrapper.jar`, `android/gradle/wrapper/gradle-wrapper.properties` exist. Mark the script executable in git:

```bash
git add android/gradlew && git update-index --chmod=+x android/gradlew
```

- [ ] **Step 9: Point Gradle at the local Android SDK (not committed)**

```bash
printf 'sdk.dir=%s\n' "$(cygpath -m "$LOCALAPPDATA/Android/Sdk")" > android/local.properties
```

- [ ] **Step 10: Build and run the test**

Run: `cd android && ./gradlew testDebugUnitTest assembleDebug`
Expected: `BUILD SUCCESSFUL`; `VersionCodeTest` passes; `android/app/build/outputs/apk/debug/app-debug.apk` exists.

If the build fails because platform 36 is missing: `"$LOCALAPPDATA/Android/Sdk/cmdline-tools/latest/bin/sdkmanager.bat" "platforms;android-36"`.

- [ ] **Step 11: Commit**

```bash
git add android/ && git commit -m "Android: project skeleton

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Server address normalization and health classification

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/net/ServerAddress.kt`, `android/app/src/main/java/app/spotless/android/net/Health.kt`
- Test: `android/app/src/test/java/app/spotless/android/net/ServerAddressTest.kt`, `android/app/src/test/java/app/spotless/android/net/HealthTest.kt`

**Interfaces:**
- Produces: `ServerAddress.normalize(input: String?): String?`, `ServerAddress.origin(url: okhttp3.HttpUrl): String`; `sealed interface Health { data class Ok(val version: String?); data class Problem(val message: String) }`; `HealthCheck.classify(origin: String, httpStatus: Int, body: String?): Health`; `HealthCheck.unreachable(origin: String, reason: String): Health.Problem`.

- [ ] **Step 1: Write the failing tests**

`ServerAddressTest.kt`:

```kotlin
package app.spotless.android.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerAddressTest {
    @Test fun `adds http to a bare host and port`() = assertEquals("http://nas:4000", ServerAddress.normalize("nas:4000"))
    @Test fun `keeps only the origin`() = assertEquals("http://nas:4000", ServerAddress.normalize("http://nas:4000/library?x=1"))
    @Test fun `trims whitespace`() = assertEquals("http://192.168.1.10:3000", ServerAddress.normalize("  192.168.1.10:3000  "))
    @Test fun `keeps https`() = assertEquals("https://music.example.com", ServerAddress.normalize("https://music.example.com/"))
    @Test fun `drops the default port and lowercases`() = assertEquals("http://nas", ServerAddress.normalize("HTTP://NAS:80/"))
    @Test fun `brackets ipv6 hosts`() = assertEquals("http://[::1]:3000", ServerAddress.normalize("http://[::1]:3000"))
    @Test fun `rejects other schemes`() = assertNull(ServerAddress.normalize("ftp://nas"))
    @Test fun `rejects junk`() = assertNull(ServerAddress.normalize("javascript:alert(1)"))
    @Test fun `rejects empty`() {
        assertNull(ServerAddress.normalize(""))
        assertNull(ServerAddress.normalize("   "))
        assertNull(ServerAddress.normalize(null))
    }
}
```

`HealthTest.kt`:

```kotlin
package app.spotless.android.net

import org.junit.Assert.assertEquals
import org.junit.Test

class HealthTest {
    private val origin = "http://nas:4000"

    @Test fun `ok true is a working server`() =
        assertEquals(Health.Ok("0.3.1"), HealthCheck.classify(origin, 200, """{"ok":true,"version":"0.3.1"}"""))

    @Test fun `ok false is a sick server`() =
        assertEquals(
            Health.Problem("The Spotless server at http://nas:4000 is running but reported a problem (HTTP 503)."),
            HealthCheck.classify(origin, 503, """{"ok":false}"""),
        )

    @Test fun `html is some other app`() =
        assertEquals(
            Health.Problem("http://nas:4000 answered, but it does not look like a Spotless server."),
            HealthCheck.classify(origin, 200, "<html></html>"),
        )

    @Test fun `json without ok is some other app`() =
        assertEquals(
            Health.Problem("http://nas:4000 answered, but it does not look like a Spotless server."),
            HealthCheck.classify(origin, 200, """{"status":"up"}"""),
        )

    @Test fun `unreachable message`() =
        assertEquals(Health.Problem("Could not reach http://nas:4000: timeout."), HealthCheck.unreachable(origin, "timeout"))
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.net.*"`
Expected: compilation fails — `ServerAddress`, `HealthCheck` unresolved.

- [ ] **Step 3: Implement**

`ServerAddress.kt`:

```kotlin
package app.spotless.android.net

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Same rules as normalizeServer in desktop/main.js: "nas:4000" or "http://nas:4000/library" -> "http://nas:4000". */
object ServerAddress {
    private val SCHEME = Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE)

    /** The origin for what the user typed, or null when it is not an http(s) address. */
    fun normalize(input: String?): String? {
        val text = input?.trim().orEmpty()
        if (text.isEmpty()) return null
        val withScheme = if (SCHEME.containsMatchIn(text)) text else "http://$text"
        // HttpUrl only parses http and https, so every other scheme comes back null here
        val url = withScheme.toHttpUrlOrNull() ?: return null
        return origin(url)
    }

    /** "scheme://host[:port]" with the default port left out, like URL.origin in a browser. */
    fun origin(url: HttpUrl): String {
        val host = if (url.host.contains(':')) "[${url.host}]" else url.host
        val port = if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"
        return "${url.scheme}://$host$port"
    }
}
```

`Health.kt`:

```kotlin
package app.spotless.android.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

sealed interface Health {
    data class Ok(val version: String?) : Health
    data class Problem(val message: String) : Health
}

/** Reads the server's public /api/health probe the same way the desktop app does. */
object HealthCheck {
    fun classify(origin: String, httpStatus: Int, body: String?): Health {
        val json = body?.let { runCatching { Json.parseToJsonElement(it) as? JsonObject }.getOrNull() }
        return when ((json?.get("ok") as? JsonPrimitive)?.booleanOrNull) {
            true -> Health.Ok((json?.get("version") as? JsonPrimitive)?.contentOrNull)
            false -> Health.Problem("The Spotless server at $origin is running but reported a problem (HTTP $httpStatus).")
            null -> Health.Problem("$origin answered, but it does not look like a Spotless server.")
        }
    }

    fun unreachable(origin: String, reason: String) = Health.Problem("Could not reach $origin: $reason.")
}
```

- [ ] **Step 4: Run the tests**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.net.*"`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: server address and health check rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Quality ladder (port of `src/lib/adaptive.ts`)

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/playback/Quality.kt`
- Test: `android/app/src/test/java/app/spotless/android/playback/QualityTest.kt`

**Interfaces:**
- Produces: `enum class Rung(val id: String, val bitrate: Int) { RAW, HIGH, NORMAL, SAVER }` with `Rung.byId(id: String?): Rung?`; `data class NetworkInfo(supported: Boolean, metered: Boolean, downlinkMbps: Double? = null, saveData: Boolean = false)`; `class QualityPolicy(now: () -> Long)` with `var setting: String`, `var network: NetworkInfo`, `val isAuto: Boolean`, `fun current(): Rung`, `fun noteStall(): Int`, `fun resetStalls()`; companion `networkRung(net: NetworkInfo): Int`, `isLower(a: Rung, b: Rung): Boolean`, `streamQuery(rung: Rung, offsetSec: Double = 0.0): String`, `STALL_RECOVERY_MS = 90_000L`.

- [ ] **Step 1: Write the failing test**

```kotlin
package app.spotless.android.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QualityTest {
    private var clock = 1_000_000L
    private fun policy(setting: String = "auto", net: NetworkInfo = NetworkInfo(supported = true, metered = false)) =
        QualityPolicy { clock }.apply { this.setting = setting; network = net }

    @Test fun `fixed settings pick their rung`() {
        assertEquals(Rung.RAW, policy("raw").current())
        assertEquals(Rung.HIGH, policy("high").current())
        assertEquals(Rung.NORMAL, policy("normal").current())
        assertEquals(Rung.SAVER, policy("saver").current())
    }

    @Test fun `unknown setting falls back to raw`() = assertEquals(Rung.RAW, policy("bogus").current())

    @Test fun `auto follows the network`() {
        assertEquals(Rung.RAW, policy(net = NetworkInfo(supported = true, metered = false)).current())
        assertEquals(Rung.HIGH, policy(net = NetworkInfo(supported = true, metered = true)).current())
        assertEquals(Rung.HIGH, policy(net = NetworkInfo(supported = false, metered = false)).current())
        assertEquals(Rung.SAVER, policy(net = NetworkInfo(supported = true, metered = false, saveData = true)).current())
    }

    @Test fun `downlink only pulls the ceiling down`() {
        assertEquals(Rung.SAVER, policy(net = NetworkInfo(true, false, downlinkMbps = 0.5)).current())
        assertEquals(Rung.NORMAL, policy(net = NetworkInfo(true, false, downlinkMbps = 1.5)).current())
        assertEquals(Rung.HIGH, policy(net = NetworkInfo(true, false, downlinkMbps = 3.0)).current())
        assertEquals(Rung.RAW, policy(net = NetworkInfo(true, false, downlinkMbps = 50.0)).current())
        assertEquals(Rung.HIGH, policy(net = NetworkInfo(true, true, downlinkMbps = 50.0)).current())
    }

    @Test fun `each stall steps one rung down and recovers one per window`() {
        val p = policy()
        p.noteStall()
        assertEquals(Rung.HIGH, p.current())
        p.noteStall()
        assertEquals(Rung.NORMAL, p.current())
        clock += QualityPolicy.STALL_RECOVERY_MS
        assertEquals(Rung.HIGH, p.current())
        clock += QualityPolicy.STALL_RECOVERY_MS
        assertEquals(Rung.RAW, p.current())
    }

    @Test fun `stalls cap at the bottom rung`() {
        val p = policy()
        repeat(10) { p.noteStall() }
        assertEquals(Rung.SAVER, p.current())
    }

    @Test fun `choosing a fixed tier forgets stalls`() {
        val p = policy()
        p.noteStall()
        p.setting = "raw"
        p.setting = "auto"
        assertEquals(Rung.RAW, p.current())
    }

    @Test fun `isLower compares ladder positions`() {
        assertTrue(QualityPolicy.isLower(Rung.SAVER, Rung.RAW))
        assertFalse(QualityPolicy.isLower(Rung.RAW, Rung.SAVER))
        assertFalse(QualityPolicy.isLower(Rung.HIGH, Rung.HIGH))
    }

    @Test fun `stream query matches the web`() {
        assertEquals("", QualityPolicy.streamQuery(Rung.RAW))
        assertEquals("", QualityPolicy.streamQuery(Rung.RAW, 12.0))
        assertEquals("?format=mp3&maxBitRate=320", QualityPolicy.streamQuery(Rung.HIGH))
        assertEquals("?format=mp3&maxBitRate=128&offset=12.500", QualityPolicy.streamQuery(Rung.SAVER, 12.5))
    }
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.QualityTest"`
Expected: compilation fails — `QualityPolicy` unresolved.

- [ ] **Step 3: Implement `Quality.kt`**

```kotlin
package app.spotless.android.playback

import java.util.Locale

/** Quality ladder, best first. The ids double as the stored setting (same as RUNGS in src/lib/adaptive.ts). */
enum class Rung(val id: String, val bitrate: Int) {
    RAW("raw", 0),
    HIGH("high", 320),
    NORMAL("normal", 192),
    SAVER("saver", 128);

    companion object {
        fun byId(id: String?): Rung? = entries.firstOrNull { it.id == id }
    }
}

/** What Android tells us about the connection. */
data class NetworkInfo(
    val supported: Boolean,
    val metered: Boolean,
    val downlinkMbps: Double? = null,
    val saveData: Boolean = false,
)

/** Port of src/lib/adaptive.ts: the stored setting, the network ceiling and the stall history. */
class QualityPolicy(private val now: () -> Long = System::currentTimeMillis) {
    var setting: String = "raw"
        set(value) {
            field = if (value == "auto" || Rung.byId(value) != null) value else "raw"
            if (field != "auto") resetStalls()
        }

    var network: NetworkInfo = NetworkInfo(supported = false, metered = false)

    private var stalls = 0
    private var lastStallAt = 0L

    val isAuto: Boolean get() = setting == "auto"

    /** Rung to stream at right now, resolving "auto" against the live connection. */
    fun current(): Rung = if (isAuto) autoRung() else Rung.byId(setting) ?: Rung.RAW

    private fun autoRung(): Rung = Rung.entries[minOf(BOTTOM, networkRung(network) + stallPenalty())]

    /** Playback rebuffered; returns the penalty now in force. */
    fun noteStall(): Int {
        stalls = minOf(BOTTOM, stallPenalty() + 1)
        lastStallAt = now()
        return stalls
    }

    fun resetStalls() {
        stalls = 0
        lastStallAt = 0
    }

    /** Rungs currently forfeited by rebuffering, decaying one rung per recovery window. */
    private fun stallPenalty(): Int {
        if (stalls == 0) return 0
        val recovered = ((now() - lastStallAt) / STALL_RECOVERY_MS).toInt()
        return maxOf(0, stalls - recovered)
    }

    companion object {
        const val STALL_RECOVERY_MS = 90_000L
        private val BOTTOM = Rung.entries.size - 1

        /** Best rung the network allows before stall history (networkRung in adaptive.ts). */
        fun networkRung(net: NetworkInfo): Int {
            if (net.saveData) return BOTTOM
            if (!net.supported) return Rung.HIGH.ordinal
            var rung = if (net.metered) Rung.HIGH.ordinal else Rung.RAW.ordinal
            // the downlink estimate rolls, so it only ever pulls the ceiling down
            net.downlinkMbps?.let { mbps ->
                rung = when {
                    mbps < 1 -> BOTTOM
                    mbps < 2 -> maxOf(rung, Rung.NORMAL.ordinal)
                    mbps < 5 -> maxOf(rung, Rung.HIGH.ordinal)
                    else -> rung
                }
            }
            return minOf(rung, BOTTOM)
        }

        /** True when `a` sounds worse than `b` (further down the ladder). */
        fun isLower(a: Rung, b: Rung): Boolean = a.ordinal > b.ordinal

        /** Query string for /api/stream/<id> (streamQuery in adaptive.ts). */
        fun streamQuery(rung: Rung, offsetSec: Double = 0.0): String {
            if (rung.bitrate == 0) return ""
            val offset = if (offsetSec > 0) "&offset=" + String.format(Locale.US, "%.3f", offsetSec) else ""
            return "?format=mp3&maxBitRate=${rung.bitrate}$offset"
        }
    }
}
```

- [ ] **Step 4: Run the test**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.QualityTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: quality ladder ported from adaptive.ts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ReplayGain level and listening/history rules

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/playback/Levels.kt`, `android/app/src/main/java/app/spotless/android/playback/PlayTracker.kt`
- Test: `android/app/src/test/java/app/spotless/android/playback/LevelsTest.kt`, `android/app/src/test/java/app/spotless/android/playback/PlayTrackerTest.kt`

**Interfaces:**
- Produces: `object Levels { DUCK_GAIN = 0.3; fun gainMult(gain: Double?): Double; fun level(volume: Double, duck: Double, gain: Double?): Double }`; `enum class HistoryEvent { START, PLAYED }` with `val wire: String` ("start"/"played"); `data class HistoryReport(val trackId: Int, val event: HistoryEvent, val startedAt: Long?)`; `class PlayTracker(nowSeconds: () -> Long)` with `begin(trackId: Int, durationSec: Double, isLibrary: Boolean)`, `onPlaying(): HistoryReport?`, `onPosition(posSec: Double): HistoryReport?`, `onJump()`.

- [ ] **Step 1: Write the failing tests**

`LevelsTest.kt`:

```kotlin
package app.spotless.android.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class LevelsTest {
    @Test fun `no gain tag is unity`() = assertEquals(1.0, Levels.gainMult(null), 1e-9)
    @Test fun `minus six dB halves`() = assertEquals(0.501, Levels.gainMult(-6.0), 1e-3)
    @Test fun `boost is capped at 1_4`() = assertEquals(1.4, Levels.gainMult(12.0), 1e-9)
    @Test fun `level multiplies and caps at one`() {
        assertEquals(0.15, Levels.level(0.5, Levels.DUCK_GAIN, null), 1e-9)
        assertEquals(1.0, Levels.level(1.0, 1.0, 6.0), 1e-9)
    }
}
```

`PlayTrackerTest.kt`:

```kotlin
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.*Test"`
Expected: compilation fails — `Levels`, `PlayTracker` unresolved.

- [ ] **Step 3: Implement**

`Levels.kt`:

```kotlin
package app.spotless.android.playback

import kotlin.math.pow

/** Volume math shared with Player.tsx: ReplayGain on top of the user's volume and the DJ duck. */
object Levels {
    /** Music level while the DJ talks (DUCK_GAIN in src/lib/client/djVoice.ts). */
    const val DUCK_GAIN = 0.3

    /** ReplayGain dB -> multiplier, capped so a quiet track can't be pushed past 1.4x. */
    fun gainMult(gain: Double?): Double = if (gain == null) 1.0 else minOf(1.4, 10.0.pow(gain / 20))

    fun level(volume: Double, duck: Double, gain: Double?): Double = minOf(1.0, volume * duck * gainMult(gain))
}
```

`PlayTracker.kt`:

```kotlin
package app.spotless.android.playback

enum class HistoryEvent(val wire: String) { START("start"), PLAYED("played") }

data class HistoryReport(val trackId: Int, val event: HistoryEvent, val startedAt: Long?)

/**
 * The listening rules from Player.tsx: 'start' once per play (Last.fm "now playing"), 'played' once half the
 * track or 240 s has actually been heard. Only continuous playback counts — a jump between two position
 * samples larger than 2 s is a seek or a source swap, not listening.
 */
class PlayTracker(private val nowSeconds: () -> Long = { System.currentTimeMillis() / 1000 }) {
    private var trackId = 0
    private var library = false
    private var durationSec = 0.0
    private var listened = 0.0
    private var lastPos: Double? = null
    private var startPosted = false
    private var playedPosted = false
    private var startedAt = 0L

    /** A new track, or a replay of this one. */
    fun begin(trackId: Int, durationSec: Double, isLibrary: Boolean) {
        this.trackId = trackId
        this.durationSec = durationSec
        library = isLibrary
        listened = 0.0
        lastPos = null
        startPosted = false
        playedPosted = false
        startedAt = 0
    }

    /** Sound is coming out. */
    fun onPlaying(): HistoryReport? {
        if (startPosted || !library) return null
        startPosted = true
        startedAt = nowSeconds()
        return HistoryReport(trackId, HistoryEvent.START, null)
    }

    /** A position sample (the engine samples once a second while playing). */
    fun onPosition(posSec: Double): HistoryReport? {
        val last = lastPos
        lastPos = posSec
        if (last != null) {
            val delta = posSec - last
            if (delta > 0 && delta <= MAX_LISTEN_DELTA_S) listened += delta
        }
        if (playedPosted || !library) return null
        val threshold = if (durationSec > 0) minOf(durationSec / 2, PLAYED_CAP_S) else PLAYED_CAP_S
        if (listened < threshold) return null
        playedPosted = true
        return HistoryReport(trackId, HistoryEvent.PLAYED, startedAt.takeIf { it > 0 })
    }

    /** A seek or a source swap: the next sample must not count the jump. */
    fun onJump() {
        lastPos = null
    }

    companion object {
        const val PLAYED_CAP_S = 240.0
        const val MAX_LISTEN_DELTA_S = 2.0
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.*Test"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: ReplayGain level and history rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 10-band EQ (same curve as `src/lib/eq.ts`)

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/playback/eq/Biquad.kt`, `android/app/src/main/java/app/spotless/android/playback/eq/EqFilterBank.kt`, `android/app/src/main/java/app/spotless/android/playback/eq/EqAudioProcessor.kt`
- Test: `android/app/src/test/java/app/spotless/android/playback/eq/BiquadTest.kt`, `android/app/src/test/java/app/spotless/android/playback/eq/EqFilterBankTest.kt`

**Interfaces:**
- Produces: `enum class FilterType { LOWSHELF, PEAKING, HIGHSHELF }`; `data class Coefficients(b0, b1, b2, a1, a2: Double)` with `magnitudeDb(freq: Double, fs: Double): Double` and companion `design(type, freq, gainDb, q, fs): Coefficients`; `object EqBands { FREQS, MIN_DB, MAX_DB, PEAK_Q, typeOf(i) }`; `class EqFilterBank(channels: Int, sampleRate: Int)` with `set(enabled: Boolean, gains: DoubleArray)`, `val active: Boolean`, `process(samples: ShortArray, count: Int)`; `class EqAudioProcessor : BaseAudioProcessor` with `update(enabled: Boolean, gains: DoubleArray)`.

- [ ] **Step 1: Write the failing tests**

`BiquadTest.kt`:

```kotlin
package app.spotless.android.playback.eq

import org.junit.Assert.assertEquals
import org.junit.Test

class BiquadTest {
    private val rates = listOf(44100.0, 48000.0)

    @Test fun `peaking hits its gain at the centre frequency`() {
        for (fs in rates) for (f in listOf(62.0, 1000.0, 8000.0)) for (g in listOf(-12.0, -3.0, 6.0, 12.0)) {
            val c = Coefficients.design(FilterType.PEAKING, f, g, EqBands.PEAK_Q, fs)
            assertEquals("f=$f g=$g fs=$fs", g, c.magnitudeDb(f, fs), 0.01)
        }
    }

    @Test fun `lowshelf hits its gain at DC`() {
        for (fs in rates) for (g in listOf(-12.0, 5.5, 12.0)) {
            val c = Coefficients.design(FilterType.LOWSHELF, 31.0, g, EqBands.PEAK_Q, fs)
            assertEquals(g, c.magnitudeDb(0.0, fs), 0.01)
        }
    }

    @Test fun `highshelf hits its gain at Nyquist`() {
        for (fs in rates) for (g in listOf(-12.0, 4.5, 12.0)) {
            val c = Coefficients.design(FilterType.HIGHSHELF, 16000.0, g, EqBands.PEAK_Q, fs)
            assertEquals(g, c.magnitudeDb(fs / 2, fs), 0.01)
        }
    }

    @Test fun `zero gain is a pass-through`() {
        for (type in FilterType.entries) {
            val c = Coefficients.design(type, 1000.0, 0.0, EqBands.PEAK_Q, 48000.0)
            assertEquals(1.0, c.b0, 1e-12)
            assertEquals(c.a1, c.b1, 1e-12)
            assertEquals(c.a2, c.b2, 1e-12)
        }
    }

    @Test fun `bands match the web layout`() {
        assertEquals(10, EqBands.FREQS.size)
        assertEquals(FilterType.LOWSHELF, EqBands.typeOf(0))
        assertEquals(FilterType.PEAKING, EqBands.typeOf(5))
        assertEquals(FilterType.HIGHSHELF, EqBands.typeOf(9))
    }
}
```

`EqFilterBankTest.kt`:

```kotlin
package app.spotless.android.playback.eq

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin
import kotlin.math.sqrt

class EqFilterBankTest {
    private val fs = 48000
    private fun sine(freq: Double, frames: Int, amp: Double = 4000.0) =
        ShortArray(frames * 2) { i -> (amp * sin(2 * PI * freq * (i / 2) / fs)).toInt().toShort() }

    private fun rms(s: ShortArray, from: Int) = sqrt(s.drop(from).sumOf { it.toDouble() * it } / (s.size - from))

    @Test fun `disabled or flat is inactive and untouched`() {
        val bank = EqFilterBank(2, fs)
        bank.set(false, DoubleArray(10) { 6.0 })
        assertFalse(bank.active)
        bank.set(true, DoubleArray(10))
        assertFalse(bank.active)
        val input = sine(1000.0, 1000)
        val copy = input.copyOf()
        if (bank.active) bank.process(copy, copy.size)
        assertArrayEquals(input, copy)
    }

    @Test fun `six dB at 1 kHz doubles a 1 kHz tone`() {
        val bank = EqFilterBank(2, fs)
        bank.set(true, DoubleArray(10).also { it[5] = 6.0 })
        assertTrue(bank.active)
        val input = sine(1000.0, 9600)
        val out = input.copyOf()
        bank.process(out, out.size)
        // skip the filter's settling time
        assertEquals(2.0, rms(out, 4800) / rms(input, 4800), 0.05)
    }

    @Test fun `gains are clamped to plus or minus 12 dB`() {
        val loud = EqFilterBank(1, fs).apply { set(true, DoubleArray(10).also { it[5] = 40.0 }) }
        val capped = EqFilterBank(1, fs).apply { set(true, DoubleArray(10).also { it[5] = 12.0 }) }
        val a = ShortArray(4800) { i -> (1000 * sin(2 * PI * 1000.0 * i / fs)).toInt().toShort() }
        val b = a.copyOf()
        loud.process(a, a.size)
        capped.process(b, b.size)
        assertArrayEquals(b, a)
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.eq.*"`
Expected: compilation fails.

- [ ] **Step 3: Implement**

`Biquad.kt`:

```kotlin
package app.spotless.android.playback.eq

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

enum class FilterType { LOWSHELF, PEAKING, HIGHSHELF }

/**
 * Normalized biquad coefficients (a0 = 1). The formulas are the ones the Web Audio spec gives for
 * BiquadFilterNode (Audio EQ Cookbook, shelf slope S = 1), so the app's EQ curve is the browser's.
 */
data class Coefficients(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {

    /** Magnitude response in dB at `freq` Hz for sample rate `fs`. */
    fun magnitudeDb(freq: Double, fs: Double): Double {
        val w = 2 * PI * freq / fs
        val nr = b0 + b1 * cos(w) + b2 * cos(2 * w)
        val ni = -(b1 * sin(w) + b2 * sin(2 * w))
        val dr = 1 + a1 * cos(w) + a2 * cos(2 * w)
        val di = -(a1 * sin(w) + a2 * sin(2 * w))
        return 10 * log10((nr * nr + ni * ni) / (dr * dr + di * di))
    }

    companion object {
        fun design(type: FilterType, freq: Double, gainDb: Double, q: Double, fs: Double): Coefficients {
            val f0 = minOf(freq, fs / 2 * 0.999) // a band above Nyquist (low sample rates) sits just under it
            val a = 10.0.pow(gainDb / 40)
            val w0 = 2 * PI * f0 / fs
            val cosw = cos(w0)
            val sinw = sin(w0)
            val b0: Double; val b1: Double; val b2: Double
            val a0: Double; val a1: Double; val a2: Double
            when (type) {
                FilterType.PEAKING -> {
                    val alpha = sinw / (2 * q)
                    b0 = 1 + alpha * a; b1 = -2 * cosw; b2 = 1 - alpha * a
                    a0 = 1 + alpha / a; a1 = -2 * cosw; a2 = 1 - alpha / a
                }
                FilterType.LOWSHELF -> {
                    val k = 2 * sqrt(a) * (sinw / 2 * sqrt(2.0))
                    b0 = a * ((a + 1) - (a - 1) * cosw + k)
                    b1 = 2 * a * ((a - 1) - (a + 1) * cosw)
                    b2 = a * ((a + 1) - (a - 1) * cosw - k)
                    a0 = (a + 1) + (a - 1) * cosw + k
                    a1 = -2 * ((a - 1) + (a + 1) * cosw)
                    a2 = (a + 1) + (a - 1) * cosw - k
                }
                FilterType.HIGHSHELF -> {
                    val k = 2 * sqrt(a) * (sinw / 2 * sqrt(2.0))
                    b0 = a * ((a + 1) + (a - 1) * cosw + k)
                    b1 = -2 * a * ((a - 1) + (a + 1) * cosw)
                    b2 = a * ((a + 1) + (a - 1) * cosw - k)
                    a0 = (a + 1) - (a - 1) * cosw + k
                    a1 = 2 * ((a - 1) - (a + 1) * cosw)
                    a2 = (a + 1) - (a - 1) * cosw - k
                }
            }
            return Coefficients(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
        }
    }
}

/** The band layout of src/lib/eq.ts. */
object EqBands {
    val FREQS = doubleArrayOf(31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0)
    const val MIN_DB = -12.0
    const val MAX_DB = 12.0
    const val PEAK_Q = 1.1

    fun typeOf(i: Int): FilterType = when (i) {
        0 -> FilterType.LOWSHELF
        FREQS.lastIndex -> FilterType.HIGHSHELF
        else -> FilterType.PEAKING
    }
}
```

`EqFilterBank.kt`:

```kotlin
package app.spotless.android.playback.eq

import kotlin.math.roundToInt

/**
 * The EQ chain over interleaved PCM16 samples. Bands at 0 dB are left out entirely, so a flat or
 * disabled EQ is inactive and the audio is not touched at all (the web's "exact bypass").
 */
class EqFilterBank(val channels: Int, val sampleRate: Int) {
    private var coeffs: Array<Coefficients> = emptyArray()
    private var state = DoubleArray(0) // per channel, per band: x1, x2, y1, y2

    var active = false
        private set

    fun set(enabled: Boolean, gains: DoubleArray) {
        coeffs = if (!enabled) emptyArray() else EqBands.FREQS.indices.mapNotNull { i ->
            val g = gains.getOrElse(i) { 0.0 }.coerceIn(EqBands.MIN_DB, EqBands.MAX_DB)
            if (g == 0.0) null
            else Coefficients.design(EqBands.typeOf(i), EqBands.FREQS[i], g, EqBands.PEAK_Q, sampleRate.toDouble())
        }.toTypedArray()
        state = DoubleArray(channels * coeffs.size * 4)
        active = coeffs.isNotEmpty()
    }

    fun process(samples: ShortArray, count: Int) {
        val bands = coeffs.size
        for (i in 0 until count) {
            val ch = i % channels
            var x = samples[i].toDouble()
            for (k in 0 until bands) {
                val c = coeffs[k]
                val s = (ch * bands + k) * 4
                val y = c.b0 * x + c.b1 * state[s] + c.b2 * state[s + 1] - c.a1 * state[s + 2] - c.a2 * state[s + 3]
                state[s + 1] = state[s]
                state[s] = x
                state[s + 3] = state[s + 2]
                state[s + 2] = y
                x = y
            }
            samples[i] = x.roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
    }
}
```

`EqAudioProcessor.kt`:

```kotlin
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

    override fun onReset() {
        bank = null
        applied = null
    }
}
```

- [ ] **Step 4: Run the tests and a full build**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.eq.*" assembleDebug`
Expected: PASS; build succeeds (proves the Media3 processor API matches; if `onConfigure`/`inputAudioFormat` differ in the resolved Media3 version, adapt the override signatures to that version's `BaseAudioProcessor`).

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: 10-band EQ with the web's biquad curve

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Bridge protocol (Kotlin side)

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/bridge/BridgeProtocol.kt`
- Test: `android/app/src/test/java/app/spotless/android/bridge/BridgeProtocolTest.kt`

**Interfaces:**
- Produces: `@Serializable data class TrackDto(id: Int, title, artist, artistId, album, albumId, duration: Double, trackNo, discNo, genre: String?, gain: Double?, playCount: Int?, streamUrl: String?, missing: Boolean?, placeholderId: Int?)` with `isLibrary`, `isPlayable`; `sealed interface BridgeCommand` (objects/classes: `Hello`, `GetState`, `SetQueue(tracks, index, positionMs, play, baseVersion)`, `SyncQueue(tracks, index, baseVersion)`, `Play`, `Pause`, `Seek(positionMs)`, `Next`, `Prev`, `JumpTo(index)`, `SetRepeat(mode)`, `SetVolume(value)`, `SetDuck(value)`, `SetEq(enabled, gains)`, `SetQuality(value)`, `SetSleepTimer(minutes)`, `Speak(id, audio, mime, text)`, `StopSpeaking`, `ChangeServer`); `sealed interface BridgeEvent` (`Hello(bridgeVersion, appVersion, caps)`, `State(isPlaying, index, positionMs, durationMs, buffering, queueVersion, sleepUntil)`, `Queue(tracks, index, queueVersion, positionMs, isPlaying)`, `TrackError(trackId, reason)`, `Speaking(id, active)`, `AuthLost`); `object BridgeJson { VERSION = 1; json; parseCommand(text): BridgeCommand?; encode(event): String; CMD = "spotless.cmd"; EVT = "spotless.evt"; KEY = "json" }`.

- [ ] **Step 1: Write the failing test**

```kotlin
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.bridge.*"`
Expected: compilation fails.

- [ ] **Step 3: Implement `BridgeProtocol.kt`**

```kotlin
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
```

- [ ] **Step 4: Run the test**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.bridge.*"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: bridge protocol messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Queue mirror, sync rules and session snapshot

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/playback/QueueModel.kt`
- Test: `android/app/src/test/java/app/spotless/android/playback/QueueModelTest.kt`

**Interfaces:**
- Consumes: `TrackDto` (Task 6).
- Produces: `sealed interface QueueChange { Replace(tracks, index); Around(before, after, index); Rejected }`; `class QueueModel` with `tracks: List<TrackDto>`, `var index: Int`, `version: Int`, `set(tracks, index)`, `sync(tracks, jsIndex, baseVersion): QueueChange`, `replaceFromNative(tracks, index)`; companion `locate(list, current, hint): Int`, `trimForPersist(tracks, index): Pair<List<TrackDto>, Int>`, `PERSIST_MAX = 500`; `@Serializable data class SessionSnapshot(tracks, index, positionMs, repeat, version)`.

- [ ] **Step 1: Write the failing test**

```kotlin
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.QueueModelTest"`
Expected: compilation fails.

- [ ] **Step 3: Implement `QueueModel.kt`**

```kotlin
package app.spotless.android.playback

import app.spotless.android.bridge.TrackDto
import kotlinx.serialization.Serializable
import kotlin.math.abs

sealed interface QueueChange {
    /** Rebuild the player's playlist. */
    data class Replace(val tracks: List<TrackDto>, val index: Int) : QueueChange
    /** Keep the playing item; replace everything before and after it. */
    data class Around(val before: List<TrackDto>, val after: List<TrackDto>, val index: Int) : QueueChange
    /** Native changed the queue since the page last looked: the page must re-read it. */
    data object Rejected : QueueChange
}

/**
 * The queue as the page sees it, kept in step with ExoPlayer's playlist (same order, same indices).
 * `version` only moves when native changes the contents on its own, so a page message built on an older
 * queue can be told apart from one built on the current queue.
 */
class QueueModel {
    var tracks: List<TrackDto> = emptyList()
        private set
    var index: Int = -1
    var version: Int = 0
        private set

    fun set(tracks: List<TrackDto>, index: Int) {
        this.tracks = tracks
        this.index = if (tracks.isEmpty()) -1 else index.coerceIn(0, tracks.lastIndex)
    }

    fun sync(newTracks: List<TrackDto>, jsIndex: Int, baseVersion: Int): QueueChange {
        if (baseVersion != version) return QueueChange.Rejected
        val current = tracks.getOrNull(index)
        val at = if (current == null) -1 else locate(newTracks, current, jsIndex)
        if (at < 0) {
            set(newTracks, jsIndex)
            return QueueChange.Replace(tracks, this.index)
        }
        tracks = newTracks
        index = at
        return QueueChange.Around(newTracks.subList(0, at), newTracks.subList(at + 1, newTracks.size), at)
    }

    /** A queue native started by itself (restored session; Android Auto in P2). */
    fun replaceFromNative(tracks: List<TrackDto>, index: Int) {
        set(tracks, index)
        version++
    }

    companion object {
        const val PERSIST_MAX = 500

        /** Where `current` sits in `list`: at `hint` if it is there, else the nearest copy, else -1. */
        fun locate(list: List<TrackDto>, current: TrackDto, hint: Int): Int {
            if (list.getOrNull(hint)?.id == current.id) return hint
            var best = -1
            var bestDistance = Int.MAX_VALUE
            list.forEachIndexed { i, t ->
                if (t.id == current.id && abs(i - hint) < bestDistance) {
                    best = i
                    bestDistance = abs(i - hint)
                }
            }
            return best
        }

        /** Same cap as the web's persisted queue: keep the current track and what follows it. */
        fun trimForPersist(tracks: List<TrackDto>, index: Int): Pair<List<TrackDto>, Int> {
            if (tracks.isEmpty()) return Pair(emptyList(), -1)
            val start = maxOf(0, minOf(index, tracks.size - PERSIST_MAX))
            val kept = tracks.subList(start, minOf(tracks.size, start + PERSIST_MAX)).toList()
            val keptIndex = if (index >= 0) minOf(index - start, kept.size - 1) else -1
            return Pair(kept, keptIndex)
        }
    }
}

/** What survives the process being killed: enough to resume where playback stopped. */
@Serializable
data class SessionSnapshot(
    val tracks: List<TrackDto>,
    val index: Int,
    val positionMs: Long,
    val repeat: String,
    val version: Int,
)
```

- [ ] **Step 4: Run the test**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.QueueModelTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: queue mirror and sync rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Network layer — server store, shared cookies, API, app graph

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/net/ServerStore.kt`, `net/SharedCookieJar.kt`, `net/SpotlessApi.kt`, `android/app/src/main/java/app/spotless/android/AppGraph.kt`, `android/app/src/main/java/app/spotless/android/SpotlessApp.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Test: `android/app/src/test/java/app/spotless/android/net/SharedCookieJarTest.kt`, `android/app/src/test/java/app/spotless/android/net/SpotlessApiTest.kt`

**Interfaces:**
- Consumes: `Health`, `HealthCheck` (Task 2).
- Produces: `class ServerStore(context)` with `origin: Flow<String?>`, `suspend fun set(origin: String?)`; `interface CookieSource { get(url): String?; set(url, cookie) }`, `class WebViewCookieSource : CookieSource`, `class SharedCookieJar(source: CookieSource) : okhttp3.CookieJar`; `class AuthInterceptor(onAuthLost: () -> Unit) : Interceptor`; `class SpotlessApi(client: OkHttpClient, origin: () -> String?)` with `postHistory(trackId: Int, event: String, startedAt: Long?)`, `suspend fun health(origin: String): Health`; `class AppGraph(context)` with `serverStore`, `@Volatile var origin: String?`, `authLost: SharedFlow<Unit>`, `http: OkHttpClient`, `api: SpotlessApi`, `appScope: CoroutineScope`, `suspend fun setOrigin(origin: String?)`; `class SpotlessApp : Application` with `lateinit var graph: AppGraph`; extension `val Context.graph: AppGraph`.

- [ ] **Step 1: Write the failing tests**

`SharedCookieJarTest.kt`:

```kotlin
package app.spotless.android.net

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class SharedCookieJarTest {
    private class FakeSource : CookieSource {
        val jar = HashMap<String, MutableList<String>>()
        override fun get(url: String) = jar[url]?.joinToString("; ")
        override fun set(url: String, cookie: String) { jar.getOrPut(url) { mutableListOf() } += cookie }
    }

    @Test fun `loads the webview cookies for a request`() {
        val source = FakeSource().apply { jar["http://nas:4000/api/stream/1"] = mutableListOf("spotless_session=abc", "x=1") }
        val cookies = SharedCookieJar(source).loadForRequest("http://nas:4000/api/stream/1".toHttpUrl())
        assertEquals(listOf("spotless_session" to "abc", "x" to "1"), cookies.map { it.name to it.value })
    }

    @Test fun `no cookies is an empty list`() =
        assertEquals(emptyList<Cookie>(), SharedCookieJar(FakeSource()).loadForRequest("http://nas/".toHttpUrl()))

    @Test fun `saves response cookies back to the webview`() {
        val source = FakeSource()
        val url = "http://nas:4000/api/history".toHttpUrl()
        SharedCookieJar(source).saveFromResponse(url, listOf(Cookie.parse(url, "a=b; Path=/")!!))
        assertEquals("a=b; path=/", source.get(url.toString()))
    }
}
```

`SpotlessApiTest.kt`:

```kotlin
package app.spotless.android.net

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class SpotlessApiTest {
    private val server = MockWebServer().apply { start() }
    private val origin = server.url("/").toString().trimEnd('/')
    private var authLost = 0
    private val client = OkHttpClient.Builder().addInterceptor(AuthInterceptor { authLost++ }).build()
    private val api = SpotlessApi(client) { origin }

    @After fun tearDown() = server.shutdown()

    @Test fun `health ok`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"version":"0.3.1"}"""))
        assertEquals(Health.Ok("0.3.1"), api.health(origin))
        assertEquals("/api/health", server.takeRequest().path)
    }

    @Test fun `health unreachable`() = runBlocking {
        server.shutdown()
        val result = api.health(origin)
        assertTrue(result is Health.Problem && result.message.startsWith("Could not reach $origin"))
    }

    @Test fun `history posts the web's JSON body`() {
        server.enqueue(MockResponse().setBody("""{"ok":true}"""))
        api.postHistory(12, "played", 1_700_000_000L)
        val req = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", req.method)
        assertEquals("/api/history", req.path)
        assertEquals("""{"trackId":12,"event":"played","startedAt":1700000000}""", req.body.readUtf8())
    }

    @Test fun `history start omits startedAt`() {
        server.enqueue(MockResponse())
        api.postHistory(12, "start", null)
        assertEquals("""{"trackId":12,"event":"start"}""", server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8())
    }

    @Test fun `401 reports a lost session`() {
        server.enqueue(MockResponse().setResponseCode(401))
        client.newCall(Request.Builder().url("$origin/api/stream/1").build()).execute().close()
        assertEquals(1, authLost)
    }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.net.*"`
Expected: compilation fails.

- [ ] **Step 3: Implement the network layer**

`ServerStore.kt`:

```kotlin
package app.spotless.android.net

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.settings by preferencesDataStore("settings")

/** The server this app talks to, as an origin ("http://nas:4000"). */
class ServerStore(private val context: Context) {
    private val key = stringPreferencesKey("server_origin")

    val origin: Flow<String?> = context.settings.data.map { it[key] }

    suspend fun set(origin: String?) {
        context.settings.edit { prefs -> if (origin == null) prefs.remove(key) else prefs[key] = origin }
    }
}
```

`SharedCookieJar.kt`:

```kotlin
package app.spotless.android.net

import android.webkit.CookieManager
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/** Where cookies live; the app uses the WebView's store so native requests share the page's sign-in. */
interface CookieSource {
    /** "a=b; c=d" for `url`, or null. */
    fun get(url: String): String?
    fun set(url: String, cookie: String)
}

class WebViewCookieSource : CookieSource {
    override fun get(url: String): String? = CookieManager.getInstance().getCookie(url)
    override fun set(url: String, cookie: String) = CookieManager.getInstance().setCookie(url, cookie)
}

/** Native requests (streams, art, history) carry the WebView's session cookie, HttpOnly included. */
class SharedCookieJar(private val source: CookieSource) : CookieJar {
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val header = source.get(url.toString()) ?: return emptyList()
        return header.split(';').mapNotNull { part -> part.trim().takeIf { it.isNotEmpty() }?.let { Cookie.parse(url, it) } }
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.forEach { source.set(url.toString(), it.toString()) }
    }
}
```

`SpotlessApi.kt`:

```kotlin
package app.spotless.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit

/** Any native request answered 401 means the page's session is gone. */
class AuthInterceptor(private val onAuthLost: () -> Unit) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        if (response.code == 401) onAuthLost()
        return response
    }
}

/** The few server calls native makes itself. Requests send no Origin header, which the CSRF check allows. */
class SpotlessApi(private val client: OkHttpClient, private val origin: () -> String?) {
    private val jsonType = "application/json".toMediaType()

    /** Same body as postHistory in Player.tsx; fire and forget. */
    fun postHistory(trackId: Int, event: String, startedAt: Long?) {
        val base = origin() ?: return
        val body = buildJsonObject {
            put("trackId", trackId)
            put("event", event)
            if (startedAt != null && startedAt > 0) put("startedAt", startedAt)
        }.toString()
        val request = Request.Builder().url("$base/api/history").post(body.toRequestBody(jsonType)).build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) = response.close()
        })
    }

    /** The public health probe, with the desktop app's 8 second limit. */
    suspend fun health(origin: String): Health = withContext(Dispatchers.IO) {
        val quick = client.newBuilder().callTimeout(8, TimeUnit.SECONDS).build()
        val request = Request.Builder().url("$origin/api/health").header("Cache-Control", "no-store").build()
        try {
            quick.newCall(request).execute().use { HealthCheck.classify(origin, it.code, it.body?.string()) }
        } catch (e: InterruptedIOException) {
            HealthCheck.unreachable(origin, "it did not answer within 8 seconds")
        } catch (e: IOException) {
            HealthCheck.unreachable(origin, e.message ?: e.toString())
        } catch (e: IllegalArgumentException) {
            HealthCheck.unreachable(origin, e.message ?: "not a valid address")
        }
    }
}
```

`AppGraph.kt`:

```kotlin
package app.spotless.android

import android.content.Context
import app.spotless.android.net.AuthInterceptor
import app.spotless.android.net.ServerStore
import app.spotless.android.net.SharedCookieJar
import app.spotless.android.net.SpotlessApi
import app.spotless.android.net.WebViewCookieSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient

/** App-wide objects shared by the activity and the playback service (same process). */
class AppGraph(context: Context) {
    val serverStore = ServerStore(context)

    /** Kept in memory so OkHttp callbacks and the player read it without suspending. */
    @Volatile var origin: String? = runBlocking { serverStore.origin.first() }
        private set

    private val authLostFlow = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val authLost: SharedFlow<Unit> = authLostFlow

    /** For work that must finish even when the screen or service that started it goes away. */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val http: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(SharedCookieJar(WebViewCookieSource()))
        .addInterceptor(AuthInterceptor { authLostFlow.tryEmit(Unit) })
        .build()

    val api = SpotlessApi(http) { origin }

    suspend fun setOrigin(value: String?) {
        serverStore.set(value)
        origin = value
    }
}
```

`SpotlessApp.kt`:

```kotlin
package app.spotless.android

import android.app.Application
import android.content.Context

class SpotlessApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
    }
}

val Context.graph: AppGraph get() = (applicationContext as SpotlessApp).graph
```

In `AndroidManifest.xml`, add `android:name=".SpotlessApp"` to `<application>`:

```xml
    <application
        android:name=".SpotlessApp"
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.Spotless" />
```

- [ ] **Step 4: Run the tests**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.net.*" assembleDebug`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: server store, shared cookies, API client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Track URLs and the forwarding player

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/playback/TrackUrls.kt`, `android/app/src/main/java/app/spotless/android/playback/StreamPlayer.kt`
- Test: `android/app/src/test/java/app/spotless/android/playback/TrackUrlsTest.kt`

**Interfaces:**
- Consumes: `Rung`, `QualityPolicy.streamQuery` (Task 3), `TrackDto` (Task 6).
- Produces: `data class StreamSpec(val url: String, val rung: Rung?, val offsetSec: Double)`; `object TrackUrls { MISSING = "spotless:missing"; stream(origin, track, rung, offsetSec = 0.0): StreamSpec; artwork(origin, track): String? }`; `interface CurrentStream { offsetMs(): Long; taggedDurationMs(): Long?; seekable(): Boolean; seekCurrent(positionMs: Long) }`; `class StreamPlayer(exo: Player, stream: CurrentStream) : ForwardingPlayer`.

- [ ] **Step 1: Write the failing test**

```kotlin
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.TrackUrlsTest"`
Expected: compilation fails.

- [ ] **Step 3: Implement**

`TrackUrls.kt`:

```kotlin
package app.spotless.android.playback

import app.spotless.android.bridge.TrackDto

/** What a media item streams: the URL, the rung it was built at (null for stations) and its start offset. */
data class StreamSpec(val url: String, val rung: Rung?, val offsetSec: Double)

object TrackUrls {
    /** URI for playlist placeholders; the engine skips items carrying it. */
    const val MISSING = "spotless:missing"

    /**
     * Same rules as setSrc in Player.tsx: stations play their own URL (the server hands out
     * "/api/stations/<id>/stream", relative to itself); a transcode starts at `offsetSec` (its clock then
     * begins there); the original file is range-seekable, so it starts at 0 and seeks.
     */
    fun stream(origin: String, track: TrackDto, rung: Rung, offsetSec: Double = 0.0): StreamSpec {
        if (!track.isPlayable) return StreamSpec(MISSING, null, 0.0)
        track.streamUrl?.let { return StreamSpec(if (it.startsWith("/")) origin + it else it, null, 0.0) }
        val offset = if (rung.bitrate > 0) offsetSec else 0.0
        return StreamSpec("$origin/api/stream/${track.id}${QualityPolicy.streamQuery(rung, offset)}", rung, offset)
    }

    fun artwork(origin: String, track: TrackDto): String? =
        if (track.albumId > 0 && track.streamUrl == null) "$origin/api/artwork/${track.albumId}" else null
}
```

`StreamPlayer.kt`:

```kotlin
package app.spotless.android.playback

import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi

/** What StreamPlayer needs to know about the item playing now; the engine implements it. */
interface CurrentStream {
    /** Where the current stream starts within the track (a transcode resumed partway in). */
    fun offsetMs(): Long
    /** The tagged length for library tracks; a transcode pipe may never report one. */
    fun taggedDurationMs(): Long?
    /** Library tracks can always be scrubbed, transcode or not. */
    fun seekable(): Boolean
    fun seekCurrent(positionMs: Long)
}

/**
 * The player the media session sees. A transcoded item's own clock starts at its offset, so positions are
 * shifted back into track time, the tagged duration is reported, and seeks go through the engine (which
 * restarts a transcode at the new offset instead of seeking an unseekable pipe). Lock-screen scrubbing then
 * behaves like the web player's slider.
 */
@UnstableApi
class StreamPlayer(private val exo: Player, private val stream: CurrentStream) : ForwardingPlayer(exo) {
    override fun getCurrentPosition(): Long = exo.currentPosition + stream.offsetMs()
    override fun getContentPosition(): Long = currentPosition
    override fun getBufferedPosition(): Long = exo.bufferedPosition + stream.offsetMs()
    override fun getContentBufferedPosition(): Long = bufferedPosition
    override fun getDuration(): Long = stream.taggedDurationMs() ?: exo.duration
    override fun getContentDuration(): Long = duration

    override fun isCurrentMediaItemSeekable(): Boolean = stream.seekable() || exo.isCurrentMediaItemSeekable

    override fun getAvailableCommands(): Player.Commands {
        val commands = exo.availableCommands
        return if (stream.seekable()) commands.buildUpon().add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM).build() else commands
    }

    override fun isCommandAvailable(command: Int): Boolean =
        (command == Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM && stream.seekable()) || exo.isCommandAvailable(command)

    override fun seekTo(positionMs: Long) = stream.seekCurrent(positionMs)

    override fun seekTo(mediaItemIndex: Int, positionMs: Long) {
        if (mediaItemIndex == exo.currentMediaItemIndex) stream.seekCurrent(positionMs) else exo.seekTo(mediaItemIndex, positionMs)
    }
}
```

- [ ] **Step 4: Run the test and build**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.playback.TrackUrlsTest" assembleDebug`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: stream URLs and the offset-aware forwarding player

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Playback helpers — network watcher, session store, DJ voice player

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/playback/NetworkWatcher.kt`, `playback/SessionStore.kt`, `playback/VoicePlayer.kt`
- Modify: `android/app/src/main/AndroidManifest.xml` (network state permission)

**Interfaces:**
- Consumes: `NetworkInfo` (Task 3), `SessionSnapshot`, `BridgeJson`, `BridgeEvent`, `BridgeCommand.Speak` (Tasks 6–7).
- Produces: `class NetworkWatcher(context, onChange: (NetworkInfo) -> Unit)` with `start()`, `stop()`; `class SessionStore(context)` with `suspend save(SessionSnapshot)`, `suspend load(): SessionSnapshot?`, `suspend clear()`; `class VoicePlayer(context, onDuck: (Boolean) -> Unit, emit: (BridgeEvent) -> Unit)` with `speak(cmd: BridgeCommand.Speak)`, `stop()`, `release()`.

These are thin Android wrappers with no logic worth a JVM test; they are verified by building here and by the device checklist (Task 18).

- [ ] **Step 1: Implement `NetworkWatcher.kt`**

```kotlin
package app.spotless.android.playback

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

/** Reports the default network the way adaptive.ts reads navigator.connection. Callbacks arrive off the main thread. */
class NetworkWatcher(context: Context, private val onChange: (NetworkInfo) -> Unit) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = onChange(read(caps))
        override fun onLost(network: Network) = onChange(NetworkInfo(supported = false, metered = false))
    }

    fun start() {
        cm.registerDefaultNetworkCallback(callback)
        cm.activeNetwork?.let(cm::getNetworkCapabilities)?.let { onChange(read(it)) }
    }

    fun stop() {
        runCatching { cm.unregisterNetworkCallback(callback) }
    }

    private fun read(caps: NetworkCapabilities) = NetworkInfo(
        supported = true,
        metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
        downlinkMbps = caps.linkDownstreamBandwidthKbps.takeIf { it > 0 }?.let { it / 1000.0 },
        saveData = cm.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED,
    )
}
```

- [ ] **Step 2: Implement `SessionStore.kt`**

```kotlin
package app.spotless.android.playback

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.spotless.android.bridge.BridgeJson
import kotlinx.coroutines.flow.first

private val Context.sessionData by preferencesDataStore("session")

/** The last queue and position, so playback can resume after the process was killed. */
class SessionStore(private val context: Context) {
    private val key = stringPreferencesKey("snapshot")

    suspend fun save(snapshot: SessionSnapshot) {
        val text = BridgeJson.json.encodeToString(SessionSnapshot.serializer(), snapshot)
        context.sessionData.edit { it[key] = text }
    }

    suspend fun load(): SessionSnapshot? {
        val text = context.sessionData.data.first()[key] ?: return null
        return runCatching { BridgeJson.json.decodeFromString(SessionSnapshot.serializer(), text) }.getOrNull()
    }

    suspend fun clear() {
        context.sessionData.edit { it.remove(key) }
    }
}
```

- [ ] **Step 3: Implement `VoicePlayer.kt`**

```kotlin
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
```

- [ ] **Step 4: Add the network permission to the manifest**

Below the INTERNET permission:

```xml
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

- [ ] **Step 5: Build**

Run: `cd android && ./gradlew assembleDebug testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`, all earlier tests still pass.

- [ ] **Step 6: Commit**

```bash
git add android/app/src && git commit -m "Android: network watcher, session store, DJ voice player

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The playback engine

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/playback/PlaybackEngine.kt`

**Interfaces:**
- Consumes: everything in Tasks 3–10 (`QualityPolicy`, `Rung`, `Levels`, `PlayTracker`, `HistoryReport`, `EqAudioProcessor`, `TrackDto`, `BridgeCommand`, `BridgeEvent`, `QueueModel`, `QueueChange`, `SessionSnapshot`, `TrackUrls`, `StreamSpec`, `StreamPlayer`, `CurrentStream`, `NetworkWatcher`, `SessionStore`, `VoicePlayer`, `AppGraph`).
- Produces: `class PlaybackEngine(context: Context, graph: AppGraph, emit: (BridgeEvent) -> Unit) : Player.Listener, CurrentStream` with `val player: StreamPlayer`, `fun start()`, `fun handle(cmd: BridgeCommand)`, `fun resumption(): ListenableFuture<MediaSession.MediaItemsWithStartPosition>`, `fun release()`.

This class is Android glue around the tested pieces; it is verified by building here and by Task 18 on a device.

- [ ] **Step 1: Write `PlaybackEngine.kt`**

```kotlin
package app.spotless.android.playback

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import app.spotless.android.AppGraph
import app.spotless.android.bridge.BridgeCommand
import app.spotless.android.bridge.BridgeEvent
import app.spotless.android.bridge.TrackDto
import app.spotless.android.playback.eq.EqAudioProcessor
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.launch

/**
 * Owns playback in the app: the ExoPlayer, the queue mirror, and everything the web player did on top of an
 * <audio> element — ReplayGain, EQ, adaptive quality, stall recovery, history, sleep timer and DJ voice.
 * Lives in the playback service and runs on the main thread.
 */
@UnstableApi
class PlaybackEngine(
    private val context: Context,
    private val graph: AppGraph,
    private val emit: (BridgeEvent) -> Unit,
) : Player.Listener, CurrentStream {

    private class ItemInfo(val track: TrackDto, var spec: StreamSpec, var restreams: Int = 0)

    private val handler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val eq = EqAudioProcessor()
    private val exo: ExoPlayer = buildExo()
    val player = StreamPlayer(exo, this)

    private val queue = QueueModel()
    private val quality = QualityPolicy()
    private val tracker = PlayTracker()
    private val sessions = SessionStore(context)
    private val voice = VoicePlayer(context, onDuck = { ducked -> speechDuck = if (ducked) Levels.DUCK_GAIN else 1.0; applyVolume() }, emit = emit)
    private val network = NetworkWatcher(context) { info -> handler.post { onNetwork(info) } }

    /** Per media item (keyed by MediaItem.mediaId): the track and the stream it is playing. */
    private val items = HashMap<String, ItemInfo>()
    private var nextUid = 0
    private var currentId: String? = null
    private var playedThisStream = false
    private var volume = 1.0
    private var duck = 1.0
    private var speechDuck = 1.0
    private var lastSwitchAt = 0L
    private var sleepUntil: Long? = null
    private var ticks = 0

    private fun now() = SystemClock.elapsedRealtime()

    private fun buildExo(): ExoPlayer {
        val renderers = object : DefaultRenderersFactory(context) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean,
            ): AudioSink = DefaultAudioSink.Builder(context).setAudioProcessors(arrayOf(eq)).build()
        }
        val sources = DefaultMediaSourceFactory(OkHttpDataSource.Factory(graph.http))
        return ExoPlayer.Builder(context, renderers, sources)
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true, // pause for calls, duck for navigation prompts
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
    }

    fun start() {
        exo.addListener(this)
        network.start()
        scope.launch { graph.authLost.collect { exo.pause(); emit(BridgeEvent.AuthLost) } }
        scope.launch { restore() }
    }

    fun release() {
        saveNow()
        handler.removeCallbacksAndMessages(null)
        network.stop()
        voice.release()
        exo.removeListener(this)
        scope.cancel()
    }

    // ---------------------------------------------------------------------------------------------
    // Commands from the page

    fun handle(cmd: BridgeCommand) {
        when (cmd) {
            BridgeCommand.Hello, BridgeCommand.ChangeServer -> Unit // answered by the activity
            BridgeCommand.GetState -> { emitQueue(); emitState() }
            is BridgeCommand.SetQueue -> replaceAll(cmd.tracks, cmd.index, cmd.positionMs, cmd.play)
            is BridgeCommand.SyncQueue -> when (val change = queue.sync(cmd.tracks, cmd.index, cmd.baseVersion)) {
                QueueChange.Rejected -> emitQueue()
                is QueueChange.Replace -> replaceAll(change.tracks, change.index, 0, null)
                is QueueChange.Around -> {
                    val cur = exo.currentMediaItemIndex
                    exo.replaceMediaItems(cur + 1, exo.mediaItemCount, change.after.map { buildItem(it) })
                    exo.replaceMediaItems(0, cur, change.before.map { buildItem(it) })
                    pruneItems()
                    persistSoon()
                    emitState()
                }
            }
            BridgeCommand.Play -> play()
            BridgeCommand.Pause -> exo.pause()
            is BridgeCommand.Seek -> seekCurrent(cmd.positionMs)
            BridgeCommand.Next -> if (exo.hasNextMediaItem()) { exo.seekToNextMediaItem(); play() } else exo.pause()
            BridgeCommand.Prev -> { if (exo.hasPreviousMediaItem()) exo.seekToPreviousMediaItem() else seekCurrent(0); play() }
            is BridgeCommand.JumpTo -> if (cmd.index in 0 until exo.mediaItemCount) { exo.seekTo(cmd.index, 0); play() }
            is BridgeCommand.SetRepeat -> { exo.repeatMode = repeatOf(cmd.mode); persistSoon() }
            is BridgeCommand.SetVolume -> { volume = cmd.value.coerceIn(0.0, 1.0); applyVolume() }
            is BridgeCommand.SetDuck -> { duck = cmd.value.coerceIn(0.0, 1.0); applyVolume() }
            is BridgeCommand.SetEq -> eq.update(cmd.enabled, cmd.gains.toDoubleArray())
            is BridgeCommand.SetQuality -> quality.setting = cmd.value
            is BridgeCommand.SetSleepTimer -> setSleep(cmd.minutes)
            is BridgeCommand.Speak -> voice.speak(cmd)
            BridgeCommand.StopSpeaking -> voice.stop()
        }
    }

    private fun play() {
        when (exo.playbackState) {
            Player.STATE_IDLE -> exo.prepare()
            Player.STATE_ENDED -> exo.seekTo(exo.currentMediaItemIndex.coerceAtLeast(0), 0)
        }
        exo.play()
    }

    private fun replaceAll(tracks: List<TrackDto>, index: Int, positionMs: Long, play: Boolean?) {
        val wasPlaying = exo.playWhenReady
        queue.set(tracks, index)
        items.clear()
        currentId = null
        if (queue.index < 0) {
            exo.clearMediaItems()
        } else {
            exo.setMediaItems(tracks.map { buildItem(it) }, queue.index, positionMs)
            // a restored queue waits paused without fetching anything until the first play
            if (play ?: wasPlaying) { exo.prepare(); exo.play() } else exo.pause()
        }
        persistSoon()
        emitState()
    }

    private fun buildItem(track: TrackDto, rung: Rung = quality.current(), offsetSec: Double = 0.0, reuseId: String? = null): MediaItem {
        val origin = graph.origin.orEmpty()
        val id = reuseId ?: "t${track.id}#${nextUid++}"
        val spec = TrackUrls.stream(origin, track, rung, offsetSec)
        val existing = items[id]
        if (existing != null) existing.spec = spec else items[id] = ItemInfo(track, spec)
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setArtworkUri(TrackUrls.artwork(origin, track)?.let(Uri::parse))
            .setDurationMs(if (track.duration > 0 && track.streamUrl == null) (track.duration * 1000).toLong() else null)
            .setIsPlayable(track.isPlayable)
            .setIsBrowsable(false)
            .build()
        return MediaItem.Builder().setMediaId(id).setUri(spec.url).setMediaMetadata(metadata).build()
    }

    /** Forget items that are no longer in the playlist. */
    private fun pruneItems() {
        val live = (0 until exo.mediaItemCount).map { exo.getMediaItemAt(it).mediaId }.toSet()
        items.keys.retainAll(live)
    }

    private fun repeatOf(mode: String) = when (mode) {
        "all" -> Player.REPEAT_MODE_ALL
        "one" -> Player.REPEAT_MODE_ONE
        else -> Player.REPEAT_MODE_OFF
    }

    private fun repeatName() = when (exo.repeatMode) {
        Player.REPEAT_MODE_ALL -> "all"
        Player.REPEAT_MODE_ONE -> "one"
        else -> "off"
    }

    // ---------------------------------------------------------------------------------------------
    // CurrentStream (used by StreamPlayer)

    private fun current(): ItemInfo? = currentId?.let(items::get)

    override fun offsetMs(): Long = ((current()?.spec?.offsetSec ?: 0.0) * 1000).toLong()

    override fun taggedDurationMs(): Long? =
        current()?.track?.takeIf { it.streamUrl == null && it.duration > 0 }?.let { (it.duration * 1000).toLong() }

    override fun seekable(): Boolean = current()?.track?.isLibrary == true

    override fun seekCurrent(positionMs: Long) {
        val info = current() ?: return
        if (info.track.streamUrl != null) return // live: nothing to seek
        tracker.onJump()
        lastSwitchAt = now()
        val rung = info.spec.rung
        if (rung != null && rung.bitrate > 0) restreamCurrent(rung, positionMs / 1000.0, countRetry = false)
        else exo.seekTo(positionMs)
        emitState()
    }

    // ---------------------------------------------------------------------------------------------
    // Adaptive quality and recovery (the restream logic of Player.tsx)

    private fun positionSec() = player.currentPosition / 1000.0

    /**
     * Reload the current item at `rung`, resuming at `atSec`. A transcode restarts at that offset; the
     * original file seeks. Counted reloads respect the switch cooldown and the per-track cap.
     */
    private fun restreamCurrent(rung: Rung, atSec: Double, countRetry: Boolean): Boolean {
        val id = currentId ?: return false
        val info = items[id] ?: return false
        if (info.track.streamUrl != null) return false
        if (countRetry) {
            if (now() - lastSwitchAt < SWITCH_COOLDOWN_MS || info.restreams >= MAX_RESTREAMS_PER_TRACK) return false
            info.restreams++
        }
        lastSwitchAt = now()
        playedThisStream = false
        tracker.onJump()
        val index = exo.currentMediaItemIndex
        val wasPlaying = exo.playWhenReady
        exo.replaceMediaItem(index, buildItem(info.track, rung, atSec, reuseId = id))
        exo.seekTo(index, if (rung.bitrate == 0) (atSec * 1000).toLong() else 0L)
        exo.prepare()
        exo.playWhenReady = wasPlaying
        return true
    }

    /** A genuine rebuffer: score it (Auto walks down) and reload where a reload can help. */
    private fun recoverStall() {
        val info = current() ?: return
        val have = info.spec.rung ?: return
        if (quality.isAuto) quality.noteStall()
        val target = if (quality.isAuto) quality.current() else have
        if (!QualityPolicy.isLower(target, have) && have.bitrate == 0) return // the original file re-buffers by itself
        restreamCurrent(target, positionSec(), countRetry = true)
    }

    /** Nothing audible this long after a stream started: treat it as a stall after all. */
    private val startStall = Runnable {
        if (exo.playWhenReady && exo.playbackState == Player.STATE_BUFFERING && !playedThisStream) recoverStall()
    }

    private fun onNetwork(info: NetworkInfo) {
        quality.network = info
        if (!quality.isAuto) return
        val have = current()?.spec?.rung ?: return
        val want = quality.current()
        // only ever act mid-track to go down; an upgrade waits for the next track
        if (QualityPolicy.isLower(want, have)) restreamCurrent(want, positionSec(), countRetry = true)
    }

    private fun skipFailed(info: ItemInfo?) {
        info?.let { emit(BridgeEvent.TrackError(it.track.id, "could not be played")) }
        if (exo.hasNextMediaItem()) {
            exo.seekToNextMediaItem()
            exo.prepare()
        } else {
            exo.pause()
        }
        emitState()
    }

    // ---------------------------------------------------------------------------------------------
    // Player.Listener

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        val id = mediaItem?.mediaId
        // a restream replaced the playing item with itself: not a new play
        if (id != null && id == currentId && reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) {
            applyVolume()
            emitState()
            return
        }
        currentId = id
        queue.index = if (exo.mediaItemCount > 0) exo.currentMediaItemIndex else -1
        handler.removeCallbacks(startStall)
        playedThisStream = false
        val info = id?.let(items::get)
        if (info == null) { emitState(); return }
        if (!info.track.isPlayable) {
            handler.post { if (exo.hasNextMediaItem()) exo.seekToNextMediaItem() else exo.pause() }
            return
        }
        info.restreams = 0
        if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT && info.spec.offsetSec > 0) {
            // repeat-one of a transcode resumed partway in: start the stream from the top
            handler.post { restreamCurrent(info.spec.rung ?: quality.current(), 0.0, countRetry = false) }
        }
        tracker.begin(info.track.id, info.track.duration, info.track.isLibrary)
        if (exo.isPlaying) tracker.onPlaying()?.let(::report)
        applyVolume()
        emitState()
        persistSoon()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        handler.removeCallbacks(tick)
        if (isPlaying) {
            playedThisStream = true
            handler.removeCallbacks(startStall)
            tracker.onPlaying()?.let(::report)
            handler.postDelayed(tick, 1000)
        }
        emitState()
        persistSoon()
    }

    override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_BUFFERING && exo.playWhenReady) {
            val info = current()
            if (info != null && info.track.streamUrl == null) {
                if (!playedThisStream) {
                    handler.removeCallbacks(startStall)
                    handler.postDelayed(startStall, START_STALL_MS)
                } else if (now() - lastSwitchAt >= STALL_GRACE_MS) {
                    recoverStall()
                }
            }
        }
        if (state == Player.STATE_READY) handler.removeCallbacks(startStall)
        emitState()
    }

    override fun onPlayerError(error: PlaybackException) {
        val info = current()
        val status = (error.cause as? HttpDataSource.InvalidResponseCodeException)?.responseCode
        if (status == 401) return // AuthInterceptor already reported it; the next play re-prepares
        val unsupported = error.errorCode == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
            error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED
        if (info != null && info.track.streamUrl == null && !unsupported) {
            if (quality.isAuto) quality.noteStall()
            val rung = if (quality.isAuto) quality.current() else info.spec.rung ?: quality.current()
            if (restreamCurrent(rung, positionSec(), countRetry = true)) return
        }
        skipFailed(info)
    }

    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
        if (reason != Player.DISCONTINUITY_REASON_AUTO_TRANSITION) return
        // a transcode pipe that died cleanly reads as the song ending early: go back and pick it up
        val id = oldPosition.mediaItem?.mediaId ?: return
        val info = items[id] ?: return
        val rung = info.spec.rung ?: return
        if (rung.bitrate == 0 || info.track.duration <= 0 || info.restreams >= MAX_RESTREAMS_PER_TRACK) return
        val endedAt = info.spec.offsetSec + oldPosition.positionMs / 1000.0
        if (info.track.duration - endedAt <= 5) return
        handler.post {
            exo.seekTo(oldPosition.mediaItemIndex, 0)
            restreamCurrent(if (quality.isAuto) quality.current() else rung, endedAt, countRetry = true)
        }
    }

    override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) {
        // the playlist was cleared from outside the page (Change server, a controller's stop + clear)
        if (exo.mediaItemCount == 0 && queue.tracks.isNotEmpty()) {
            queue.replaceFromNative(emptyList(), -1)
            items.clear()
            currentId = null
            emitQueue()
            persistSoon()
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Volume, history, sleep timer

    private fun applyVolume() {
        exo.volume = Levels.level(volume, duck * speechDuck, current()?.track?.gain).toFloat()
    }

    private fun report(r: HistoryReport) = graph.api.postHistory(r.trackId, r.event.wire, r.startedAt)

    private val tick = object : Runnable {
        override fun run() {
            tracker.onPosition(positionSec())?.let(::report)
            emitState()
            if (++ticks % 10 == 0) saveNow()
            if (exo.isPlaying) handler.postDelayed(this, 1000)
        }
    }

    private val sleepFire = Runnable {
        exo.pause()
        sleepUntil = null
        emitState()
    }

    private fun setSleep(minutes: Int) {
        handler.removeCallbacks(sleepFire)
        sleepUntil = if (minutes > 0) System.currentTimeMillis() + minutes * 60_000L else null
        if (minutes > 0) handler.postDelayed(sleepFire, minutes * 60_000L)
        emitState()
    }

    // ---------------------------------------------------------------------------------------------
    // Events to the page

    private fun isPlayingNow(): Boolean {
        val state = exo.playbackState
        return exo.playWhenReady && (state == Player.STATE_READY || state == Player.STATE_BUFFERING)
    }

    private fun emitState() {
        val duration = player.duration
        emit(
            BridgeEvent.State(
                isPlaying = isPlayingNow(),
                index = if (exo.mediaItemCount > 0) exo.currentMediaItemIndex else -1,
                positionMs = player.currentPosition.coerceAtLeast(0),
                durationMs = if (duration == C.TIME_UNSET || duration < 0) 0 else duration,
                buffering = exo.playbackState == Player.STATE_BUFFERING,
                queueVersion = queue.version,
                sleepUntil = sleepUntil,
            ),
        )
    }

    private fun emitQueue() {
        emit(BridgeEvent.Queue(queue.tracks, queue.index, queue.version, player.currentPosition.coerceAtLeast(0), isPlayingNow()))
    }

    // ---------------------------------------------------------------------------------------------
    // Session persistence and resumption

    private val persistRunnable = Runnable { saveNow() }

    private fun persistSoon() {
        handler.removeCallbacks(persistRunnable)
        handler.postDelayed(persistRunnable, 1000)
    }

    private fun saveNow() {
        val (tracks, index) = QueueModel.trimForPersist(queue.tracks, queue.index)
        val snapshot = SessionSnapshot(
            tracks = tracks,
            index = index,
            positionMs = if (index >= 0) player.currentPosition.coerceAtLeast(0) else 0,
            repeat = repeatName(),
            version = queue.version,
        )
        graph.appScope.launch { sessions.save(snapshot) }
    }

    /** Put the last session back, paused, if nothing is queued yet. */
    private suspend fun restore() {
        if (exo.mediaItemCount > 0) return
        val snap = sessions.load() ?: return
        if (snap.tracks.isEmpty() || snap.index < 0 || exo.mediaItemCount > 0) return
        val index = snap.index.coerceIn(0, snap.tracks.lastIndex)
        queue.replaceFromNative(snap.tracks, index)
        exo.repeatMode = repeatOf(snap.repeat)
        val rung = quality.current()
        val atSec = snap.positionMs / 1000.0
        val media = snap.tracks.mapIndexed { i, t -> if (i == index) buildItem(t, rung, atSec) else buildItem(t) }
        exo.setMediaItems(media, index, if (rung.bitrate == 0) snap.positionMs else 0)
        emitQueue()
        emitState()
    }

    /** For MediaSession.Callback.onPlaybackResumption (Bluetooth "play" after a restart, the resume card). */
    fun resumption(): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = scope.future {
        if (exo.mediaItemCount == 0) restore()
        val media = (0 until exo.mediaItemCount).map(exo::getMediaItemAt)
        MediaSession.MediaItemsWithStartPosition(media, exo.currentMediaItemIndex.coerceAtLeast(0), exo.currentPosition)
    }

    companion object {
        const val SWITCH_COOLDOWN_MS = 8_000L
        const val STALL_GRACE_MS = 4_000L
        const val START_STALL_MS = 12_000L
        const val MAX_RESTREAMS_PER_TRACK = 4
    }
}
```

- [ ] **Step 2: Build**

Run: `cd android && ./gradlew assembleDebug testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`. If the resolved Media3 version names an API differently (for example `buildAudioSink` parameters or `MediaMetadata.Builder.setDurationMs`), adapt the call to that version's signature without changing behavior.

- [ ] **Step 3: Commit**

```bash
git add android/app/src && git commit -m "Android: playback engine (queue, quality, recovery, history, sleep, voice)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Playback service and media session

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/playback/PlaybackService.kt`, `playback/SessionCallback.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: `PlaybackEngine` (Task 11), `BridgeJson` (Task 6), `Context.graph` (Task 8).
- Produces: service `app.spotless.android.playback.PlaybackService` whose session accepts `SessionCommand(BridgeJson.CMD)` with bundle key `BridgeJson.KEY` from the app's own package and sends `SessionCommand(BridgeJson.EVT)` events to those controllers.

- [ ] **Step 1: Write `SessionCallback.kt`**

```kotlin
package app.spotless.android.playback

import android.os.Bundle
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import app.spotless.android.bridge.BridgeJson
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Only controllers from this app (the activity's bridge, Media3's own notification controller) get the
 * Spotless commands; everyone else — system UI, watches, other apps — gets the standard media commands.
 */
@UnstableApi
class SessionCallback(private val engine: PlaybackEngine, private val ownPackage: String) : MediaSession.Callback {
    val ownControllers = LinkedHashSet<MediaSession.ControllerInfo>()

    private val command = SessionCommand(BridgeJson.CMD, Bundle.EMPTY)

    override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
        if (controller.packageName != ownPackage) return super.onConnect(session, controller)
        ownControllers += controller
        val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(command).build()
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
}
```

- [ ] **Step 2: Write `PlaybackService.kt`**

```kotlin
package app.spotless.android.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.core.os.bundleOf
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import app.spotless.android.bridge.BridgeEvent
import app.spotless.android.bridge.BridgeJson
import app.spotless.android.graph
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors

/** Hosts the engine and the media session: notification, lock screen, Bluetooth, Wear OS. */
@UnstableApi
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private lateinit var engine: PlaybackEngine
    private lateinit var callback: SessionCallback

    override fun onCreate() {
        super.onCreate()
        engine = PlaybackEngine(this, graph, ::sendEvent)
        callback = SessionCallback(engine, packageName)
        val openApp = packageManager.getLaunchIntentForPackage(packageName)
            ?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
        // artwork needs the session cookie, so it loads through the same OkHttp client as the audio
        val bitmaps = CacheBitmapLoader(
            DataSourceBitmapLoader(
                MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor()),
                OkHttpDataSource.Factory(graph.http),
            ),
        )
        session = MediaSession.Builder(this, engine.player)
            .setCallback(callback)
            .setBitmapLoader(bitmaps)
            .apply { openApp?.let(::setSessionActivity) }
            .build()
        engine.start()
    }

    private fun sendEvent(event: BridgeEvent) {
        val s = session ?: return
        val args = bundleOf(BridgeJson.KEY to BridgeJson.encode(event))
        val command = SessionCommand(BridgeJson.EVT, Bundle.EMPTY)
        callback.ownControllers.forEach { s.sendCustomCommand(it, command, args) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        engine.release()
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}
```

- [ ] **Step 3: Declare the service, the media button receiver and permissions**

Final `AndroidManifest.xml` for this task (the activity is added in Task 14):

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />

    <application
        android:name=".SpotlessApp"
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.Spotless">

        <service
            android:name=".playback.PlaybackService"
            android:exported="true"
            android:foregroundServiceType="mediaPlayback">
            <intent-filter>
                <action android:name="androidx.media3.session.MediaSessionService" />
            </intent-filter>
        </service>

        <!-- headset / car "play" after the process died: starts the service and resumes the last queue -->
        <receiver
            android:name="androidx.media3.session.MediaButtonReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MEDIA_BUTTON" />
            </intent-filter>
        </receiver>
    </application>
</manifest>
```

- [ ] **Step 4: Build**

Run: `cd android && ./gradlew assembleDebug testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`. (If `onPlaybackResumption` in the resolved Media3 version has an extra parameter, override that signature instead.)

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: playback service and media session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: URL policy

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/ui/UrlPolicy.kt`
- Test: `android/app/src/test/java/app/spotless/android/ui/UrlPolicyTest.kt`

**Interfaces:**
- Consumes: `ServerAddress.origin` (Task 2).
- Produces: `object UrlPolicy { enum class Decision { IN_APP, EXTERNAL }; fun decide(origin: String, url: String): Decision }`.

- [ ] **Step 1: Write the failing test**

```kotlin
package app.spotless.android.ui

import app.spotless.android.ui.UrlPolicy.Decision.EXTERNAL
import app.spotless.android.ui.UrlPolicy.Decision.IN_APP
import org.junit.Assert.assertEquals
import org.junit.Test

class UrlPolicyTest {
    private val origin = "http://nas:4000"

    @Test fun `same origin stays`() = assertEquals(IN_APP, UrlPolicy.decide(origin, "http://nas:4000/album/3"))
    @Test fun `other port leaves`() = assertEquals(EXTERNAL, UrlPolicy.decide(origin, "http://nas:5000/"))
    @Test fun `spotify sign-in stays`() = assertEquals(IN_APP, UrlPolicy.decide(origin, "https://accounts.spotify.com/authorize?x=1"))
    @Test fun `last fm sign-in stays`() {
        assertEquals(IN_APP, UrlPolicy.decide(origin, "https://www.last.fm/api/auth"))
        assertEquals(IN_APP, UrlPolicy.decide(origin, "https://last.fm/api/auth"))
    }
    @Test fun `lookalikes leave`() {
        assertEquals(EXTERNAL, UrlPolicy.decide(origin, "https://spotify.com.evil.example/"))
        assertEquals(EXTERNAL, UrlPolicy.decide(origin, "https://notlast.fm/"))
    }
    @Test fun `other sites leave`() = assertEquals(EXTERNAL, UrlPolicy.decide(origin, "https://github.com/"))
    @Test fun `non-http leaves`() = assertEquals(EXTERNAL, UrlPolicy.decide(origin, "mailto:a@b.c"))
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.ui.*"`
Expected: compilation fails.

- [ ] **Step 3: Implement `UrlPolicy.kt`**

```kotlin
package app.spotless.android.ui

import app.spotless.android.net.ServerAddress
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Which navigations stay in the WebView. The server's own pages do; so do the Spotify and Last.fm sign-in
 * pages (same list as desktop/main.js), because their callback must come back with this WebView's session
 * cookie. Everything else opens in the system browser.
 */
object UrlPolicy {
    enum class Decision { IN_APP, EXTERNAL }

    private val SIGN_IN_HOSTS = listOf(Regex("^(?:.+\\.)?spotify\\.com$"), Regex("^(?:www\\.)?last\\.fm$"))

    fun decide(origin: String, url: String): Decision {
        val parsed = url.toHttpUrlOrNull() ?: return Decision.EXTERNAL
        if (ServerAddress.origin(parsed) == origin) return Decision.IN_APP
        if (SIGN_IN_HOSTS.any { it.matches(parsed.host) }) return Decision.IN_APP
        return Decision.EXTERNAL
    }
}
```

- [ ] **Step 4: Run the test**

Run: `cd android && ./gradlew testDebugUnitTest --tests "app.spotless.android.ui.*"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android/app/src && git commit -m "Android: which links stay in the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Activity — setup screen, WebView host, bridge relay

**Files:**
- Create: `android/app/src/main/java/app/spotless/android/ui/WebBridge.kt`, `ui/WebHost.kt`, `ui/Screens.kt`, `ui/MainActivity.kt`, `android/app/src/main/res/xml/network_security_config.xml`, `android/app/src/main/res/xml/shortcuts.xml`
- Modify: `android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: `BridgeJson`, `BridgeCommand`, `BridgeEvent` (Task 6); `PlaybackService` (Task 12); `UrlPolicy` (Task 13); `ServerAddress`, `Health` (Task 2); `Context.graph`, `AppGraph.setOrigin`, `SpotlessApi.health` (Task 8).
- Produces: launcher activity `app.spotless.android.ui.MainActivity`; action `app.spotless.android.CHANGE_SERVER`; the page sees `window.SpotlessNative` with `postMessage(string)` and `message` events.

- [ ] **Step 1: Write `WebBridge.kt`**

```kotlin
package app.spotless.android.ui

import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.core.os.bundleOf
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import app.spotless.android.BuildConfig
import app.spotless.android.bridge.BridgeCommand
import app.spotless.android.bridge.BridgeEvent
import app.spotless.android.bridge.BridgeJson
import app.spotless.android.playback.PlaybackService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Relays between the page and the playback service. The page's `SpotlessNative` object only exists for the
 * configured server origin and only main-frame messages are accepted. `hello` and `changeServer` are
 * answered here; everything else goes to the service as a session custom command, and service events come
 * back the same way.
 */
@UnstableApi
class WebBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val origin: String,
) {
    private var reply: JavaScriptReplyProxy? = null
    private var controller: MediaController? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private val pending = ArrayDeque<String>()
    private val command = SessionCommand(BridgeJson.CMD, Bundle.EMPTY)

    /** False when this WebView is too old for origin-locked messaging; the page then plays by itself. */
    fun install(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        WebViewCompat.addWebMessageListener(webView, "SpotlessNative", setOf(origin)) { _, message: WebMessageCompat, _: Uri, isMainFrame, replyProxy ->
            if (!isMainFrame) return@addWebMessageListener
            reply = replyProxy
            message.data?.let(::onMessage)
        }
        connect()
        return true
    }

    private fun onMessage(text: String) {
        when (BridgeJson.parseCommand(text)) {
            null -> Unit
            BridgeCommand.Hello -> send(
                BridgeJson.encode(BridgeEvent.Hello(BridgeJson.VERSION, BuildConfig.VERSION_NAME, listOf("eq", "quality", "sleep", "speak"))),
            )
            BridgeCommand.ChangeServer -> activity.showSetup()
            else -> forward(text)
        }
    }

    private fun forward(text: String) {
        val c = controller
        if (c == null) pending += text else c.sendCustomCommand(command, bundleOf(BridgeJson.KEY to text))
    }

    private fun send(json: String) {
        reply?.postMessage(json)
    }

    private fun connect() {
        val token = SessionToken(activity, ComponentName(activity, PlaybackService::class.java))
        val future = MediaController.Builder(activity, token)
            .setListener(object : MediaController.Listener {
                override fun onCustomCommand(
                    controller: MediaController,
                    command: SessionCommand,
                    args: Bundle,
                ): ListenableFuture<SessionResult> {
                    if (command.customAction == BridgeJson.EVT) {
                        args.getString(BridgeJson.KEY)?.let { json ->
                            send(json)
                            if (json == BridgeJson.encode(BridgeEvent.AuthLost)) activity.onAuthLost()
                        }
                    }
                    return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
                }
            })
            .buildAsync()
        controllerFuture = future
        future.addListener({
            controller = runCatching { future.get() }.getOrNull()
            while (pending.isNotEmpty()) forward(pending.removeFirst())
        }, ContextCompat.getMainExecutor(activity))
    }

    /** Stop and forget the queue (switching servers). */
    fun stopPlayback() {
        controller?.run {
            stop()
            clearMediaItems()
        }
    }

    fun release() {
        WebViewCompat.removeWebMessageListener(webView, "SpotlessNative")
        controllerFuture?.let(MediaController::releaseFuture)
        controller = null
        reply = null
    }
}
```

- [ ] **Step 2: Write `WebHost.kt`**

```kotlin
package app.spotless.android.ui

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import app.spotless.android.BuildConfig

/** Builds the WebView that shows the server's pages. */
object WebHost {
    @SuppressLint("SetJavaScriptEnabled")
    fun create(
        activity: MainActivity,
        origin: String,
        onMainFrameError: (String) -> Unit,
        onMicrophoneRequest: (PermissionRequest) -> Unit,
    ): WebView = WebView(activity).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // the page's own player (fallback when the bridge is unavailable) may start without a tap
        settings.mediaPlaybackRequiresUserGesture = false
        settings.userAgentString = settings.userAgentString + " SpotlessAndroid/" + BuildConfig.VERSION_NAME
        setBackgroundColor(android.graphics.Color.BLACK)

        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (UrlPolicy.decide(origin, url) == UrlPolicy.Decision.IN_APP) return false
                try {
                    activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (_: ActivityNotFoundException) {
                    // nothing can open it; stay put
                }
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) onMainFrameError(error.description?.toString() ?: "the page did not load")
            }
        }

        webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                val fromServer = request.origin?.let { "${it.scheme}://${it.authority}" } == origin
                if (fromServer && request.resources.contentEquals(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))) {
                    onMicrophoneRequest(request)
                } else {
                    request.deny()
                }
            }
        }
    }
}
```

- [ ] **Step 3: Write `Screens.kt`**

```kotlin
package app.spotless.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

@Composable
fun SetupScreen(initial: String?, error: String?, checking: Boolean, onConnect: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial.orEmpty()) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.Center) {
            Text("Connect to your Spotless server", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text(
                "The address you use in a browser, for example nas:4000 or http://192.168.1.10:3000.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text("Server address") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (!checking) onConnect(text) }),
                modifier = Modifier.fillMaxWidth(),
            )
            if (error != null) {
                Spacer(Modifier.height(8.dp))
                Text(error, color = MaterialTheme.colorScheme.error)
            }
            Spacer(Modifier.height(16.dp))
            Button(onClick = { onConnect(text) }, enabled = !checking && text.isNotBlank()) {
                Text(if (checking) "Checking…" else "Connect")
            }
        }
    }
}

@Composable
fun UnreachableScreen(origin: String, message: String, onRetry: () -> Unit, onChangeServer: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.Center) {
            Text("Can't reach $origin", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(16.dp))
            Row {
                Button(onClick = onRetry) { Text("Retry") }
                Spacer(Modifier.width(12.dp))
                OutlinedButton(onClick = onChangeServer) { Text("Change server") }
            }
        }
    }
}
```

- [ ] **Step 4: Write `MainActivity.kt`**

```kotlin
package app.spotless.android.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.util.UnstableApi
import app.spotless.android.graph
import app.spotless.android.net.Health
import app.spotless.android.net.ServerAddress
import kotlinx.coroutines.launch

@UnstableApi
class MainActivity : ComponentActivity() {
    private sealed interface Screen {
        data object Loading : Screen
        data class Setup(val initial: String?, val error: String?, val checking: Boolean) : Screen
        data class Web(val origin: String) : Screen
        data class Unreachable(val origin: String, val message: String) : Screen
    }

    private var screen by mutableStateOf<Screen>(Screen.Loading)
    private var webView: WebView? = null
    private var bridge: WebBridge? = null
    private var pendingMic: PermissionRequest? = null

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingMic?.let { if (granted) it.grant(it.resources) else it.deny() }
        pendingMic = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                when (val s = screen) {
                    Screen.Loading -> Unit
                    is Screen.Setup -> SetupScreen(s.initial, s.error, s.checking) { input -> lifecycleScope.launch { connect(input) } }
                    // keyed on the instance: a new WebView (after Retry or a server change) gets a fresh AndroidView
                    is Screen.Web -> webView?.let { view -> key(view) { AndroidView(factory = { view }) } }
                    is Screen.Unreachable -> UnreachableScreen(s.origin, s.message, onRetry = { start(s.origin) }, onChangeServer = ::showSetup)
                }
            }
        }
        onBackPressedDispatcher.addCallback(this) {
            val view = webView
            if (screen is Screen.Web && view != null && view.canGoBack()) view.goBack() else moveTaskToBack(true)
        }
        if (intent?.action == ACTION_CHANGE_SERVER) showSetup() else start(graph.origin)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_CHANGE_SERVER) showSetup()
    }

    private fun start(origin: String?) {
        if (origin == null) {
            showSetup()
            return
        }
        screen = Screen.Loading
        lifecycleScope.launch {
            when (val health = graph.api.health(origin)) {
                is Health.Ok -> openWeb(origin)
                is Health.Problem -> screen = Screen.Unreachable(origin, health.message)
            }
        }
    }

    private suspend fun connect(input: String) {
        val origin = ServerAddress.normalize(input)
        if (origin == null) {
            screen = Screen.Setup(input, "Enter a server address like nas:4000 or http://192.168.1.10:3000.", false)
            return
        }
        screen = Screen.Setup(input, null, true)
        when (val health = graph.api.health(origin)) {
            is Health.Ok -> {
                if (origin != graph.origin) bridge?.stopPlayback()
                graph.setOrigin(origin)
                openWeb(origin)
            }
            is Health.Problem -> screen = Screen.Setup(input, health.message, false)
        }
    }

    fun showSetup() {
        teardownWeb()
        screen = Screen.Setup(graph.origin, null, false)
    }

    /** The server said the session is gone: load the server again, which lands on its sign-in page. */
    fun onAuthLost() {
        val origin = (screen as? Screen.Web)?.origin ?: return
        webView?.loadUrl(origin)
    }

    private fun openWeb(origin: String) {
        teardownWeb()
        val view = WebHost.create(
            activity = this,
            origin = origin,
            // don't destroy the WebView from inside its own callback; Retry's openWeb tears it down
            onMainFrameError = { message -> screen = Screen.Unreachable(origin, message) },
            onMicrophoneRequest = ::onMicrophoneRequest,
        )
        bridge = WebBridge(this, view, origin).also { it.install() }
        webView = view
        view.loadUrl(origin)
        screen = Screen.Web(origin)
    }

    private fun teardownWeb() {
        bridge?.release()
        bridge = null
        webView?.destroy()
        webView = null
    }

    private fun onMicrophoneRequest(request: PermissionRequest) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(request.resources)
        } else {
            pendingMic?.deny()
            pendingMic = request
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    override fun onDestroy() {
        teardownWeb()
        super.onDestroy()
    }

    companion object {
        const val ACTION_CHANGE_SERVER = "app.spotless.android.CHANGE_SERVER"
    }
}
```

Note: the WebView is deliberately not paused in `onPause`/`onStop` (no `webView.onPause()`, no `pauseTimers()`), so radio refill and DJ segues keep running while the screen is off.

- [ ] **Step 5: Write the XML resources**

`res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Home servers are usually plain http on the LAN. -->
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
```

`res/xml/shortcuts.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
    <shortcut
        android:shortcutId="change_server"
        android:enabled="true"
        android:icon="@mipmap/ic_launcher"
        android:shortcutShortLabel="@string/shortcut_change_server">
        <intent
            android:action="app.spotless.android.CHANGE_SERVER"
            android:targetPackage="app.spotless.android"
            android:targetClass="app.spotless.android.ui.MainActivity" />
    </shortcut>
</shortcuts>
```

- [ ] **Step 6: Add the activity and the remaining permission to the manifest**

Add below the other permissions:

```xml
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
```

Add `android:networkSecurityConfig="@xml/network_security_config"` to `<application>`, and inside it, before `<service>`:

```xml
        <activity
            android:name=".ui.MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden|uiMode"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts" />
        </activity>
```

- [ ] **Step 7: Build and install on a device or emulator**

Run: `cd android && ./gradlew assembleDebug testDebugUnitTest`
Expected: `BUILD SUCCESSFUL`.

If a phone (USB debugging) or emulator is connected:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Expected: the app opens to "Connect to your Spotless server"; entering the server address opens the Spotless UI. (Playback still uses the page's own `<audio>` until Tasks 15–17 land — the page does not yet answer the bridge.)

- [ ] **Step 8: Commit**

```bash
git add android/app/src && git commit -m "Android: setup screen, WebView host and bridge relay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Web — bridge handshake module

**Files:**
- Create: `src/lib/client/nativeBridge.ts`
- Test: `src/lib/client/__tests__/nativeBridge.test.ts`

**Interfaces:**
- Consumes: `Track` from `src/lib/types.ts`.
- Produces: `BRIDGE_VERSION = 1`; `interface NativePort { postMessage(message: string): void; addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void }`; `type NativeCommand` (union of every command in the spec); `type NativeEvent` (union of every event); `interface NativeBridge { appVersion: string; caps: string[]; send(cmd: NativeCommand): void; on(listener: (e: NativeEvent) => void): () => void }`; `findPort(): NativePort | null`; `connect(port: NativePort, timeoutMs?: number): Promise<NativeBridge | null>`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, type NativeEvent, type NativePort } from '@/lib/client/nativeBridge';

function fakePort() {
  const sent: string[] = [];
  let listener: ((e: { data: unknown }) => void) | null = null;
  const port: NativePort = {
    postMessage: (m) => {
      sent.push(m);
    },
    addEventListener: (_type, l) => {
      listener = l;
    },
  };
  const reply = (msg: unknown) => listener?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
  return { port, sent, reply };
}

describe('nativeBridge.connect', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('says hello and resolves on a supported version', async () => {
    const { port, sent, reply } = fakePort();
    const pending = connect(port);
    expect(JSON.parse(sent[0])).toEqual({ type: 'hello' });
    reply({ type: 'hello', bridgeVersion: 1, appVersion: '0.3.1', caps: ['eq'] });
    const bridge = await pending;
    expect(bridge?.appVersion).toBe('0.3.1');
    expect(bridge?.caps).toEqual(['eq']);
  });

  it('refuses an unknown bridge version', async () => {
    const { port, reply } = fakePort();
    const pending = connect(port);
    reply({ type: 'hello', bridgeVersion: 2, appVersion: '9.0.0', caps: [] });
    expect(await pending).toBeNull();
  });

  it('gives up when nothing answers', async () => {
    const { port } = fakePort();
    const pending = connect(port, 500);
    vi.advanceTimersByTime(500);
    expect(await pending).toBeNull();
  });

  it('delivers events after the handshake and ignores junk', async () => {
    const { port, reply, sent } = fakePort();
    const pending = connect(port);
    reply({ type: 'hello', bridgeVersion: 1, appVersion: '0.3.1', caps: [] });
    const bridge = (await pending)!;
    const seen: NativeEvent[] = [];
    const off = bridge.on((e) => seen.push(e));
    reply('not json');
    reply({ nope: true });
    reply({ type: 'authLost' });
    off();
    reply({ type: 'authLost' });
    expect(seen).toEqual([{ type: 'authLost' }]);
    bridge.send({ type: 'play' });
    expect(JSON.parse(sent.at(-1)!)).toEqual({ type: 'play' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/client/__tests__/nativeBridge.test.ts`
Expected: FAIL — cannot resolve `@/lib/client/nativeBridge`.

- [ ] **Step 3: Implement `src/lib/client/nativeBridge.ts`**

```ts
'use client';

import type { Track } from '@/lib/types';

/**
 * The Android app's bridge. The app injects `window.SpotlessNative` (androidx.webkit web message listener,
 * locked to the server's origin) and plays audio natively; this module does the handshake and carries the
 * typed messages. In a browser or the desktop app there is no port and nothing here runs.
 */

export const BRIDGE_VERSION = 1;

export interface NativePort {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

export type NativeCommand =
  | { type: 'hello' }
  | { type: 'getState' }
  | { type: 'setQueue'; tracks: Track[]; index: number; positionMs: number; play: boolean; baseVersion: number }
  | { type: 'syncQueue'; tracks: Track[]; index: number; baseVersion: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; positionMs: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'jumpTo'; index: number }
  | { type: 'setRepeat'; mode: 'off' | 'all' | 'one' }
  | { type: 'setVolume'; value: number }
  | { type: 'setDuck'; value: number }
  | { type: 'setEq'; enabled: boolean; gains: number[] }
  | { type: 'setQuality'; value: string }
  | { type: 'setSleepTimer'; minutes: number }
  | { type: 'speak'; id: number; audio?: string; mime?: string; text?: string }
  | { type: 'stopSpeaking' }
  | { type: 'changeServer' };

export type NativeEvent =
  | { type: 'hello'; bridgeVersion: number; appVersion: string; caps: string[] }
  | {
      type: 'state';
      isPlaying: boolean;
      index: number;
      positionMs: number;
      durationMs: number;
      buffering: boolean;
      queueVersion: number;
      sleepUntil?: number;
    }
  | { type: 'queue'; tracks: Track[]; index: number; queueVersion: number; positionMs: number; isPlaying: boolean }
  | { type: 'trackError'; trackId: number; reason: string }
  | { type: 'speaking'; id: number; active: boolean }
  | { type: 'authLost' };

export interface NativeBridge {
  appVersion: string;
  caps: string[];
  send(cmd: NativeCommand): void;
  /** Subscribe to events; returns an unsubscribe function. */
  on(listener: (e: NativeEvent) => void): () => void;
}

/** The injected port, when this page runs inside the Android app. */
export function findPort(): NativePort | null {
  if (typeof window === 'undefined') return null;
  const port = (window as unknown as { SpotlessNative?: NativePort }).SpotlessNative;
  return port && typeof port.postMessage === 'function' ? port : null;
}

/** Handshake: resolves the bridge when the app speaks a version we know, otherwise null. */
export function connect(port: NativePort, timeoutMs = 2000): Promise<NativeBridge | null> {
  return new Promise((resolve) => {
    const listeners = new Set<(e: NativeEvent) => void>();
    let bridge: NativeBridge | null = null;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    port.addEventListener('message', (msg) => {
      let event: NativeEvent;
      try {
        event = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
      if (!settled && event.type === 'hello') {
        settled = true;
        clearTimeout(timer);
        if (event.bridgeVersion !== BRIDGE_VERSION) return resolve(null);
        bridge = {
          appVersion: event.appVersion,
          caps: Array.isArray(event.caps) ? event.caps : [],
          send: (cmd) => port.postMessage(JSON.stringify(cmd)),
          on: (listener) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
        };
        return resolve(bridge);
      }
      if (bridge) listeners.forEach((l) => l(event));
    });

    port.postMessage(JSON.stringify({ type: 'hello' }));
  });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/client/__tests__/nativeBridge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/client/nativeBridge.ts src/lib/client/__tests__/nativeBridge.test.ts && git commit -m "Web: Android bridge handshake

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Web — mirror the player store to native

**Files:**
- Create: `src/lib/client/nativeSync.ts`
- Test: `src/lib/client/__tests__/nativeSync.test.ts`

**Interfaces:**
- Consumes: `connect`, `findPort`, `NativeBridge`, `NativeEvent` (Task 15); `usePlayer` (`src/store/player.ts`); `loadEq` (`src/lib/eq.ts`); `loadQuality` (`src/lib/adaptive.ts`).
- Produces: `useNative` zustand store `{ active: boolean; positionMs: number; durationMs: number; buffering: boolean; sleepUntil: number | null }`; `nativeBridge(): NativeBridge | null`; `startNativeSync(bridge: NativeBridge): () => void`; `connectNative(): () => void`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NativeBridge, NativeCommand, NativeEvent } from '@/lib/client/nativeBridge';
import { nativeBridge, startNativeSync, useNative } from '@/lib/client/nativeSync';
import { usePlayer } from '@/store/player';
import type { Track } from '@/lib/types';

const t = (id: number): Track => ({
  id,
  title: `t${id}`,
  artist: 'a',
  artistId: 1,
  album: 'al',
  albumId: 1,
  duration: 200,
  trackNo: 1,
  discNo: 1,
  genre: null,
});

function fakeBridge() {
  const sent: NativeCommand[] = [];
  const listeners = new Set<(e: NativeEvent) => void>();
  const bridge: NativeBridge = {
    appVersion: '0.3.1',
    caps: [],
    send: (c) => {
      sent.push(c);
    },
    on: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
  const emit = (e: NativeEvent) => listeners.forEach((l) => l(e));
  return { bridge, sent, emit };
}

const emptyQueue: NativeEvent = { type: 'queue', tracks: [], index: -1, queueVersion: 0, positionMs: 0, isPlaying: false };

describe('nativeSync', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    usePlayer.setState({ queue: [], originalQueue: [], index: -1, isPlaying: false, repeat: 'off', volume: 1, duck: 1, shuffle: false, radio: false });
  });
  afterEach(() => stop());

  it('asks for native state first and sends nothing else until it answers', () => {
    const { bridge, sent } = fakeBridge();
    stop = startNativeSync(bridge);
    usePlayer.getState().playQueue([t(1)]);
    expect(sent).toEqual([{ type: 'getState' }]);
    expect(useNative.getState().active).toBe(true);
    expect(nativeBridge()).toBe(bridge);
  });

  it('adopts the native queue when native has one', () => {
    const { bridge, sent, emit } = fakeBridge();
    usePlayer.setState({ queue: [t(9)], index: 0 });
    stop = startNativeSync(bridge);
    emit({ type: 'queue', tracks: [t(1), t(2)], index: 1, queueVersion: 3, positionMs: 5000, isPlaying: true });
    const s = usePlayer.getState();
    expect(s.queue.map((x) => x.id)).toEqual([1, 2]);
    expect(s.index).toBe(1);
    expect(s.isPlaying).toBe(true);
    expect(sent.some((c) => c.type === 'setQueue')).toBe(false);
    expect(useNative.getState().positionMs).toBe(5000);
  });

  it('pushes the restored queue, paused, when native is empty', () => {
    const { bridge, sent, emit } = fakeBridge();
    usePlayer.setState({ queue: [t(9)], index: 0, repeat: 'all', volume: 0.5 });
    stop = startNativeSync(bridge);
    emit(emptyQueue);
    expect(sent).toContainEqual({ type: 'setQueue', tracks: [t(9)], index: 0, positionMs: 0, play: false, baseVersion: 0 });
    expect(sent).toContainEqual({ type: 'setRepeat', mode: 'all' });
    expect(sent).toContainEqual({ type: 'setVolume', value: 0.5 });
  });

  it('forwards store actions', () => {
    const { bridge, sent, emit } = fakeBridge();
    stop = startNativeSync(bridge);
    emit(emptyQueue);
    sent.length = 0;
    usePlayer.getState().playQueue([t(1), t(2), t(3)], 0);
    expect(sent.at(-1)).toEqual({ type: 'setQueue', tracks: [t(1), t(2), t(3)], index: 0, positionMs: 0, play: true, baseVersion: 0 });
    usePlayer.getState().appendTracks([t(4)]);
    expect(sent.at(-1)).toMatchObject({ type: 'syncQueue', index: 0, baseVersion: 0 });
    usePlayer.getState().jumpTo(2);
    expect(sent).toContainEqual({ type: 'jumpTo', index: 2 });
    usePlayer.getState().toggle();
    expect(sent.at(-1)).toEqual({ type: 'pause' });
    usePlayer.getState().cycleRepeat();
    expect(sent.at(-1)).toEqual({ type: 'setRepeat', mode: 'all' });
  });

  it('applies native state without echoing it back', () => {
    const { bridge, sent, emit } = fakeBridge();
    stop = startNativeSync(bridge);
    emit(emptyQueue);
    usePlayer.getState().playQueue([t(1), t(2)], 0);
    sent.length = 0;
    emit({ type: 'state', isPlaying: true, index: 1, positionMs: 1000, durationMs: 200000, buffering: false, queueVersion: 0, sleepUntil: 123 });
    expect(usePlayer.getState().index).toBe(1);
    expect(sent).toEqual([]);
    expect(useNative.getState()).toMatchObject({ positionMs: 1000, durationMs: 200000, sleepUntil: 123 });
  });

  it('re-reads the queue native sends after a rejected sync', () => {
    const { bridge, sent, emit } = fakeBridge();
    stop = startNativeSync(bridge);
    emit(emptyQueue);
    usePlayer.getState().playQueue([t(1)], 0);
    emit({ type: 'queue', tracks: [t(7), t(8)], index: 0, queueVersion: 1, positionMs: 0, isPlaying: true });
    expect(usePlayer.getState().queue.map((x) => x.id)).toEqual([7, 8]);
    usePlayer.getState().appendTracks([t(9)]);
    expect(sent.at(-1)).toMatchObject({ type: 'syncQueue', baseVersion: 1 });
  });

  it('stops cleanly', () => {
    const { bridge } = fakeBridge();
    stop = startNativeSync(bridge);
    stop();
    expect(useNative.getState().active).toBe(false);
    expect(nativeBridge()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/client/__tests__/nativeSync.test.ts`
Expected: FAIL — cannot resolve `@/lib/client/nativeSync`.

- [ ] **Step 3: Implement `src/lib/client/nativeSync.ts`**

```ts
'use client';

import { create } from 'zustand';
import { usePlayer } from '@/store/player';
import { loadEq } from '@/lib/eq';
import { loadQuality } from '@/lib/adaptive';
import type { Track } from '@/lib/types';
import { connect, findPort, type NativeBridge } from './nativeBridge';

/**
 * In the Android app the native player is the engine. The player store stays the source of queue logic
 * (shuffle order, radio refill, DJ sets); this module mirrors its changes to native as commands and folds
 * native's state (lock-screen skips, track ends, position) back into the store — without echoing those
 * writes back to native.
 */

interface NativeState {
  active: boolean;
  positionMs: number;
  durationMs: number;
  buffering: boolean;
  sleepUntil: number | null;
}

export const useNative = create<NativeState>(() => ({
  active: false,
  positionMs: 0,
  durationMs: 0,
  buffering: false,
  sleepUntil: null,
}));

let current: NativeBridge | null = null;

/** The live bridge while native playback is active, else null. */
export const nativeBridge = () => current;

type PlayerSnapshot = ReturnType<typeof usePlayer.getState>;

export function startNativeSync(bridge: NativeBridge): () => void {
  current = bridge;
  let applying = false; // store writes made on native's behalf must not be sent back
  let ready = false; // native's queue has been read and reconciled
  let version = 0; // last queueVersion native reported

  const apply = (patch: Partial<PlayerSnapshot>) => {
    applying = true;
    try {
      usePlayer.setState(patch);
    } finally {
      applying = false;
    }
  };

  const pushQueue = (queue: Track[], index: number, play: boolean) =>
    bridge.send({ type: 'setQueue', tracks: queue, index, positionMs: 0, play, baseVersion: version });

  const sendSettings = () => {
    const s = usePlayer.getState();
    bridge.send({ type: 'setRepeat', mode: s.repeat });
    bridge.send({ type: 'setVolume', value: s.volume });
    if (typeof window === 'undefined') return;
    const eq = loadEq();
    bridge.send({ type: 'setEq', enabled: eq.enabled, gains: eq.gains });
    bridge.send({ type: 'setQuality', value: loadQuality() });
  };

  const off = bridge.on((e) => {
    switch (e.type) {
      case 'queue': {
        version = e.queueVersion;
        useNative.setState({ positionMs: e.positionMs });
        if (!ready) {
          ready = true;
          if (e.tracks.length === 0) {
            // native has nothing: hand it the session the page restored, paused
            const s = usePlayer.getState();
            if (s.queue.length > 0) pushQueue(s.queue, s.index, false);
            sendSettings();
            return;
          }
          sendSettings();
        }
        apply({ queue: e.tracks, originalQueue: e.tracks.slice(), index: e.index, isPlaying: e.isPlaying });
        return;
      }
      case 'state': {
        version = e.queueVersion;
        useNative.setState({
          positionMs: e.positionMs,
          durationMs: e.durationMs,
          buffering: e.buffering,
          sleepUntil: e.sleepUntil ?? null,
        });
        const s = usePlayer.getState();
        if (ready && (s.index !== e.index || s.isPlaying !== e.isPlaying)) apply({ index: e.index, isPlaying: e.isPlaying });
        return;
      }
      case 'trackError':
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('spotless-track-error', { detail: e }));
        return;
      default:
        return;
    }
  });

  const unsubscribe = usePlayer.subscribe((s, prev) => {
    if (applying || !ready) return;
    let replaced = false;
    if (s.queue !== prev.queue) {
      const was = prev.queue[prev.index];
      const now = s.queue[s.index];
      if (was && now && was.id === now.id && s.isPlaying === prev.isPlaying) {
        // same song keeps playing: only what is around it changed
        bridge.send({ type: 'syncQueue', tracks: s.queue, index: s.index, baseVersion: version });
      } else {
        pushQueue(s.queue, s.index, s.isPlaying);
        replaced = true;
      }
    } else if (s.index !== prev.index) {
      bridge.send({ type: 'jumpTo', index: s.index });
    }
    if (!replaced && s.isPlaying !== prev.isPlaying) bridge.send({ type: s.isPlaying ? 'play' : 'pause' });
    if (s.repeat !== prev.repeat) bridge.send({ type: 'setRepeat', mode: s.repeat });
    if (s.volume !== prev.volume) bridge.send({ type: 'setVolume', value: s.volume });
    if (s.duck !== prev.duck) bridge.send({ type: 'setDuck', value: s.duck });
  });

  const onEq = () => {
    const eq = loadEq();
    bridge.send({ type: 'setEq', enabled: eq.enabled, gains: eq.gains });
  };
  const onQuality = () => bridge.send({ type: 'setQuality', value: loadQuality() });
  if (typeof window !== 'undefined') {
    window.addEventListener('eq-changed', onEq);
    window.addEventListener('quality-changed', onQuality);
  }

  bridge.send({ type: 'getState' });
  useNative.setState({ active: true });

  return () => {
    off();
    unsubscribe();
    if (typeof window !== 'undefined') {
      window.removeEventListener('eq-changed', onEq);
      window.removeEventListener('quality-changed', onQuality);
    }
    if (current === bridge) current = null;
    useNative.setState({ active: false, positionMs: 0, durationMs: 0, buffering: false, sleepUntil: null });
  };
}

/**
 * Called once by the Player on mount. Inside the Android app it performs the handshake, waits for the
 * saved session to be restored from localStorage, then starts mirroring. Elsewhere it does nothing.
 */
export function connectNative(): () => void {
  const port = findPort();
  if (!port) return () => {};
  let cancelled = false;
  let stop: (() => void) | null = null;
  connect(port).then(async (bridge) => {
    if (!bridge || cancelled) return;
    if (!usePlayer.persist.hasHydrated()) {
      await new Promise<void>((resolve) => {
        const unsub = usePlayer.persist.onFinishHydration(() => {
          unsub();
          resolve();
        });
      });
    }
    if (!cancelled) stop = startNativeSync(bridge);
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `npx vitest run src/lib/client/__tests__/nativeSync.test.ts && npm run typecheck && npm run lint`
Expected: PASS; no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client/nativeSync.ts src/lib/client/__tests__/nativeSync.test.ts && git commit -m "Web: mirror the player store to the Android app's native player

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Web — Player, DJ voice and settings use native playback

**Files:**
- Modify: `src/components/Player.tsx` (lines 1–22 imports, 144–149 state, 175–177 rehydrate effect, 682–704 sleep timer, 706–724 seek, 815–816 audio elements)
- Modify: `src/lib/client/djVoice.ts`
- Modify: `src/app/settings/page.tsx` (crossfade block around lines 752–766)
- Test: `src/lib/client/__tests__/djVoice.test.ts`

**Interfaces:**
- Consumes: `useNative`, `nativeBridge`, `connectNative` (Task 16); `NativeBridge` (Task 15).
- Produces: `djVoice.ts` exports `bytesToBase64(bytes: Uint8Array): string` in addition to its existing exports.

- [ ] **Step 1: Write the failing DJ voice test**

`src/lib/client/__tests__/djVoice.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeBridge, NativeCommand, NativeEvent } from '@/lib/client/nativeBridge';
import { startNativeSync } from '@/lib/client/nativeSync';
import { bytesToBase64, speak } from '@/lib/client/djVoice';
import { usePlayer } from '@/store/player';

function answeringBridge() {
  const sent: NativeCommand[] = [];
  const listeners = new Set<(e: NativeEvent) => void>();
  const bridge: NativeBridge = {
    appVersion: '0.3.1',
    caps: [],
    send: (c) => {
      sent.push(c);
      // the app plays the clip and reports when it is done
      if (c.type === 'speak') queueMicrotask(() => listeners.forEach((l) => l({ type: 'speaking', id: c.id, active: false })));
    },
    on: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
  return { bridge, sent };
}

describe('djVoice in the Android app', () => {
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
  });

  it('base64-encodes bytes', () => {
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe('AQID');
    expect(bytesToBase64(new Uint8Array(70000).fill(65)).length).toBe(93336);
  });

  it('hands server voice clips to native and does not duck in JS', async () => {
    const { bridge, sent } = answeringBridge();
    stop = startNativeSync(bridge);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } })));
    await speak('hello there');
    const cmd = sent.find((c) => c.type === 'speak');
    expect(cmd).toMatchObject({ type: 'speak', audio: 'AQID', mime: 'audio/mpeg' });
    expect(usePlayer.getState().duck).toBe(1);
  });

  it('routes browser-voice mode to the device voice', async () => {
    const { bridge, sent } = answeringBridge();
    stop = startNativeSync(bridge);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ browser: true })));
    await speak('hi');
    expect(sent.find((c) => c.type === 'speak')).toMatchObject({ type: 'speak', text: 'hi' });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/client/__tests__/djVoice.test.ts`
Expected: FAIL — `bytesToBase64` is not exported.

- [ ] **Step 3: Change `src/lib/client/djVoice.ts`**

Add the import below the existing `usePlayer` import:

```ts
import { nativeBridge } from './nativeSync';
import type { NativeBridge } from './nativeBridge';
```

Replace `duck`, `unduck` and `stopSpeaking` with:

```ts
// In the Android app the native player ducks the music itself while the voice plays.
function duck() {
  if (nativeBridge()) return;
  usePlayer.getState().setDuck(DUCK_GAIN);
}

function unduck() {
  if (nativeBridge()) return;
  usePlayer.getState().setDuck(1);
}

export function stopSpeaking() {
  generation++;
  current?.pause();
  current = null;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  nativeBridge()?.send({ type: 'stopSpeaking' });
  unduck();
  if (speaking !== null) setSpeaking(null);
}
```

Add after `speakInBrowser`:

```ts
/** Standard base64 of raw bytes, in chunks so long clips don't overflow the argument list. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

let nativeSpeechId = 0;

/** Have the Android app say it (a clip, or its on-device voice); resolves when it is done. */
function speakNative(bridge: NativeBridge, payload: { audio?: string; mime?: string; text?: string }): Promise<void> {
  const id = ++nativeSpeechId;
  return new Promise((resolve) => {
    const off = bridge.on((e) => {
      if (e.type === 'speaking' && e.id === id && !e.active) {
        off();
        resolve();
      }
    });
    bridge.send({ type: 'speak', id, ...payload });
  });
}
```

In `speak()`, replace the `if (d.browser) { … }` block with:

```ts
      if (d.browser) {
        const bridge = nativeBridge();
        if (bridge) {
          await speakNative(bridge, { text });
          return {};
        }
        duck();
        await speakInBrowser(text);
        if (!stale()) unduck();
        return {};
      }
```

and, right after `if (stale()) return {};` that follows `const blob = await res.blob();`, insert:

```ts
    const bridge = nativeBridge();
    if (bridge) {
      const audio = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      if (stale()) return {};
      await speakNative(bridge, { audio, mime: blob.type || 'audio/mpeg' });
      return {};
    }
```

- [ ] **Step 4: Run the DJ voice test**

Run: `npx vitest run src/lib/client/__tests__/djVoice.test.ts`
Expected: PASS.

- [ ] **Step 5: Change `src/components/Player.tsx`**

Add to the imports (after `import { attachEq, resumeEq } from '@/lib/eq';`):

```ts
import { connectNative, nativeBridge, useNative } from '@/lib/client/nativeSync';
```

Replace lines 144–145:

```ts
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
```

with:

```ts
  const [webProgress, setProgress] = useState(0);
  const [webDuration, setDuration] = useState(0);
  // In the Android app the native player is the engine: position, duration and the sleep timer come from it,
  // and the <audio> elements below are not rendered (every engine handler already no-ops without them).
  const nativeState = useNative();
  const progress = nativeState.active ? nativeState.positionMs / 1000 : webProgress;
  const duration = nativeState.active ? nativeState.durationMs / 1000 : webDuration;
```

Replace line 149:

```ts
  const [sleepUntil, setSleepUntil] = useState<number | null>(null);
```

with:

```ts
  const [webSleepUntil, setSleepUntil] = useState<number | null>(null);
  const sleepUntil = nativeState.active ? nativeState.sleepUntil : webSleepUntil;
```

Replace the rehydrate effect (lines 175–177):

```ts
  useEffect(() => {
    usePlayer.persist?.rehydrate()?.catch(() => {});
  }, []);
```

with:

```ts
  useEffect(() => {
    usePlayer.persist?.rehydrate()?.catch(() => {});
    // inside the Android app, hand playback to the native player once the session is restored
    return connectNative();
  }, []);
```

Replace the sleep timer effect and `cycleSleep` (lines 682–703) with:

```ts
  // sleep timer (browser): pause when it fires — the Android app runs its own
  useEffect(() => {
    if (!webSleepUntil) return;
    const t = setInterval(() => {
      if (Date.now() >= webSleepUntil) {
        setPlaying(false);
        setSleepUntil(null);
      }
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webSleepUntil]);

  const cycleSleep = () => {
    let minutes: number | null = SLEEP_STEPS[0];
    if (sleepUntil) {
      const remainMin = Math.ceil((sleepUntil - Date.now()) / 60000);
      minutes = SLEEP_STEPS.find((m) => m > remainMin) ?? null;
    }
    const bridge = nativeBridge();
    if (nativeState.active && bridge) bridge.send({ type: 'setSleepTimer', minutes: minutes ?? 0 });
    else setSleepUntil(minutes ? Date.now() + minutes * 60000 : null);
  };
```

At the top of `seek` (line 706, before `const a = els()[active];`) insert:

```ts
    const bridge = nativeBridge();
    if (nativeState.active && bridge) {
      const positionMs = Math.round(v * 1000);
      bridge.send({ type: 'seek', positionMs });
      useNative.setState({ positionMs });
      return;
    }
```

Replace lines 815–816:

```tsx
      <audio ref={audioARef} {...audioProps} />
      <audio ref={audioBRef} {...audioProps} />
```

with:

```tsx
      {!nativeState.active && (
        <>
          <audio ref={audioARef} {...audioProps} />
          <audio ref={audioBRef} {...audioProps} />
        </>
      )}
```

- [ ] **Step 6: Change `src/app/settings/page.tsx`**

Add the import near the other imports at the top of the file:

```ts
import { nativeBridge, useNative } from '@/lib/client/nativeSync';
```

Inside `SettingsPage()` with the other hooks:

```ts
  const nativeActive = useNative((s) => s.active);
```

In the crossfade block, add `disabled={nativeActive}` to the crossfade `<input type="range" …>`, and directly after the paragraph that starts "0 = tracks start instantly back-to-back." insert:

```tsx
        {nativeActive && (
          <p className="mt-1 text-sm text-subdued">Not available in the Android app yet — songs play gapless.</p>
        )}
        {nativeActive && (
          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Android app</div>
              <p className="text-sm text-subdued">Connect this app to a different Spotless server.</p>
            </div>
            <button
              onClick={() => nativeBridge()?.send({ type: 'changeServer' })}
              className="rounded-full border border-highlight px-4 py-1.5 text-sm font-bold hover:border-white"
            >
              Change server
            </button>
          </div>
        )}
```

- [ ] **Step 7: Run all web checks**

Run: `npm test && npm run typecheck && npm run lint && npm run format:check`
Expected: all pass. (Run `npm run format` first if only formatting differs.)

- [ ] **Step 8: Confirm the browser player is unchanged**

Start the dev server with the preview tool (create `.claude/launch.json` with `{"version":"0.0.1","configurations":[{"name":"spotless-dev","runtimeExecutable":"npm","runtimeArgs":["run","dev"],"port":3000}]}` if it does not exist), sign in, play a track, seek, use the sleep button, and check `read_console_messages` for errors. Expected: playback, seek and sleep behave exactly as before; `window.SpotlessNative` is undefined; no console errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/Player.tsx src/lib/client/djVoice.ts src/app/settings/page.tsx src/lib/client/__tests__/djVoice.test.ts && git commit -m "Web: hand playback, DJ voice and the sleep timer to the Android app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: On-device verification

**Files:** none (fixes found here go back into the task that owns the file).

This needs a real Android phone with USB debugging enabled and the Spotless dev or production server reachable from it. **Ask the user to connect the phone** before starting; do not guess server addresses — ask for the one they use.

- [ ] **Step 1: Build and install**

```bash
cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The phone must reach a server that already has the Task 15–17 web changes (run `npm run dev -- -H 0.0.0.0` on this PC, or deploy the branch to the test container on port 3300 per the home setup).

- [ ] **Step 2: Run the checklist, recording pass/fail for each**

1. 30 minutes of playback with the screen off.
2. Same on a phone with aggressive battery saving (Samsung "Put unused apps to sleep" etc.), if available.
3. Bluetooth headset play / pause / next.
4. Incoming call pauses; music resumes after.
5. Headphone unplug pauses.
6. Lock-screen and notification controls, including scrubbing; Wear OS watch controls if a watch is paired.
7. AI DJ: voice segue ducks the music and restores it.
8. Revoke the session from another device (Manage profiles → revoke) mid-play → app shows the sign-in page.
9. Stop the server mid-play → the track errors and skips, no crash; server back → plays again.
10. Force-stop the app (Settings → Apps → Spotless → Force stop), then press play on the Bluetooth headset → the last queue resumes.
11. Change server from Settings → Playback and from the launcher icon's long-press shortcut.
12. Spotify and Last.fm connect flows complete inside the app.
13. EQ preset change is audible; quality "Data saver" on mobile data plays; `adb logcat | grep -i spotless` shows no crash.

- [ ] **Step 3: Fix, rebuild, re-run the failed items, then commit fixes per owning task**

---

### Task 19: CI, release and docs

**Files:**
- Create: `.github/workflows/android.yml`
- Modify: `.github/workflows/docker.yml` (desktop job block ~line 95, release job ~line 106–160)
- Modify: `README.md` (after the "Desktop app" section, ~line 189–211), `CHANGELOG.md` (Unreleased section)

**Interfaces:**
- Consumes: `android/` Gradle project; repository secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (optional — the user creates them; without them releases ship without an APK).
- Produces: artifact `android-debug` on pull requests; artifact `android-apk` (`Spotless-<version>.apk`) on tag builds; the APK attached to GitHub Releases.

- [ ] **Step 1: Write `.github/workflows/android.yml`**

```yaml
name: Android app

# Builds the Android app (android/). Pull requests that touch it run the unit tests and build a debug APK
# that can be downloaded from the run's artifacts; the release job in docker.yml calls this workflow on v*
# tags and attaches the signed APK to the release. Without the signing secrets (forks) no release APK is built.
on:
  pull_request:
    paths:
      - 'android/**'
      - 'package.json'
      - '.github/workflows/android.yml'
  workflow_call:
    secrets:
      ANDROID_KEYSTORE_B64:
        required: false
      ANDROID_KEYSTORE_PASSWORD:
        required: false
      ANDROID_KEY_ALIAS:
        required: false
      ANDROID_KEY_PASSWORD:
        required: false
  workflow_dispatch:

concurrency:
  group: android-${{ github.ref }}-${{ github.event_name }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    env:
      HAS_KEYSTORE: ${{ secrets.ANDROID_KEYSTORE_B64 != '' }}

    defaults:
      run:
        shell: bash
        working-directory: android

    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: 17

      - uses: gradle/actions/setup-gradle@v4

      - run: ./gradlew --no-daemon testDebugUnitTest assembleDebug

      - uses: actions/upload-artifact@v7
        if: github.event_name == 'pull_request'
        with:
          name: android-debug
          if-no-files-found: error
          path: android/app/build/outputs/apk/debug/app-debug.apk

      - name: Build the signed release APK
        if: github.event_name != 'pull_request' && env.HAS_KEYSTORE == 'true'
        env:
          KEYSTORE_B64: ${{ secrets.ANDROID_KEYSTORE_B64 }}
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          echo "$KEYSTORE_B64" | base64 -d > "$RUNNER_TEMP/release.jks"
          ANDROID_KEYSTORE_FILE="$RUNNER_TEMP/release.jks" ./gradlew --no-daemon assembleRelease
          VERSION="$(node -p "require('../package.json').version")"
          mkdir -p dist
          cp app/build/outputs/apk/release/app-release.apk "dist/Spotless-$VERSION.apk"
          rm -f "$RUNNER_TEMP/release.jks"

      - uses: actions/upload-artifact@v7
        if: github.event_name != 'pull_request' && env.HAS_KEYSTORE == 'true'
        with:
          name: android-apk
          if-no-files-found: error
          path: android/dist/*.apk
```

- [ ] **Step 2: Wire it into the release in `.github/workflows/docker.yml`**

After the `desktop:` job, add:

```yaml
  # Android APK for a release; only built for v* tags. Pull requests that touch android/ build it
  # through android.yml directly.
  android:
    needs: ci
    if: startsWith(github.ref, 'refs/tags/v')
    permissions:
      contents: read
    uses: ./.github/workflows/android.yml
    secrets: inherit
```

In the `release:` job change `needs: [build, desktop]` to `needs: [build, desktop, android]`; after the `echo "**Desktop app:** …" >> notes.md` line add:

```bash
          echo >> notes.md
          echo "**Android app:** install Spotless-${VERSION}.apk below on your phone (allow installs from your browser or file manager when asked) and point it at your server." >> notes.md
```

and after the desktop `download-artifact` step add:

```yaml
      # absent when the signing secrets are not configured
      - uses: actions/download-artifact@v8
        continue-on-error: true
        with:
          name: android-apk
          path: desktop-dist
```

- [ ] **Step 3: Document it**

In `README.md`, after the "Desktop app" section, add:

```markdown
## Android app

Each [release](https://github.com/Dj2Swagittarius/spotless/releases) includes `Spotless-<version>.apk`. Install it
on your phone (Android 8 or newer; allow installs from your browser or file manager when asked), enter your
server's address — the same one you use in a browser — and sign in.

The app shows the same Spotless pages as the browser, but plays music natively: it keeps playing with the screen
off and has lock-screen, notification, Bluetooth headset and Wear OS controls. EQ, streaming quality, ReplayGain,
the sleep timer and the AI DJ's voice all work; crossfade is not available in the app yet (songs play gapless).

To build it from source you need JDK 17 and the Android SDK: `cd android && ./gradlew assembleDebug` writes
`android/app/build/outputs/apk/debug/app-debug.apk`.
```

In `CHANGELOG.md`, under the Unreleased "Added" heading (create the heading if missing, following the file's existing format):

```markdown
- Android app (`android/`): the Spotless UI with native playback — keeps playing with the screen off, lock-screen,
  notification, Bluetooth and Wear OS controls, EQ, adaptive quality, ReplayGain, sleep timer and AI DJ voice.
  Release builds attach a signed APK.
```

- [ ] **Step 4: Validate the workflow files**

Run: `npx --yes prettier --check .github/workflows/android.yml .github/workflows/docker.yml README.md CHANGELOG.md`
Expected: no errors (run `npx prettier --write` on them if only formatting differs).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/android.yml .github/workflows/docker.yml README.md CHANGELOG.md && git commit -m "Android: CI build, release APK, docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Tell the user what they must do themselves**

The release APK needs a signing key that only the user should hold. Give them these steps (do not run them):

1. Create a key once: `keytool -genkeypair -v -keystore spotless-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias spotless`
2. Keep `spotless-release.jks` and its passwords somewhere safe (losing it means users must uninstall to upgrade).
3. Add repository secrets: `ANDROID_KEYSTORE_B64` (output of `base64 -w0 spotless-release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`spotless`), `ANDROID_KEY_PASSWORD`.

Note from memory: `gh` cannot merge PRs that touch `.github/workflows`; merge this branch locally and push.
