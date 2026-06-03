package today.mindlog.id.feature.onboarding

import android.Manifest
import android.content.pm.PackageManager
import today.mindlog.id.core.designsystem.QrScanner
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun OnboardingRoute(
    viewModel: OnboardingViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    OnboardingScreen(
        uiState = uiState,
        onPinChange = viewModel::onPinChange,
        onSubmit = { viewModel.submitPin() },
        onScanResult = viewModel::submitScanned,
        onToggleScan = viewModel::onToggleScan,
        onHandleChange = viewModel::onHandleChange,
        onPasskey = { viewModel.signInWithPasskey { opts -> getPasskeyAssertion(context, opts) } },
        onToggleServerEdit = viewModel::onToggleServerEdit,
        onServerInputChange = viewModel::onServerInputChange,
        onSaveServer = viewModel::saveServer,
        onResetServer = viewModel::resetServer,
    )
}

@Composable
internal fun OnboardingScreen(
    uiState: OnboardingUiState,
    onPinChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onScanResult: (String) -> Unit,
    onToggleScan: (Boolean) -> Unit,
    onHandleChange: (String) -> Unit,
    onPasskey: () -> Unit,
    onToggleServerEdit: (Boolean) -> Unit,
    onServerInputChange: (String) -> Unit,
    onSaveServer: () -> Unit,
    onResetServer: () -> Unit,
) {
    if (uiState.scanning) {
        ScanLayer(onResult = onScanResult, onCancel = { onToggleScan(false) })
        return
    }

    val context = LocalContext.current
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) onToggleScan(true) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .imePadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("mindlog · id", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Saisis le code PIN affiché sur ton compte web 🦎",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
        )

        OutlinedTextField(
            value = uiState.pinInput,
            onValueChange = onPinChange,
            label = { Text("Code PIN à 6 chiffres") },
            singleLine = true,
            isError = uiState.error != null,
            supportingText = uiState.error?.let { { Text(it) } },
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.NumberPassword,
                imeAction = ImeAction.Go,
            ),
            keyboardActions = KeyboardActions(onGo = { if (uiState.pinInput.length == 6) onSubmit() }),
            modifier = Modifier.fillMaxWidth(),
        )

        Button(
            onClick = onSubmit,
            enabled = !uiState.loading && uiState.pinInput.length == 6,
            modifier = Modifier.padding(top = 16.dp),
        ) {
            if (uiState.loading) {
                CircularProgressIndicator(modifier = Modifier.padding(end = 8.dp))
            }
            Text("Se connecter")
        }

        OutlinedButton(
            onClick = {
                val granted = ContextCompat.checkSelfPermission(
                    context, Manifest.permission.CAMERA,
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) onToggleScan(true) else permissionLauncher.launch(Manifest.permission.CAMERA)
            },
            enabled = !uiState.loading,
            modifier = Modifier.padding(top = 8.dp),
        ) {
            Text("Scanner un QR code")
        }

        OutlinedTextField(
            value = uiState.handleInput,
            onValueChange = onHandleChange,
            label = { Text("Identifiant (@handle)") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
        )
        OutlinedButton(
            onClick = onPasskey,
            enabled = !uiState.loading && uiState.handleInput.isNotBlank(),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            Text("Se connecter avec une passkey")
        }

        ServerSelector(
            uiState = uiState,
            onToggleEdit = onToggleServerEdit,
            onInputChange = onServerInputChange,
            onSave = onSaveServer,
            onReset = onResetServer,
        )
    }
}

@Composable
private fun ServerSelector(
    uiState: OnboardingUiState,
    onToggleEdit: (Boolean) -> Unit,
    onInputChange: (String) -> Unit,
    onSave: () -> Unit,
    onReset: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (!uiState.editingServer) {
            Text(
                "Serveur : ${uiState.serverHost}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = { onToggleEdit(true) }, enabled = !uiState.loading) {
                Text("Changer de serveur")
            }
        } else {
            OutlinedTextField(
                value = uiState.serverInput,
                onValueChange = onInputChange,
                label = { Text("Adresse du serveur") },
                placeholder = { Text("ex. id.mindlog.today ou monserveur.fr:8443") },
                singleLine = true,
                isError = uiState.serverError != null,
                supportingText = {
                    Text(uiState.serverError ?: "https par défaut. Préfixe http:// pour un serveur local.")
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(onGo = { onSave() }),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(
                modifier = Modifier.padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = onSave, enabled = uiState.serverInput.isNotBlank()) {
                    Text("Enregistrer")
                }
                if (!uiState.isDefaultServer) {
                    OutlinedButton(onClick = onReset) { Text("Par défaut") }
                }
                TextButton(onClick = { onToggleEdit(false) }) { Text("Annuler") }
            }
        }
    }
}

@Composable
private fun ScanLayer(
    onResult: (String) -> Unit,
    onCancel: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxSize()) {
        QrScanner(onResult = onResult, modifier = Modifier.fillMaxSize())
        OutlinedButton(
            onClick = onCancel,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(32.dp),
        ) {
            Text("Annuler")
        }
    }
}
