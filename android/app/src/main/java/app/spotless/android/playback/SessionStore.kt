package app.spotless.android.playback

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.spotless.android.bridge.BridgeJson
import kotlinx.coroutines.flow.first
import java.io.IOException

private val Context.sessionData by preferencesDataStore("session")

/** The last queue and position, so playback can resume after the process was killed. */
class SessionStore(private val context: Context) {
    private val key = stringPreferencesKey("snapshot")

    suspend fun save(snapshot: SessionSnapshot) {
        val text = BridgeJson.json.encodeToString(SessionSnapshot.serializer(), snapshot)
        context.sessionData.edit { it[key] = text }
    }

    suspend fun load(): SessionSnapshot? {
        val prefs = try {
            context.sessionData.data.first()
        } catch (_: IOException) {
            return null
        }
        val text = prefs[key] ?: return null
        return runCatching { BridgeJson.json.decodeFromString(SessionSnapshot.serializer(), text) }.getOrNull()
    }

    suspend fun clear() {
        context.sessionData.edit { it.remove(key) }
    }
}
