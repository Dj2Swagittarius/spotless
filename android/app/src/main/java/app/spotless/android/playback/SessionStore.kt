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
