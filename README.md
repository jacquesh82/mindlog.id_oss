# id.mindlog.today

**Reprenez la main sur votre identité.** Carte d'identité en ligne souveraine :
page publique, agenda & disponibilités, prise de RDV, réseau de relations, **messagerie
et appels chiffrés de bout en bout**, et pilotage par IA via **MCP** — le tout
**hébergé en France**, **open source (AGPLv3)** et **sans pistage**.

Application **multi-identités** : chacun crée sa page (`/@handle`), la modifie via un
lien privé protégé par clé, et peut être recherché. SPA mono-page (un seul HTML,
routeur JS) **multilingue (7 langues)**, backend Hono, stockage **PostgreSQL** (via
Drizzle ORM ; migrations appliquées automatiquement au démarrage). **Clients : web +
application Android native** (iOS / desktop à venir).

> **Souveraineté** — contrairement aux acteurs du segment (link-in-bio type Linktree,
> messageries type WhatsApp), mindlog combine identité tout-en-un, chiffrement E2E
> (le serveur ne lit jamais vos messages), hébergement en France et code ouvert.
> Voir le comparatif sur la landing et la page **[Tarifs & licence](https://id.mindlog.today/pricing)**.

## Fonctionnalités

- **Landing** (`/`) — présentation, recherche d'une personne (live), création de page.
- **Carte ID** — attributs de base (nom, fonction, bio, email, lieu, site, téléphone)
  + attributs **custom** ; chaque attribut a un drapeau public/privé.
- **Photo** de profil (jpg/png/webp/gif ≤ 5 Mo).
- **Agenda** — événements datés, publics ou privés (les privés restent cachés du public).
- **Disponibilités** — calendrier par jour : **règle générale configurable** (jours de
  semaine libres au choix, bascule week-end, **périodes** datées on/off), libre en semaine
  et occupé le week-end **par défaut**, exceptions cliquables jour par jour. Les visiteurs
  demandent un RDV sur un jour libre.
- **Créneaux horaires** — plage de travail (début/fin) et **finesse réglable
  (15 / 30 / 60 min)** ; les visiteurs choisissent un créneau libre du jour (les créneaux
  des RDV acceptés sont grisés).
- **Demandes de RDV** — laissées par les visiteurs (nom/email/message, **jour + créneau**),
  gérées par le propriétaire (accepter / refuser / supprimer). On ne peut pas se demander
  un RDV à soi-même.
- **Options (préférences)** — onglet dédié de la carte Identité : autoriser/couper la
  **messagerie**, les **appels**, la **vidéo**, les **demandes de RDV**, et rendre ses
  **disponibilités publiques ou privées**. Appliqué côté serveur **et** MCP (pas seulement
  masquage UI).
- **Visibilité par attribut, 3 niveaux** — **Public / Contact / Privé**. « Contact » n'est
  visible que par un **contact réciproque** (relation validée des deux côtés).
- **Relations** (1 à 3 degrés) — graphe entre identités, lien typé **ami / pro / autre**
  (ami par défaut). Degré 1 déclaré ; degrés 2-3 calculés (graphe non-orienté), avec
  indication de l'intermédiaire (**via @qui**). « Ajouter à mes relations » depuis une
  fiche, avec notification email du destinataire.
- **Conversation éphémère** — entre deux contacts réciproques uniquement : messages
  **chiffrés de bout en bout** (le serveur ne stocke que des blobs opaques `iv`+`ciphertext`
  et n'a ni le clair ni les clés privées) et **expirant** (TTL 24 h), purgés automatiquement.
  **Réactions emoji**, accusés de **réception/lecture**, suppression par l'émetteur.
- **Forward secrecy (Double Ratchet)** — chiffrement par **X3DH + Double Ratchet** (P-256 /
  HKDF / HMAC / AES-GCM), avec **forward secrecy** et **post-compromise security** : une clé
  compromise ne déchiffre ni le passé ni le futur. Bundles de prekeys publics ; état du ratchet
  100 % client. Repli automatique sur l'ancien schéma ECDH pour les contacts non migrés.
- **Vérification d'identité (anti-MITM)** — **numéro de sécurité** façon Signal (60 chiffres,
  dérivé des deux clés d'identité), comparable de visu ou par **QR** (scan sur mobile). Statut
  « vérifié » synchronisé, badge **✓ vérifié / ⚠️ clé changée**.
- **Pièces jointes & messages vocaux chiffrés** — images, fichiers et **notes vocales** chiffrés
  côté client (clé AES aléatoire par fichier), relayés en blobs opaques, mêmes TTL 24 h.
- **Minuterie de disparition configurable** — par conversation (24 h → 5 min), partagée via un
  message de contrôle chiffré, bornée au TTL max serveur.
- **Messages à lecture unique** — cache « 👁 toucher pour voir » ; le message est **supprimé**
  (burn) côté serveur après révélation par le destinataire.
- **Contact sans annuaire** — ajout par **invitation directe** (QR / lien à usage unique
  `/i/<token>`), sans recherche dans l'annuaire ; relation **mutuelle** créée à l'acceptation.
  La conversation s'ouvre comme une **colonne fermable** du deck, à droite du profil.
- **Conversations de groupe chiffrées (sender keys)** — groupes E2E façon megolm : chaîne
  symétrique + **signature ECDSA P-256** par message (anti-forge), clé d'expéditeur distribuée
  via le canal 1‑à‑1 Double Ratchet. Le serveur ne connaît que l'**appartenance** (métadonnée) ;
  les messages restent **éphémères** (TTL 24 h, blobs opaques). Admin = créateur (ajoute/retire),
  **rotation de clé** au retrait. Web + Android (interop crypto par vecteurs partagés).
- **Coffre de clé E2E multi-appareil** — la clé privée ECDH est **portable** : sauvegardée
  chiffrée côté serveur (déverrouillable par **passphrase** ou **passkey PRF**, jamais lisible
  par le serveur), elle se **restaure à l'identique** sur un autre appareil/navigateur. Chaque
  message **fige les clés publiques** émetteur/destinataire à l'envoi (l'historique reste
  lisible après rotation), et l'UI **invite à sauvegarder** la clé tant qu'elle n'est pas dans
  le coffre.
- **Souveraineté** — section dédiée de la landing : piliers (hébergé en France, E2E,
  open source AGPLv3, zéro pistage) et **comparatif** mindlog vs concurrents (« type
  Linktree » et « type WhatsApp »).
- **Multilingue** — interface traduite en **7 langues** (fr, en, es, de, it, pt, nl).
- **Appels audio/vidéo P2P** — entre contacts réciproques : **pair-à-pair (WebRTC)**, le
  média audio/vidéo circule **directement de navigateur à navigateur** et ne transite
  jamais par le serveur (qui ne relaie que la signalisation, chiffrée de bout en bout).
  Soumis aux préférences (appels / vidéo) du correspondant.
- **Temps réel** — flux **SSE** (`/api/events`) par identité : notifications et nouveaux
  messages poussés en direct, sans rafraîchir la page.
- **URL publique** `/@handle` (lecture seule) et **URL privée** `/k/<clé>` (éditeur) —
  toutes deux en **deck horizontal** navigable à la **molette**, animé avec GSAP.
- **QR code** — généré côté client (page publique et éditeur) ; scanné, il ouvre
  `/@handle` — la carte de visite numérique.
- **Récupération de compte** — email optionnel à la création ; en cas de perte de clé,
  handle + email régénèrent une nouvelle clé.
- **Clé mémorisée** — la clé d'accès peut être stockée dans le navigateur (localStorage)
  pour revenir à son espace sans l'URL complète.
- **Mascotte Milo** — caméléon fixe (coin), œil qui suit la souris, bulles BD, et une
  palette d'accentuation persistée (dont un mode « caméléon » animé). Clic → `/@milo`.
- **Page statut** — `/status` : état des services + quelques chiffres (`GET /api/status`).

## Clients

- **Web** — SPA servie par le serveur (landing, page publique `/@handle`, éditeur `/k/<clé>`),
  multilingue, thème clair/sombre.
- **Android** (`android/`) — **application native Kotlin / Jetpack Compose**, architecture
  multi-module (MVVM, Hilt, Room offline-first). Modules : `card`, `agenda`, `relations`,
  `requests`, `chat`, `call`, `notifications`, `onboarding`. Reprend le **chiffrement E2E**
  (ECDH P‑256 / AES‑GCM, interopérable avec le client web), les **appels WebRTC**, le **temps
  réel** (SSE + notifications système) et le **coffre de clé**. Build CI (APK debug) via GitHub
  Actions (`.github/workflows/android.yml`).
- **iOS / desktop** — *à venir* (annoncés « très prochainement » sur la landing).

## Démarrage

**La méthode recommandée est Docker Compose** : il lance PostgreSQL **et**
l'application ensemble (les migrations Drizzle s'appliquent au démarrage).

