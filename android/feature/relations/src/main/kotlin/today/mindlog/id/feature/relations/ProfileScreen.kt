package today.mindlog.id.feature.relations

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import kotlinx.coroutines.launch
import today.mindlog.id.core.model.PublicProfile

private const val BASE_URL = "https://id.mindlog.today"

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
internal fun ProfileScreen(
    profile: PublicProfile?,
    loading: Boolean,
    onBack: () -> Unit,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    onRequestMeeting: (String) -> Unit,
    onChat: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(profile?.let { "@${it.handle}" } ?: "Profil") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Retour")
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                profile == null -> Text(
                    "Profil indisponible.",
                    modifier = Modifier.align(Alignment.Center),
                )
                else -> ProfilePager(profile, onAdd, onRemove, onRequestMeeting, onChat)
            }
        }
    }
}

/**
 * Carousel de la fiche publique : 4 slides (Hero / About / Calendrier / Galerie),
 * mirroir du `/@handle` Web en mode mobile. Pastilles cliquables en bas.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ProfilePager(
    profile: PublicProfile,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    onRequestMeeting: (String) -> Unit,
    onChat: (String) -> Unit,
) {
    val pagerState = rememberPagerState(pageCount = { 4 })
    Box(Modifier.fillMaxSize()) {
        HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
            when (page) {
                0 -> HeroSlide(profile, onAdd, onRemove, onRequestMeeting, onChat)
                1 -> AboutSlide(profile)
                2 -> CalendarSlide()
                3 -> GallerySlide()
                else -> Box(Modifier.fillMaxSize())
            }
        }
        PagerDots(
            pagerState = pagerState,
            count = 4,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 16.dp),
        )
    }
}

/** Slide 1 : cover (image) en plein écran, scrim sombre, identité + action row. */
@Composable
private fun HeroSlide(
    profile: PublicProfile,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    onRequestMeeting: (String) -> Unit,
    onChat: (String) -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        // Cover : on tente toujours l'URL ; Coil affiche un fond uni si absent.
        AsyncImage(
            model = "$BASE_URL/api/identities/${profile.handle}/cover",
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant),
        )
        // Scrim noir bas vers haut pour lisibilité du texte.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0.4f to Color.Transparent,
                        1f to Color.Black.copy(alpha = 0.7f),
                    ),
                ),
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, bottom = 56.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // Avatar XL + nom + handle.
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                if (profile.hasPhoto) {
                    AsyncImage(
                        model = "$BASE_URL/api/identities/${profile.handle}/photo",
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize().clip(CircleShape),
                    )
                } else {
                    Text(
                        profile.handle.firstOrNull()?.uppercase() ?: "?",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }
            Text(
                profile.displayName ?: "@${profile.handle}",
                style = MaterialTheme.typography.headlineMedium,
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "@${profile.handle}",
                style = MaterialTheme.typography.titleMedium,
                color = Color.White.copy(alpha = 0.85f),
            )
            ActionRow(profile, onAdd, onRemove, onRequestMeeting, onChat)
        }
    }
}

@Composable
private fun ActionRow(
    profile: PublicProfile,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    onRequestMeeting: (String) -> Unit,
    onChat: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (profile.isContact) {
            Button(onClick = { onChat(profile.handle) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
                Text("  Discuter 🔒")
            }
        }
        if (profile.allowRequests) {
            OutlinedButton(onClick = { onRequestMeeting(profile.handle) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.EventAvailable, contentDescription = null)
                Text("  Demander un RDV")
            }
        }
        if (profile.isRelated) {
            OutlinedButton(onClick = { onRemove(profile.handle) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.PersonRemove, contentDescription = null)
                Text("  Retirer des relations")
            }
        } else {
            OutlinedButton(onClick = { onAdd(profile.handle) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.PersonAdd, contentDescription = null)
                Text("  Ajouter aux relations")
            }
        }
    }
}

/** Slide 2 : « À propos » — bio + champs publics. */
@Composable
private fun AboutSlide(profile: PublicProfile) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 56.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val populated = profile.fields.filter { !it.value.isNullOrBlank() }
        if (populated.isEmpty()) {
            item {
                Text(
                    "Aucune information publique.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(populated, key = { it.key }) { field ->
            ListItem(
                headlineContent = { Text(field.value.orEmpty()) },
                overlineContent = { Text(field.label) },
            )
        }
    }
}

/** Slide 3 : calendrier (placeholder — câblage slots/availability dans une itération suivante). */
@Composable
private fun CalendarSlide() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.EventAvailable,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Calendrier",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                "Disponibilités et créneaux — bientôt.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Slide 4 : galerie (placeholder — branchée en P4). */
@Composable
private fun GallerySlide() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.Default.PlayCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Galerie",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                "Photos publiques — bientôt.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Pastilles d'indicateur de page, cliquables pour saut direct. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PagerDots(pagerState: PagerState, count: Int, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    androidx.compose.foundation.layout.Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { index ->
            val active = pagerState.currentPage == index
            Box(
                modifier = Modifier
                    .size(if (active) 10.dp else 8.dp)
                    .clip(CircleShape)
                    .background(if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f))
                    .clickable { scope.launch { pagerState.animateScrollToPage(index) } },
            )
        }
    }
}
