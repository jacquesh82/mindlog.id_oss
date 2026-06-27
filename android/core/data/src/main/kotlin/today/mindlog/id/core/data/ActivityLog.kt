package today.mindlog.id.core.data

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import today.mindlog.id.core.datastore.SessionStore
import javax.inject.Inject
import javax.inject.Singleton

/** Une entrée du journal d'actions local (échec d'appel, de chat, etc.). */
data class ActivityEntry(
    val at: Long,
    val kind: String,   // call | chat | live | relation | system
    val level: String,  // info | warn | error
    val text: String,
    val detail: String = "",
    val peer: String = "",
)

/**
 * Journal d'actions local, par handle (tampon circulaire de [MAX] entrées). Les
 * toasts sont éphémères ; ce journal conserve la raison détaillée des échecs
 * (appel, chat, live…). 100 % local à l'appareil — aucune synchro serveur.
 * Miroir Android de public/activity-log.js.
 */
@Singleton
class ActivityLog @Inject constructor(
    @ApplicationContext private val context: Context,
    private val sessionStore: SessionStore,
) {
    private val prefs by lazy {
        context.getSharedPreferences("mindlog_activity", Context.MODE_PRIVATE)
    }
    private val _entries = MutableStateFlow<List<ActivityEntry>>(emptyList())
    val entries: StateFlow<List<ActivityEntry>> = _entries.asStateFlow()

    init { reload() }

    private fun keyFor(): String {
        val h = sessionStore.session.value?.handle?.removePrefix("@")?.takeIf { it.isNotBlank() } ?: "_"
        return "log_$h"
    }

    /** Recharge depuis le disque pour le handle courant (login / ouverture d'écran). */
    fun reload() {
        _entries.value = read()
    }

    /** Ajoute une entrée (best-effort) et la persiste. */
    fun log(
        kind: String,
        level: String,
        text: String,
        detail: String = "",
        peer: String = "",
    ) {
        val entry = ActivityEntry(
            at = System.currentTimeMillis(),
            kind = kind,
            level = level,
            text = text,
            detail = detail,
            peer = peer.removePrefix("@"),
        )
        val next = (listOf(entry) + _entries.value).take(MAX)
        _entries.value = next
        write(next)
    }

    /** Vide le journal du handle courant. */
    fun clear() {
        _entries.value = emptyList()
        prefs.edit().remove(keyFor()).apply()
    }

    private fun read(): List<ActivityEntry> {
        val raw = prefs.getString(keyFor(), null) ?: return emptyList()
        return runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                ActivityEntry(
                    at = o.optLong("at"),
                    kind = o.optString("kind"),
                    level = o.optString("level"),
                    text = o.optString("text"),
                    detail = o.optString("detail"),
                    peer = o.optString("peer"),
                )
            }
        }.getOrDefault(emptyList())
    }

    private fun write(entries: List<ActivityEntry>) {
        val arr = JSONArray()
        entries.forEach { e ->
            arr.put(
                JSONObject()
                    .put("at", e.at)
                    .put("kind", e.kind)
                    .put("level", e.level)
                    .put("text", e.text)
                    .put("detail", e.detail)
                    .put("peer", e.peer),
            )
        }
        prefs.edit().putString(keyFor(), arr.toString()).apply()
    }

    private companion object { const val MAX = 80 }
}