```bash
docker compose up -d --build
# → http://localhost:8787   (Postgres exposé sur localhost:5432)
```

Pour le développement local (avec rechargement auto), démarrez juste la base via
Compose puis l'app en local :

```bash
docker compose up -d db        # Postgres seul (port 5432)
npm install
npm run dev                    # tsx watch — lit DATABASE_URL depuis .env
```

- `/` — landing (recherche + création).
- `/@handle` — page publique.
- `/k/<clé>` — éditeur (clé affichée à la création, à conserver).

Variables d'env : `DATABASE_URL` (Postgres, **requis**), `PORT`, `APP_URL`, et les
variables SMTP (voir `.env.example`).

### Base de données

```bash
npm run db:generate          # génère une migration SQL après modif de src/schema.ts
npm run db:migrate           # applique les migrations en attente
npm run db:reset             # vide les données (schéma conservé)
npm run db:migrate-from-sqlite [chemin.db]   # importe une ancienne base SQLite
```

## Tests

```bash
npm test        # cœur métier (node:test) sur PGlite — Postgres en mémoire (WASM)
npm run typecheck
```

## Docker

`docker compose up -d --build` suffit : le service `db` (Postgres) démarre en
premier (healthcheck), puis `mindlog` s'y connecte via `DATABASE_URL`.

