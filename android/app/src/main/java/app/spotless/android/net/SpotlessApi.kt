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
