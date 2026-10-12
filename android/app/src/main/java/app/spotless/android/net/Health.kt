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
