package today.mindlog.id.feature.gallery

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import today.mindlog.id.core.network.dto.GalleryPhotoDto

private const val BASE_URL = "https://id.mindlog.today"

/**
 * Onglet Galerie : grille 3 colonnes, FAB d'ajout (si c'est ma galerie),
 * tap = toggle like (visiteur) ou suppression (propriétaire).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GalleryRoute(
    handle: String? = null,
    showBack: Boolean = false,
    onBack: () -> Unit = {},
    viewModel: GalleryViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(handle) { viewModel.load(handle) }
    LaunchedEffect(state.error) {
        state.error?.let { msg ->
            scope.launch { snackbarHost.showSnackbar(msg) }
            viewModel.clearError()
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            val bytes = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
            if (bytes != null) viewModel.upload(bytes, "image/jpeg")
        }
    }

    val isMine = state.photos.firstOrNull()?.mine == true || state.photos.isEmpty()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.handle?.let { "Galerie · @$it" } ?: "Galerie") },
                navigationIcon = {
                    if (showBack) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (isMine) {
                FloatingActionButton(onClick = {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }) { Icon(Icons.Default.Add, contentDescription = "Ajouter une photo") }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHost) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
            if (state.photos.isEmpty() && !state.loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (isMine) "Aucune photo. Touche + pour en ajouter." else "Aucune photo publique.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(state.photos, key = { it.id }) { photo ->
                        GalleryTile(
                            photo = photo,
                            onLike = { viewModel.toggleLike(photo.id) },
                            onDelete = { viewModel.delete(photo.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun GalleryTile(
    photo: GalleryPhotoDto,
    onLike: () -> Unit,
    onDelete: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .clip(RoundedCornerShape(6.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer),
    ) {
        AsyncImage(
            model = BASE_URL + photo.url,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        // Overlay du compteur de likes + icône cœur en bas-droit.
        IconButton(
            onClick = onLike,
            modifier = Modifier.align(Alignment.BottomEnd).size(36.dp),
        ) {
            Icon(
                imageVector = if (photo.liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                contentDescription = if (photo.liked) "Retirer le j'aime" else "J'aime",
                tint = if (photo.liked) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.White,
            )
        }
        if (photo.likes > 0) {
            Text(
                "${photo.likes}",
                color = androidx.compose.ui.graphics.Color.White,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(start = 6.dp, bottom = 6.dp)
                    .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.4f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
            )
        }
        if (photo.mine) {
            IconButton(
                onClick = onDelete,
                modifier = Modifier.align(Alignment.TopEnd).size(32.dp),
            ) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "Supprimer",
                    tint = androidx.compose.ui.graphics.Color.White,
                    modifier = Modifier.background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.4f), androidx.compose.foundation.shape.CircleShape).padding(4.dp),
                )
            }
        }
    }
}
