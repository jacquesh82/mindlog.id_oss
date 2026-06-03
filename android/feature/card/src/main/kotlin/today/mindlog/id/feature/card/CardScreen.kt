package today.mindlog.id.feature.card

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import today.mindlog.id.core.model.Card
import today.mindlog.id.core.model.CardField

@Composable
fun CardRoute(
    onSignedOut: () -> Unit,
    viewModel: CardViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    CardScreen(
        uiState = uiState,
        onRefresh = viewModel::refresh,
        onSignOut = {
            viewModel.signOut()
            onSignedOut()
        },
        onSaveField = viewModel::saveField,
        onDeleteField = viewModel::deleteField,
        onUploadPhoto = viewModel::uploadPhoto,
        onBackupKey = viewModel::backupKey,
        onToggleSecret = viewModel::toggleSecret,
        onAddTag = viewModel::addTag,
        onRemoveTag = viewModel::removeTag,
        onErrorShown = viewModel::clearError,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CardScreen(
    uiState: CardUiState,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
    onSaveField: (key: String, value: String, label: String?, visibility: String) -> Unit,
    onDeleteField: (String) -> Unit,
    onUploadPhoto: (ByteArray, String) -> Unit,
    onBackupKey: (String) -> Unit,
    onToggleSecret: () -> Unit,
    onAddTag: (String) -> Unit,
    onRemoveTag: (String) -> Unit,
    onErrorShown: () -> Unit,
) {
    // null = pas de dialogue ; adding = true ; sinon édition du champ donné.
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<CardField?>(null) }
    var backingUp by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var photoChooser by remember { mutableStateOf(false) }

    // Galerie : on retaille à 320×320 max (ratio préservé) avant l'envoi.
    val photoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri != null) {
            val bytes = runCatching {
                context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            }.getOrNull()
            if (bytes != null) onUploadPhoto(resizeProfilePhoto(bytes), "image/jpeg")
        }
    }
    // Appareil photo : aperçu (Bitmap) renvoyé par l'app caméra, retaillé pareil.
    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicturePreview(),
    ) { bmp ->
        if (bmp != null) onUploadPhoto(resizeProfilePhoto(bmp), "image/jpeg")
    }
    val cameraPermLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) cameraLauncher.launch(null) }
    val launchCamera = {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            cameraLauncher.launch(null)
        } else {
            cameraPermLauncher.launch(Manifest.permission.CAMERA)
        }
    }
    val launchGallery = {
        photoPicker.launch(
            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
        )
    }
    val pickPhoto = { photoChooser = true }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            scope.launch { snackbarHostState.showSnackbar(it) }
            onErrorShown()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Ma carte") },
                actions = {
                    IconButton(onClick = onRefresh, enabled = !uiState.refreshing) {
                        Icon(Icons.Default.Refresh, contentDescription = "Rafraîchir")
                    }
                    IconButton(onClick = onSignOut) {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Déconnexion")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        floatingActionButton = {
            if (uiState.card != null) {
                FloatingActionButton(onClick = { adding = true }) {
                    Icon(Icons.Default.Add, contentDescription = "Ajouter un attribut")
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            val card = uiState.card
            when {
                card != null -> Column(Modifier.fillMaxSize()) {
                    if (uiState.refreshing) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (uiState.needsKeyBackup) KeyBackupBanner(onClick = { backingUp = true })
                    CardContent(
                        card = card,
                        photoVersion = uiState.photoVersion,
                        pagePublic = uiState.pagePublic,
                        tags = uiState.tags,
                        onFieldClick = { editing = it },
                        onPickPhoto = pickPhoto,
                        onToggleSecret = onToggleSecret,
                        onAddTag = onAddTag,
                        onRemoveTag = onRemoveTag,
                    )
                }

                uiState.refreshing -> CircularProgressIndicator(Modifier.align(Alignment.Center))

                else -> Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(uiState.error ?: "Aucune donnée", color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = onRefresh) { Text("Réessayer") }
                }
            }
        }
    }

    if (adding || editing != null) {
        FieldEditDialog(
            existing = editing,
            onDismiss = { adding = false; editing = null },
            onSave = { key, value, label, visibility ->
                onSaveField(key, value, label, visibility)
                adding = false; editing = null
            },
            onDelete = { key ->
                onDeleteField(key)
                adding = false; editing = null
            },
        )
    }

    if (backingUp) {
        KeyBackupDialog(
            onDismiss = { backingUp = false },
            onConfirm = { passphrase -> onBackupKey(passphrase); backingUp = false },
        )
    }

    if (photoChooser) {
        AlertDialog(
            onDismissRequest = { photoChooser = false },
            title = { Text("Photo de profil") },
            text = {
                Column {
                    ListItem(
                        modifier = Modifier.clickable { photoChooser = false; launchGallery() },
                        headlineContent = { Text("Choisir dans la galerie") },
                        leadingContent = { Icon(Icons.Default.Public, contentDescription = null) },
                    )
                    ListItem(
                        modifier = Modifier.clickable { photoChooser = false; launchCamera() },
                        headlineContent = { Text("Prendre une photo") },
                        leadingContent = { Icon(Icons.Default.PhotoCamera, contentDescription = null) },
                    )
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { photoChooser = false }) { Text("Annuler") } },
        )
    }
}

/**
 * Retaille une photo de profil pour qu'elle tienne dans 320×320 (ratio préservé,
 * sans déformation) et la ré-encode en JPEG. Parité avec le redimensionnement web.
 */
private fun resizeProfilePhoto(bytes: ByteArray, max: Int = 320): ByteArray {
    val src = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return bytes
    return resizeProfilePhoto(src, max)
}

private fun resizeProfilePhoto(src: android.graphics.Bitmap, max: Int = 320): ByteArray {
    val scale = minOf(1f, max.toFloat() / maxOf(src.width, src.height))
    val w = (src.width * scale).toInt().coerceAtLeast(1)
    val h = (src.height * scale).toInt().coerceAtLeast(1)
    val scaled = if (w == src.width && h == src.height) src
        else android.graphics.Bitmap.createScaledBitmap(src, w, h, true)
    return java.io.ByteArrayOutputStream().use { out ->
        scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, out)
        out.toByteArray()
    }
}

/** Bandeau non bloquant invitant à sauvegarder la clé E2E dans le coffre. */
@Composable
private fun KeyBackupBanner(onClick: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                Icons.Default.Key,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onTertiaryContainer,
            )
            Column(Modifier.weight(1f)) {
                Text(
                    "Sauvegardez votre clé de chiffrement",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
                Text(
                    "Sans sauvegarde, vos messages chiffrés seront illisibles sur vos autres appareils.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
        }
    }
}

@Composable
private fun KeyBackupDialog(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var pass by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Sauvegarder ma clé") },
        text = {
            Column {
                Text(
                    "Choisissez une passphrase (8 caractères min.). Elle protège votre clé " +
                        "dans le coffre et vous permettra de la restaurer sur un autre appareil. " +
                        "Elle n'est jamais envoyée au serveur.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedTextField(
                    value = pass,
                    onValueChange = { pass = it },
                    label = { Text("Passphrase") },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(pass) }, enabled = pass.length >= 8) {
                Text("Sauvegarder")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } },
    )
}