> **Persistance** : les données vivent dans le volume `mindlog-pgdata`
> (PostgreSQL) ; les **fichiers** (photos, galerie) dans `mindlog-data`
> (`/app/data`). Le schéma est versionné par les migrations Drizzle (`drizzle/`),
> appliquées automatiquement au démarrage — pas besoin de supprimer la base lors
> d'une mise à jour.

## API (extrait)

| Méthode | Route | Auth | Rôle |
|--------|-------|------|------|
| POST | `/api/identities` | — | Créer une identité (`handle`, `display_name?`, `email?`) |
| POST | `/api/recover` | — | Récupérer la clé via `handle` + `email` |
| GET | `/api/search?q=` | — | Recherche d'identités |
| GET | `/api/identities/:handle` | — | Carte publique |
| GET | `/api/identities/:handle/photo` | — | Photo |
| GET | `/api/identities/:handle/slots?day=` | — | Créneaux horaires d'un jour |
| POST | `/api/identities/:handle/requests` | — | Demande de RDV (visiteur, `day?`+`time?`) |
| GET | `/api/me` | ✓ | Carte privée complète (dont `settings`) |
| PATCH | `/api/me/settings` | ✓ | Préférences (Options) : autorisations + `availability` |
| PUT | `/api/card/field` · DELETE `/api/card/field/:key` | ✓ | Attributs |
| POST | `/api/agenda` · DELETE `/api/agenda/:id` | ✓ | Événements |
| PUT | `/api/availability/:day` | ✓ | Exception d'un jour (`free`/`busy`) |
| PATCH/DELETE | `/api/requests/:id` | ✓ | Gérer une demande de RDV |
| POST | `/api/relations` · DELETE `/api/relations/:handle` | ✓ | Relations (avec `type`) |
| GET | `/api/events` | ✓ | Flux SSE temps réel (notifications + messages) |
| POST | `/api/notifications/read` | ✓ | Marquer les notifications comme lues |
| PUT | `/api/pubkey` | ✓ | Publier sa clé publique (ECDH) |
| GET/POST | `/api/messages/:handle` | ✓ | Lire / envoyer un message chiffré (contact) |
| POST | `/api/messages/:handle/ack` · `/react` | ✓ | Accusé réception-lecture · réaction emoji |
| DELETE | `/api/messages/:handle/:id` | ✓ | Supprimer un de ses messages |
| POST | `/api/messages/:handle/:id/burn` | ✓ | Brûler un message à lecture unique (destinataire) |
| PUT/GET | `/api/e2e/prekeys[/:handle][/count]` | ✓ | Bundle de prekeys X3DH (forward secrecy) |
| PUT/GET/DELETE | `/api/e2e/verify/:handle` | ✓ | Statut de vérification d'identité (anti-MITM) |
| POST/GET | `/api/attachments/:handle[/:id]` | ✓ | Pièce jointe / message vocal chiffré (blob opaque) |
| POST/GET | `/api/invites[/:token][/accept]` | mixte | Invitation de contact (QR/lien, sans annuaire) |
| POST/GET | `/api/groups[/:id]` | ✓ | Créer / lister / détailler un groupe (sender keys) |
| POST/DELETE | `/api/groups/:id/members[/:handle]` · POST `/leave` | ✓ | Membres (admin) · quitter |
| GET/POST | `/api/groups/:id/messages` | ✓ | Lire / envoyer un message de groupe chiffré |
| GET/PUT/DELETE | `/api/e2e/vault` | ✓ | Coffre de clé E2E portable (opaque) |
| POST | `/api/photo` · POST `/api/access-key/rotate` · PUT `/api/recovery-email` | ✓ | Photo / clé / email |

