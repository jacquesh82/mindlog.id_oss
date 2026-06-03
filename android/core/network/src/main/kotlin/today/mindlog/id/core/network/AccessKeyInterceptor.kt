package today.mindlog.id.core.network

import okhttp3.Interceptor
import okhttp3.Response
import today.mindlog.id.core.datastore.SessionStore
import javax.inject.Inject

/**
 * Ajoute l'en-tête `x-access-key` à chaque requête sortante si une clé est
 * stockée. C'est l'unique mécanisme d'auth de l'app (cf. src/server.ts:249 du
 * backend : `currentIdentity` accepte `x-access-key`). Pas de cookie, donc pas
 * de contrôle CSRF same-origin à satisfaire.
 */
class AccessKeyInterceptor @Inject constructor(
    private val sessionStore: SessionStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val key = sessionStore.accessKey()
            ?: return chain.proceed(chain.request())
        val request = chain.request().newBuilder()
            .header("x-access-key", key)
            // Multi-appareils : identifie l'appareil courant (lecture des enveloppes
            // fan-out qui lui sont destinées + attribution de l'appareil émetteur).
            .header("x-device-id", sessionStore.deviceId())
            .build()
        return chain.proceed(request)
    }
}
