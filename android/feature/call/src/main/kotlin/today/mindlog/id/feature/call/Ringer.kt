package today.mindlog.id.feature.call

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.ToneGenerator
import java.util.Timer
import java.util.TimerTask

/**
 * Sonnerie d'appel entrant : MP3 bouclé (res/raw/call_ring), repli ToneGenerator
 * si la lecture échoue. Le drapeau [stopped] empêche le repli de redémarrer après
 * un stop() (parité avec le fix `stopped` de makeRinger() côté web).
 */
class Ringer(private val context: Context) {
    private var player: MediaPlayer? = null
    private var tone: ToneGenerator? = null
    private var toneTimer: Timer? = null
    @Volatile private var stopped = true

    fun start() {
        if (player != null || tone != null) return
        stopped = false
        try {
            val mp = MediaPlayer.create(context, R.raw.call_ring) ?: throw IllegalStateException("ringtone KO")
            mp.isLooping = true
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            mp.setOnErrorListener { _, _, _ -> if (!stopped) startToneFallback(); true }
            mp.start()
            player = mp
        } catch (_: Throwable) {
            if (!stopped) startToneFallback()
        }
    }

    private fun startToneFallback() {
        if (stopped || tone != null) return
        try {
            val tg = ToneGenerator(AudioManager.STREAM_RING, 80)
            tone = tg
            val timer = Timer()
            timer.scheduleAtFixedRate(object : TimerTask() {
                override fun run() {
                    if (stopped) return
                    runCatching { tg.startTone(ToneGenerator.TONE_SUP_RINGTONE, 1000) }
                }
            }, 0L, 1800L)
            toneTimer = timer
        } catch (_: Throwable) {
            // repli indisponible : on reste silencieux (la notif vibre déjà).
        }
    }

    fun stop() {
        stopped = true
        runCatching { player?.stop(); player?.release() }
        player = null
        toneTimer?.cancel()
        toneTimer = null
        runCatching { tone?.release() }
        tone = null
    }
}
