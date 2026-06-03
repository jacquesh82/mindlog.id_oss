package today.mindlog.id

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.AlarmManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import today.mindlog.id.core.data.NotificationsRepository
import today.mindlog.id.core.data.RealtimeRepository
import javax.inject.Inject
import kotlin.random.Random

/**
 * Service foreground qui maintient le flux temps réel ([RealtimeRepository]) et
 * transforme les événements `notif` du serveur en notifications système. Garde
 * aussi la connexion SSE vivante pour la livraison des appels entrants quand
 * l'app n'est pas au premier plan.
 */
@AndroidEntryPoint
class RealtimeService : Service() {

    @Inject lateinit var realtime: RealtimeRepository
    @Inject lateinit var notifications: NotificationsRepository
    // Injecté pour être instancié : son init collecte la signalisation d'appel
    // entrante (sinon, app jamais ouverte, aucun appel ne serait capté).
    @Inject lateinit var callManager: today.mindlog.id.feature.call.CallManager

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null

    override fun onCreate() {
        super.onCreate()
        createChannels()
        startForeground(SERVICE_ID, runningNotification(), foregroundType())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (job == null) {
            job = scope.launch {
                realtime.events.collect { ev ->
                    if (ev.event == "notif") handleNotif(ev.data)
                    if (ev.event == "notif" || ev.event == "message") {
                        runCatching { notifications.refreshBadges() }
                    }
                }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // L'app est balayée des récents → on programme une relance du service pour
    // continuer à recevoir messages et appels (Voie A : foreground durci).
    override fun onTaskRemoved(rootIntent: Intent?) {
        val restart = PendingIntent.getService(
            this, 1, Intent(applicationContext, RealtimeService::class.java),
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE,
        )
        val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + 2000, restart)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun handleNotif(data: String) {
        val o = runCatching { JSONObject(data) }.getOrNull() ?: return
        val type = o.optString("type")
        val text = o.optString("text").ifBlank { "Nouvelle notification" }
        val link = o.optString("link") // "/@handle" éventuel ("" si absent)
        val handle = link.substringAfter("/@", "").takeIf { it.isNotBlank() }

        val (channel, title) = when (type) {
            "message" -> CH_MESSAGES to "Message"
            "request" -> CH_SOCIAL to "Demande de RDV"
            "relation" -> CH_SOCIAL to "Relation"
            else -> CH_SOCIAL to "mindlog · id"
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (handle != null) {
                if (type == "message") putExtra(EXTRA_OPEN_CHAT, handle)
                else putExtra(EXTRA_OPEN_PROFILE, handle)
            }
        }
        val pending = PendingIntent.getActivity(
            this, Random.nextInt(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pending)
            .build()
        nm().notify(Random.nextInt(), notif)
    }

    private fun runningNotification(): Notification =
        NotificationCompat.Builder(this, CH_SERVICE)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("mindlog · id")
            .setContentText("Messagerie et appels actifs 🦎")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

    private fun foregroundType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        } else 0

    private fun createChannels() {
        val m = nm()
        m.createNotificationChannel(
            NotificationChannel(CH_SERVICE, "Service", NotificationManager.IMPORTANCE_MIN),
        )
        m.createNotificationChannel(
            NotificationChannel(CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH),
        )
        m.createNotificationChannel(
            NotificationChannel(CH_SOCIAL, "Relations & RDV", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    private fun nm() = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    companion object {
        private const val SERVICE_ID = 42
        private const val CH_SERVICE = "service"
        private const val CH_MESSAGES = "messages"
        private const val CH_SOCIAL = "social"
        const val EXTRA_OPEN_CHAT = "open_chat"
        const val EXTRA_OPEN_PROFILE = "open_profile"

        fun start(context: Context) {
            val intent = Intent(context, RealtimeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RealtimeService::class.java))
        }
    }
}
