package today.mindlog.id.feature.premium

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Article
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.Workspaces
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import today.mindlog.id.core.data.PremiumRepository
import today.mindlog.id.core.network.dto.OwnerSpaceDto
import today.mindlog.id.core.network.dto.PaidPageContentDto
import today.mindlog.id.core.network.dto.PaidPageDto
import today.mindlog.id.core.network.dto.SpaceBenefitsDto

private val PAGE_TYPES = listOf(
    "markdown" to "Texte (markdown)",
    "gallery" to "Galerie",
    "link" to "Lien externe",
    "file" to "Fichier",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PremiumRoute(
    viewModel: PremiumViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = remember(context) {
        var c: android.content.Context? = context
        while (c is android.content.ContextWrapper) {
            if (c is Activity) return@remember c
            c = c.baseContext
        }
        null
    }
    val snackbarHost = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf<PaidPageDto?>(null) }
    var creating by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<PaidPageDto?>(null) }

    LaunchedEffect(state.error) {
        state.error?.let { scope.launch { snackbarHost.showSnackbar(it) }; viewModel.clearError() }
    }
    LaunchedEffect(state.message) {
        state.message?.let { scope.launch { snackbarHost.showSnackbar(it) }; viewModel.clearMessage() }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Premium") }) },
        snackbarHost = { SnackbarHost(snackbarHost) },
        floatingActionButton = {
            if (state.plan == "premium") {
                FloatingActionButton(onClick = { creating = true }) {
                    Icon(Icons.Default.Add, contentDescription = "Nouvelle page")
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (state.processing) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    PlanCard(
                        plan = state.plan,
                        priceLabel = state.productPriceLabel,
                        onUpgrade = { activity?.let(viewModel::launchPurchase) },
                    )
                }
                if (state.plan == "premium" && state.space != null) {
                    item {
                        SpaceSettingsCard(
                            space = state.space!!,
                            onUpdatePrice = viewModel::updatePrice,
                            onUpdateSpaceIntro = viewModel::updateSpaceIntro,
                            onUpdateProfileIntro = viewModel::updateProfileIntro,
                            onUpdateBenefits = viewModel::updateBenefits,
                        )
                    }
                    item {
                        Text(
                            "Mes pages payantes",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    if (state.pages.isEmpty()) {
                        item {
                            Text(
                                "Aucune page. Appuie sur + pour créer ta première.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        items(state.pages, key = { it.slug }) { page ->
                            PageRow(
                                page = page,
                                onEdit = {
                                    editing = page
                                    viewModel.loadPageContent(page.slug)
                                },
                                onDelete = { confirmDelete = page },
                            )
                        }
                    }
                }
            }
        }
    }

    if (creating) {
        PageEditorDialog(
            page = null,
            content = null,
            onDismiss = { creating = false },
            onSaveMarkdown = { slug, title, body, pub ->
                viewModel.savePage(slug, title, "markdown", body, pub); creating = false
            },
            onSaveLink = { slug, title, url, note, pub ->
                viewModel.saveLink(slug, title, url, note, pub); creating = false
            },
            onCreateEmptyMedia = { slug, title, type, pub ->
                viewModel.saveEmptyMedia(slug, title, type, pub); creating = false
            },
            onUploadMedia = { _, _ -> /* pas d'upload à la création */ },
            onDeleteMedia = { _, _ -> /* idem */ },
        )
    }
    editing?.let { page ->
        PageEditorDialog(
            page = page,
            content = state.editingContent,
            onDismiss = {
                editing = null
                viewModel.clearEditingContent()
            },
            onSaveMarkdown = { slug, title, body, pub ->
                viewModel.savePage(slug, title, "markdown", body, pub); editing = null; viewModel.clearEditingContent()
            },
            onSaveLink = { slug, title, url, note, pub ->
                viewModel.saveLink(slug, title, url, note, pub); editing = null; viewModel.clearEditingContent()
            },
            onCreateEmptyMedia = { _, _, _, _ -> /* not used in edit mode */ },
            onUploadMedia = { slug, files -> viewModel.uploadMedia(slug, files) },
            onDeleteMedia = { slug, filename -> viewModel.deleteMedia(slug, filename) },
        )
    }
    confirmDelete?.let { page ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Supprimer la page ?") },
            text = { Text("« ${page.title.ifBlank { page.slug }} » sera définitivement supprimée.") },
            confirmButton = {
                TextButton(onClick = { viewModel.deletePage(page.slug); confirmDelete = null }) {
                    Text("Supprimer", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Annuler") } },
        )
    }
}

@Composable
private fun PlanCard(
    plan: String,
    priceLabel: String?,
    onUpgrade: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
    ) {
        Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Default.Workspaces, contentDescription = null)
            Text(
                if (plan == "premium") "Premium actif 🦎" else "Passer à Premium",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                if (plan == "premium")
                    "Tu peux publier des pages payantes, lancer des lives et personnaliser ton espace."
                else
                    "Débloque ton espace abonné : pages payantes (markdown, galerie, lien, fichier), lives, custom buttons.",
                style = MaterialTheme.typography.bodyMedium,
            )
            if (plan != "premium") {
                Button(onClick = onUpgrade, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text(priceLabel?.let { "S'abonner · $it / mois" } ?: "S'abonner")
                }
            }
        }
    }
}

@Composable
private fun SpaceSettingsCard(
    space: OwnerSpaceDto,
    onUpdatePrice: (Int, String) -> Unit,
    onUpdateSpaceIntro: (String) -> Unit,
    onUpdateProfileIntro: (String) -> Unit,
    onUpdateBenefits: (SpaceBenefitsDto) -> Unit,
) {
    var priceEuros by remember(space.priceCents) { mutableStateOf((space.priceCents / 100.0).toString()) }
    var spaceIntro by remember(space.introMd) { mutableStateOf(space.introMd) }
    var profileIntro by remember(space.profileIntroMd) { mutableStateOf(space.profileIntroMd) }
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Mon espace", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)

            Text("Tarif mensuel (${space.currency.uppercase()})", style = MaterialTheme.typography.labelLarge)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = priceEuros,
                    onValueChange = { priceEuros = it.filter { ch -> ch.isDigit() || ch == '.' || ch == ',' } },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    suffix = { Text(space.currency.uppercase()) },
                )
                Button(onClick = {
                    val cents = priceEuros.replace(',', '.').toDoubleOrNull()?.let { (it * 100).toInt() }
                    if (cents != null) onUpdatePrice(cents, space.currency)
                }) { Text("Mettre à jour") }
            }
            if (!space.active) {
                Text(
                    "Activation Stripe en attente — Connect onboarding requis.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Text("Intro de mon espace payant", style = MaterialTheme.typography.labelLarge)
            OutlinedTextField(
                value = spaceIntro,
                onValueChange = { if (it.length <= 4000) spaceIntro = it },
                modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp),
                placeholder = { Text("Markdown — décris ce que les abonnés débloquent.") },
                supportingText = { Text("${spaceIntro.length} / 4000") },
            )
            Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = { onUpdateSpaceIntro(spaceIntro) }) { Text("Enregistrer intro espace") }
            }

            Text("Intro publique de mon profil", style = MaterialTheme.typography.labelLarge)
            OutlinedTextField(
                value = profileIntro,
                onValueChange = { profileIntro = it },
                modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp),
                placeholder = { Text("Markdown — affiché sur /@${"<handle>"} (publique).") },
            )
            Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                TextButton(onClick = { onUpdateProfileIntro(profileIntro) }) { Text("Enregistrer intro profil") }
            }

            Text("Bénéfices abonnés", style = MaterialTheme.typography.labelLarge)
            BenefitsEditor(space.benefits, onUpdateBenefits)
        }
    }
}

