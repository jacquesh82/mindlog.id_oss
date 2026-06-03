package today.mindlog.id

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dagger.hilt.android.AndroidEntryPoint
import today.mindlog.id.core.datastore.SessionStore
import javax.inject.Inject

/**
 * Relance le service temps réel après un redémarrage de l'appareil, si une
 * session est enregistrée — sinon les notifications hors-app cesseraient au
 * premier reboot.
 */
@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {

    @Inject lateinit var sessionStore: SessionStore

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED || action == "android.intent.action.QUICKBOOT_POWERON") {
            if (sessionStore.accessKey() != null) {
                runCatching { RealtimeService.start(context) }
            }
        }
    }
}
