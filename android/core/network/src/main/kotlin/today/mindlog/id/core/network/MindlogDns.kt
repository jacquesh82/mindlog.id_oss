package today.mindlog.id.core.network

import okhttp3.Dns
import java.net.InetAddress

/**
 * Résolveur DNS partagé par tous les clients OkHttp de l'app (Retrofit + SSE).
 *
 * En build DEBUG, force `id.mindlog.localhost` vers l'IP LAN de la machine de
 * dev : Android (et l'émulateur) résout sinon tout `*.localhost` vers le
 * loopback 127.0.0.1 (RFC 6761), ce qui ne joindrait pas le serveur de dev.
 * En RELEASE : résolveur système standard.
 */
val mindlogDns: Dns
    get() = if (BuildConfig.DEBUG) {
        object : Dns {
            override fun lookup(hostname: String): List<InetAddress> =
                if (hostname.equals("id.mindlog.localhost", ignoreCase = true)) {
                    listOf(InetAddress.getByName("192.168.1.170"))
                } else {
                    Dns.SYSTEM.lookup(hostname)
                }
        }
    } else {
        Dns.SYSTEM
    }