@Composable
private fun BenefitsEditor(initial: SpaceBenefitsDto, onChange: (SpaceBenefitsDto) -> Unit) {
    var pages by remember(initial.pages) { mutableStateOf(initial.pages) }
    var chat by remember(initial.chat) { mutableStateOf(initial.chat) }
    var call by remember(initial.call) { mutableStateOf(initial.call) }
    var rdv by remember(initial.rdv) { mutableStateOf(initial.rdv) }
    var lives by remember(initial.lives) { mutableStateOf(initial.lives) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        BenefitToggle("Pages payantes", pages) { pages = it }
        BenefitToggle("Chat réservé aux abonnés", chat) { chat = it }
        BenefitToggle("Appels réservés aux abonnés", call) { call = it }
        BenefitToggle("Rendez-vous", rdv) { rdv = it }
        BenefitToggle("Lives", lives) { lives = it }
        TextButton(
            onClick = { onChange(SpaceBenefitsDto(chat = chat, call = call, pages = pages, rdv = rdv, lives = lives)) },
            modifier = Modifier.align(Alignment.End),
        ) { Text("Enregistrer bénéfices") }
    }
}

@Composable
private fun BenefitToggle(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f))
        Switch(checked = value, onCheckedChange = onChange)
    }
}

@Composable
private fun PageRow(page: PaidPageDto, onEdit: () -> Unit, onDelete: () -> Unit) {
    val icon = when (page.type) {
        "gallery" -> Icons.Default.PhotoLibrary
        "link" -> Icons.Default.Link
        "file" -> Icons.Default.Folder
        "markdown" -> Icons.Default.Description
        else -> Icons.Default.Article
    }
    ListItem(
        leadingContent = { Icon(icon, contentDescription = null) },
        headlineContent = { Text(page.title.ifBlank { "@${page.slug}" }) },
        supportingContent = {
            Text(
                buildString {
                    append(page.type)
                    if (!page.published) append(" · brouillon")
                },
                style = MaterialTheme.typography.bodySmall,
            )
        },
        trailingContent = {
            Row {
                IconButton(onClick = onEdit) { Icon(Icons.Default.Edit, contentDescription = "Modifier") }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, contentDescription = "Supprimer", tint = MaterialTheme.colorScheme.error)
                }
            }
        },
    )
}

