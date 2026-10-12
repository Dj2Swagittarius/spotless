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
