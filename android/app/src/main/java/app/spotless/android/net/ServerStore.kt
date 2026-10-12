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