/** Dialog d'édition d'une page premium — route vers l'éditeur typé selon `type`. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PageEditorDialog(
    page: PaidPageDto?,
    content: PaidPageContentDto?,
    onDismiss: () -> Unit,
    onSaveMarkdown: (slug: String, title: String, body: String, published: Boolean) -> Unit,
    onSaveLink: (slug: String, title: String, url: String, note: String, published: Boolean) -> Unit,
    onCreateEmptyMedia: (slug: String, title: String, type: String, published: Boolean) -> Unit,
    onUploadMedia: (slug: String, files: List<PremiumRepository.MediaUpload>) -> Unit,
    onDeleteMedia: (slug: String, filename: String) -> Unit,
) {
    val isNew = page == null
    var slug by remember { mutableStateOf(page?.slug.orEmpty()) }
    var title by remember { mutableStateOf(page?.title.orEmpty()) }
    var type by remember { mutableStateOf(page?.type ?: "markdown") }
    var published by remember { mutableStateOf(page?.published == true) }

    // États typés (initialisés depuis content si édition).
    var markdownBody by remember { mutableStateOf("") }
    var linkUrl by remember { mutableStateOf("") }
    var linkNote by remember { mutableStateOf("") }
    // Pour gallery/file : on lit content.content (JSON sérialisé serveur) une fois reçu.
    val galleryItems = remember { mutableStateOf(emptyList<GalleryItem>()) }
    val fileItem = remember { mutableStateOf<FileItem?>(null) }

    val json = remember { Json { ignoreUnknownKeys = true } }

    LaunchedEffect(content) {
        val c = content ?: return@LaunchedEffect
        when (c.type) {
            "markdown" -> markdownBody = c.content.orEmpty()
            "link" -> runCatching {
                val o = json.parseToJsonElement(c.content.orEmpty()).jsonObject
                linkUrl = o["url"]?.jsonPrimitive?.content.orEmpty()
                linkNote = o["note"]?.jsonPrimitive?.content.orEmpty()
            }
            "gallery" -> runCatching {
                val items = json.parseToJsonElement(c.content.orEmpty()).jsonObject["items"]?.jsonArray
                    ?: JsonArray(emptyList())
                galleryItems.value = items.mapNotNull { it.parseGalleryItem() }
            }
            "file" -> runCatching {
                val o = json.parseToJsonElement(c.content.orEmpty()).jsonObject
                fileItem.value = FileItem(
                    url = o["url"]?.jsonPrimitive?.content.orEmpty(),
                    name = o["name"]?.jsonPrimitive?.content.orEmpty(),
                    size = o["size"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0,
                )
            }
        }
    }

    val context = LocalContext.current
    val galleryPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris: List<Uri> ->
        val files = uris.mapNotNull { uriToUpload(context, it) }
        if (files.isNotEmpty()) onUploadMedia(slug, files)
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        val u = uri ?: return@rememberLauncherForActivityResult
        val file = uriToUpload(context, u) ?: return@rememberLauncherForActivityResult
        onUploadMedia(slug, listOf(file))
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isNew) "Nouvelle page" else "Modifier la page") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Titre") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = slug,
                    onValueChange = { v -> slug = v.lowercase().filter { it.isLetterOrDigit() || it == '-' } },
                    label = { Text("Slug (url)") },
                    singleLine = true,
                    enabled = isNew,
                    supportingText = { Text("Lettres, chiffres, tirets. Figé après création.") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("Type", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    PAGE_TYPES.forEach { (key, label) ->
                        AssistChip(
                            onClick = { if (isNew) type = key },
                            label = { Text(label) },
                            enabled = isNew,
                        )
                    }
                }

                // Sub-éditeur selon le type.
                when (type) {
                    "markdown" -> OutlinedTextField(
                        value = markdownBody,
                        onValueChange = { markdownBody = it },
                        label = { Text("Contenu (markdown)") },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp),
                    )
                    "link" -> {
                        OutlinedTextField(
                            value = linkUrl,
                            onValueChange = { linkUrl = it },
                            label = { Text("URL (http/https)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        OutlinedTextField(
                            value = linkNote,
                            onValueChange = { linkNote = it },
                            label = { Text("Note (optionnelle)") },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp),
                        )
                    }
                    "gallery" -> {
                        if (isNew) {
                            Text(
                                "Crée la page, puis rouvre-la pour uploader des médias.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else if (content == null) {
                            Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator()
                            }
                        } else {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("${galleryItems.value.size} média(s)", modifier = Modifier.weight(1f))
                                OutlinedButton(onClick = { galleryPicker.launch("image/*") }) {
                                    Icon(Icons.Default.UploadFile, contentDescription = null)
                                    Text(" Ajouter")
                                }
                            }
                            galleryItems.value.forEach { item ->
                                ListItem(
                                    headlineContent = { Text(item.url, style = MaterialTheme.typography.bodySmall) },
                                    supportingContent = { Text(item.kind) },
                                    trailingContent = {
                                        IconButton(onClick = { onDeleteMedia(slug, item.url) }) {
                                            Icon(Icons.Default.Delete, contentDescription = "Supprimer", tint = MaterialTheme.colorScheme.error)
                                        }
                                    },
                                )
                            }
                        }
                    }
                    "file" -> {
                        if (isNew) {
                            Text(
                                "Crée la page, puis rouvre-la pour uploader le fichier.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        } else if (content == null) {
                            Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator()
                            }
                        } else {
                            val f = fileItem.value
                            if (f != null && f.url.isNotBlank()) {
                                ListItem(
                                    headlineContent = { Text(f.name.ifBlank { f.url }) },
                                    supportingContent = { Text("${f.size} octets") },
                                    trailingContent = {
                                        IconButton(onClick = { onDeleteMedia(slug, f.url) }) {
                                            Icon(Icons.Default.Delete, contentDescription = "Supprimer", tint = MaterialTheme.colorScheme.error)
                                        }
                                    },
                                )
                            } else {
                                Text("Aucun fichier — appuie sur Téléverser pour ajouter.")
                            }
                            OutlinedButton(onClick = { filePicker.launch("*/*") }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Default.UploadFile, contentDescription = null)
                                Text(" Téléverser un fichier")
                            }
                        }
                    }
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = published, onCheckedChange = { published = it })
                    Text("Publier", modifier = Modifier.padding(start = 4.dp))
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                when (type) {
                    "markdown" -> onSaveMarkdown(slug.trim(), title, markdownBody, published)
                    "link" -> onSaveLink(slug.trim(), title, linkUrl, linkNote, published)
                    "gallery", "file" -> {
                        if (isNew) onCreateEmptyMedia(slug.trim(), title, type, published)
                        else onSaveMarkdown(slug.trim(), title, "", published) // metadata-only save for media types
                    }
                }
            }) { Text(if (isNew) "Créer" else "Enregistrer") }
        },
        dismissButton = { OutlinedButton(onClick = onDismiss) { Text("Fermer") } },
    )
}

private data class GalleryItem(val url: String, val kind: String, val caption: String)
private data class FileItem(val url: String, val name: String, val size: Long)

private fun kotlinx.serialization.json.JsonElement.parseGalleryItem(): GalleryItem? = runCatching {
    val o = (this as JsonObject)
    GalleryItem(
        url = o["url"]?.jsonPrimitive?.content.orEmpty(),
        kind = o["kind"]?.jsonPrimitive?.content ?: "image",
        caption = o["caption"]?.jsonPrimitive?.content.orEmpty(),
    )
}.getOrNull()

private fun uriToUpload(ctx: Context, uri: Uri): PremiumRepository.MediaUpload? {
    val mime = ctx.contentResolver.getType(uri) ?: "application/octet-stream"
    var name = "fichier"
    runCatching {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.let { name = it }
        }
    }
    val bytes = runCatching { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
        ?: return null
    return PremiumRepository.MediaUpload(name = name, mime = mime, bytes = bytes)
}
