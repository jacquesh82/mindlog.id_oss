package today.mindlog.id.core.network

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import today.mindlog.id.core.datastore.ServerStore
import javax.inject.Inject

/**
 * Réécrit le schéma/hôte/port de chaque requête sortante vers le serveur choisi
 * par l'utilisateur (cf. [ServerStore]). La `baseUrl` figée de Retrofit ne sert
 * que de gabarit ; le chemin reste inchangé, seule la cible bouge. Permet de
 * pointer l'app vers id.mindlog.today (défaut) ou un serveur auto-hébergé.
 */
class ServerUrlInterceptor @Inject constructor(
    private val serverStore: ServerStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val base = serverStore.baseUrl().toHttpUrlOrNull() ?: return chain.proceed(chain.request())
        val req = chain.request()
        if (req.url.scheme == base.scheme && req.url.host == base.host && req.url.port == base.port) {
            return chain.proceed(req)
        }
        val newUrl = req.url.newBuilder()
            .scheme(base.scheme)
            .host(base.host)
            .port(base.port)
            .build()
        return chain.proceed(req.newBuilder().url(newUrl).build())
    }
}