Auth : en-tête `x-access-key: <clé>` ou paramètre `?key=<clé>`.

## Serveur MCP

Un serveur MCP **cloud**, HTTP Streamable, authentifié et scopé à une identité, servi
sur `POST /mcp` par le serveur HTTP (**base PostgreSQL partagée** via `DATABASE_URL` ;
PGlite en mémoire pour les tests).

### Cloud — HTTP Streamable, **authentifié et scopé** (`POST /mcp`)

Pour les connecteurs Claude / ChatGPT / Cursor. Authentification **OAuth 2.1** (voie
standard) ou clé d'accès brute (repli). Le token identifie le compte ; **toutes les
écritures portent sur ce compte** — aucun accès en écriture aux autres identités. Les
garde-fous HTTP (rate-limit, limite de corps, CORS) s'appliquent. Code : `src/mcp-cloud.ts`.

**OAuth 2.1** (`src/oauth.ts`, `src/oauth-routes.ts`) — mindlog est à la fois serveur
d'autorisation (AS) et serveur de ressources (RS) :

- Découverte : `/.well-known/oauth-protected-resource` (RFC 9728) →
  `/.well-known/oauth-authorization-server` (RFC 8414).
- Enregistrement dynamique de client : `POST /oauth/register` (RFC 7591).
- Code + PKCE **S256** obligatoire : `GET /oauth/authorize` (consentement, l'utilisateur
  s'authentifie par **clé d'accès** ou **passkey** — jamais transmises au connecteur) →
  `POST /oauth/token`. Refresh tokens rotatifs, révocation via `/oauth/revoke`.
- **Purge** : une tâche horaire (`runMaintenance` dans `src/server.ts`) supprime les
  codes/tokens OAuth, sessions et messages éphémères expirés.

Les connecteurs récents (Claude, ChatGPT) découvrent et enregistrent tout
automatiquement : il suffit de fournir l'URL `https://id.mindlog.today/mcp`. Config
manuelle par clé d'accès (sans OAuth), toujours supportée :

```json
{
  "mcpServers": {
    "mindlog-id": {
      "url": "https://id.mindlog.today/mcp",
      "headers": { "Authorization": "Bearer VOTRE_CLÉ_D_ACCÈS" }
    }
  }
}
```

**29 outils scopés** : `whoami`, `get_my_card`, `set_card_field`, `delete_card_field`,
`list_tags`, `add_tag`, `remove_tag`, `search_identities`, `get_card` *(autrui,
visibilité respectée)*, `list_events`, `add_event`, `delete_event`, `get_availability` *(la mienne
ou celle d'autrui — règle de dispo + prochains jours libres ; respecte la préférence
« disponibilités publiques »)*, `get_day_slots` *(créneaux horaires d'un jour)*,
`set_availability` *(régler jours libres, plage horaire, finesse 15/30/60 min)*,
`set_day_status`, `request_meeting` *(demander un RDV à autrui, avec créneau `time` ;
respecte la préférence « demandes de RDV »)*, `list_requests`,
`respond_request`, `delete_request`, `list_relations`,
`list_incoming_relations`, `add_relation`, `remove_relation`, `list_notifications`,
`mark_notifications_read`, `set_recovery_email`, `rotate_access_key`, `delete_account`.

> **Non exposé par MCP** (volontaire) : messagerie E2E (chiffrée côté client), galerie,
> photo de profil, passkeys/sessions.

## Sécurité — limites connues

- La récupération par email **affiche la nouvelle clé à l'écran** (pas de serveur
  mail). L'email est donc le seul facteur secret. En production, il faudrait envoyer
  un lien de réinitialisation par email plutôt que de retourner la clé.
- **MCP cloud (`/mcp`)** : authentifié par clé d'accès (Bearer), scopé à un seul
  compte, rate-limité — exposable publiquement. La rotation de clé via le connecteur
  invalide aussitôt la clé courante (à reconfigurer).

## Licence

Double licence :

- **AGPLv3** — usage, modification, redistribution et **auto-hébergement libres**, sous
  les obligations de l'AGPLv3 (publication du code source correspondant, **y compris pour
  un service exposé en réseau** — §13).
- **Licence commerciale** — pour un usage **propriétaire / fermé** ou une offre **SaaS**
  sans publier vos modifications. Détails et contact : page **[Tarifs & licence](https://id.mindlog.today/pricing)**
  ou `milo@mindlog.today`.

🦎 Une création de [le-lab.net](https://le-lab.net).
