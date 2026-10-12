package app.spotless.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
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
        Column(
            // scrolls so the field stays usable in landscape with the keyboard up
            Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
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
        Column(
            // scrolls so the field stays usable in landscape with the keyboard up
            Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
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
