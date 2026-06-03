# Dev en HTTPS — `https://id.mindlog.localhost`

Environnement de développement servi en HTTPS sous le nom `id.mindlog.localhost`,
pointant vers la machine de dev (`192.168.1.170`), accessible depuis le Linux et
depuis l'émulateur Android. La prod (`id.mindlog.today`) n'est pas affectée.

## Architecture

Comme en prod, le TLS est terminé par **Caddy** ; l'app reste en HTTP simple.

```
navigateur / app Android
        │  https://id.mindlog.localhost   (cert mkcert, CA locale de confiance)
        ▼
   Caddy (docker, :443)            ← docker-compose.dev.yml + Caddyfile.dev
        │  http://host:8787  (+ X-Forwarded-Proto: https → cookies Secure)
        ▼
   app  (npm run dev  ou  service `app` du docker-compose.yml)
```

## Mise en place (déjà faite)

1. **Certificat** (CA mkcert déjà installée dans le trust store Linux) :
   ```sh
   mkcert -cert-file certs/id.mindlog.localhost.pem \
          -key-file  certs/id.mindlog.localhost-key.pem \
          id.mindlog.localhost localhost 192.168.1.170 127.0.0.1 10.0.2.2
   ```
   `certs/` est gitignoré. Régénérer si la CA mkcert change.

2. **/etc/hosts (Linux)** : `192.168.1.170 id.mindlog.localhost`.
   (glibc résout déjà `*.localhost` vers le loopback sur la machine elle-même,
   ce qui joint Caddy puisque c'est la même machine — l'entrée est une ceinture
   de sécurité pour les outils qui consultent `/etc/hosts`.)

3. **.env** : `APP_URL=https://id.mindlog.localhost` (liens d'invitation, magic links).

4. **Android (debug)** : aucune manip sur l'émulateur. Le build debug
   - fait confiance à la CA mkcert via `app/src/debug/res/xml/network_security_config.xml`
     (CA empaquetée dans `app/src/debug/res/raw/mkcert_ca.pem`) ;
   - résout `id.mindlog.localhost → 192.168.1.170` via `mindlogDns` (core:network),
     car Android force sinon `*.localhost` vers 127.0.0.1.
   En release : HTTPS strict + CA système, résolveur standard. **Aucun impact prod.**

## Lancer

```sh
docker compose up -d db                       # Postgres
npm run dev                                    # app HTTP 8787  (ou: docker compose up -d app)
docker compose -f docker-compose.dev.yml up -d # Caddy TLS 443 → 8787
```

Puis : `https://id.mindlog.localhost` dans le navigateur. Côté Android (build
debug), choisir le serveur `id.mindlog.localhost` à l'onboarding.

## Vérifier

```sh
curl https://id.mindlog.localhost/                       # 200, TLS valide
adb logcat | grep -E "id.mindlog.localhost|SSE ouvert"   # 200 + "SSE ouvert (200)"
```

## Notes

- L'IP `192.168.1.170` est codée en dur dans `mindlogDns` et `Caddyfile`/cert SAN.
  Si l'IP LAN change, régénérer le cert et mettre à jour `mindlogDns`.
- Caddy joint l'hôte via `host.docker.internal` (mappé par `extra_hosts: host-gateway`).
