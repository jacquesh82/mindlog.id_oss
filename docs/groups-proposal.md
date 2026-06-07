# Protocole — Messagerie de groupe E2E (sender keys)

Statut : **conception arrêtée** (cf. §0). Objectif : permettre des conversations à
plusieurs, **chiffrées de bout en bout**, en gardant autant que possible le modèle
actuel : **messages éphémères** (blobs opaques, TTL 24 h) et **serveur qui ne voit
jamais le contenu ni les clés**.

## 0. Décisions arrêtées (2026-06-07)

| Question | Décision |
|---|---|
| Crypto | **Sender Keys** (megolm-like). On accepte la PCS réduite et la rotation à chaque membership change. Pas de fan-out pairwise même pour petits groupes : on vise la cohérence avec un protocole unique. |
| Persistance | **Option M** — table d'appartenance serveur, messages éphémères TTL 24 h, contenu jamais lu. |
| Membership | **Owner unique + admins**. Owner = créateur, permanent tant que le groupe existe (peut nommer/révoquer des admins, transfert d'owner via action explicite). Admins ajoutent/retirent membres. Membres simples : envoi + quitter. |
| Source contacts | **Relations existantes + recherche par handle**. Pas d'import carnet pour V1. |
| Périmètre | **OSS** — feature de base, comme le chat 1:1. Parité tous clients (web, Android, MCP). |
| Taille max | **128 membres** (limite molle V1, anti-abus du fan-out SKDM ; configurable côté serveur). |
| Multi-appareil | Le roster/sender key vivent **par appareil** (comme les ratchets 1:1). Les SKDM sont fan-outés par (member × device) via les ratchets existants. Pas de stockage du roster dans le coffre E2E pour V1. |

## 1. Choix cryptographique : sender keys (façon « megolm » / Signal group v1)

Au lieu de chiffrer chaque message une fois par destinataire (fan‑out *pairwise*, coûteux
en O(N) chiffrements), chaque membre possède une **clé d'expéditeur** par groupe :

- **Sender Key (SK_m)** d'un membre m = une **chaîne symétrique** `chainKey` (ratchet
  symétrique : `mk_i = HMAC(chainKey_i, 0x01)`, `chainKey_{i+1} = HMAC(chainKey_i, 0x02)`,
  exactement nos `KDF_CK`/`KDF_MK` du Double Ratchet) **+ une paire de clés de signature**
  ECDSA P‑256 (dédiée, distincte de la clé d'identité ECDH).
- m chiffre **une seule fois** un message de groupe avec `mk_i` (AES‑GCM), le **signe** avec
  sa clé de signature de groupe, puis le même blob est relayé à tous les membres.
- Chaque membre, ayant reçu `SK_m` au préalable, dérive `mk_i` (en avançant la chaîne) et
  déchiffre ; il vérifie la **signature** pour garantir que c'est bien m qui a écrit (sinon
  un membre pourrait forger un message au nom d'un autre, puisque les clés de chaîne sont
  partagées — c'est la raison des signatures dans megolm).

**Distribution des sender keys (SKDM)** : quand m crée/rejoint le groupe ou tourne sa clé,
il envoie `{ groupId, chainKey, iter, sigPubKey }` à **chaque autre membre via le canal
1‑à‑1 Double Ratchet déjà en place** (donc E2E + authentifié + forward secrecy). Le serveur
ne voit que des blobs pairwise opaques — rien de neuf pour lui.

> Pourquoi ECDSA P‑256 et pas Ed25519 : cohérence/compatibilité WebCrypto ↔ JCA (même
> raison que pour le reste du projet). La clé d'identité étant ECDH‑only, on génère une
> **clé de signature dédiée par membre et par groupe**.

## 2. Propriétés de sécurité (et limites assumées)

- **Confidentialité E2E** : le serveur ne voit que des blobs + (selon option) la liste des
  membres. Jamais le contenu ni les clés.
- **Forward secrecy** : oui, au sein de la chaîne (la chaîne avance, les anciennes `mk`
  sont jetées).
- **Post‑compromise security : RÉDUITE** vs le 1‑à‑1. Une `chainKey` fuitée permet de lire
  les messages **futurs** de cet expéditeur jusqu'à **rotation**. C'est le compromis
  classique des sender keys. On le compense par **rotation à chaque changement d'effectif**
  (cf. §5) et, optionnellement, rotation périodique.
- **Authenticité** : assurée par la signature ECDSA par message (anti‑forge entre membres).
- **Métadonnées** : selon l'option de persistance, le serveur connaît l'appartenance au
  groupe (qui parle à qui). Le contenu reste opaque.

## 3. Persistance : la vraie question

Un groupe a besoin d'un **état d'appartenance** (qui est membre). Or la roadmap classe la
persistance durable hors périmètre. Deux options :

### Option Z — zéro persistance serveur (fidèle stricte à la contrainte)
- Le **roster** (groupId, membres, sender keys des autres, ma sender key) vit **uniquement
  côté client** (IndexedDB web / RatchetStore Android), propagé de client à client par
  messages de contrôle 1‑à‑1.
- Le serveur relaie des blobs **pairwise tagués `group_id`** : envoyer = uploader le même
  blob signé à chaque membre (fan‑out **client**, O(N) uploads, 1 seul chiffrement grâce
  aux sender keys). Autorisation = check **contact réciproque** existant (`areContacts`).
  Aucune table de groupe, aucun ACL de groupe.
- **Limites** : pas de source de vérité d'appartenance → consensus best‑effort (split‑brain
  possible) ; **pas de continuité multi‑appareil** (le roster est local, le coffre ne
  restaure que la clé d'identité) ; un nouvel appareil « perd » ses groupes.

### Option M — persistance MINIMALE d'appartenance (recommandée)
- Une petite table serveur `groups` { `id`, `name?`, `created_at` } + `group_members`
  { `group_id`, `identity_id`, `role` }. **Pas d'historique de messages** : les messages
  restent éphémères (TTL 24 h) comme aujourd'hui. C'est une exception *de même nature* que
  les tables déjà acceptées (`e2e_prekeys`, `e2e_verifications`, `invites`) : du métadonnée,
  jamais de contenu.
- Avantages : autorité d'appartenance (ajout/retrait fiables), **fan‑out côté serveur**
  (un POST → diffusion aux membres + SSE), continuité multi‑appareil possible, retrait propre.
- Le contenu reste **E2E** (sender keys) ; le serveur ne gagne que la liste des membres
  (métadonnée), cohérent avec « le serveur ne lit jamais vos messages ».

**Recommandation : Option M.** Elle respecte l'esprit (« messages éphémères + contenu E2E »)
tout en rendant les groupes robustes. L'Option Z reste possible si on veut zéro métadonnée
serveur, au prix de la fragilité multi‑appareil / consensus.

## 4. Modèle de données (Option M)

Serveur (migration) :
- `groups` : `id` (uuid), `name` text, `created_at`.
- `group_members` : `group_id` FK, `identity_id` FK, `role` (`admin`|`member`), `joined_at`,
  PK(group_id, identity_id).
- `messages` : ajouter `group_id` text nullable (un message de groupe est stocké **une fois**,
  clé de conversation = `group_id` au lieu de `pair`), TTL 24 h inchangé. (Variante Option Z :
  `group_id` + relais pairwise, une ligne par destinataire.)

Client (local, par groupe) :
- ma `SK` (chainKey + iter + clé de signature **privée**), les `SK` des autres
  (chainKey + iter + clé de signature **publique**), store des `mk` sautées (hors‑ordre,
  borné comme le ratchet).

## 5. Flux

- **Créer** : créateur choisit des **contacts réciproques**, `POST /api/groups` { name,
  members[] } → `group_id`. Génère sa `SK`, envoie un **SKDM** à chaque membre via le 1‑à‑1.
- **Envoyer** : avance la chaîne → `mk`, AES‑GCM, signe ; `POST /api/groups/:id/message`
  { iv, ciphertext, sig, iter, senderSigKeyId }. Serveur valide l'appartenance, stocke
  (TTL 24 h), `publish` SSE à chaque membre.
- **Recevoir** : `GET /api/groups/:id/messages` ; pour chaque message, vérifier la signature
  avec la clé publique de signature de l'expéditeur, dériver `mk` à `iter` (gérer le saut),
  déchiffrer. Repli « indéchiffrable » si SKDM manquant.
- **Rejoindre (nouvel arrivant)** : pas d'historique (éphémère). Les membres existants lui
  envoient leur `SK` courante (SKDM) ; lui envoie la sienne à tous.
- **Retirer un membre** : `DELETE /api/groups/:id/members/:handle` (admin) → **tous les
  membres restants tournent leur `SK`** (nouvelle chainKey + nouvelle clé de signature) et
  rediffusent un SKDM aux seuls restants → l'exclu ne peut plus déchiffrer la suite.
- **Quitter** : se retire soi‑même ; les autres tournent.

## 6. Réutilisation de l'existant

- **SKDM** = un message de contrôle (sentinelle façon `att`/`tmr`) transporté par
  `ratchetSend`/`ratchetDecrypt` (1‑à‑1) → distribution des sender keys E2E + authentifiée,
  zéro nouveau canal.
- **KDF_CK / KDF_MK** : déjà dans `src/ratchet.ts` (et portages) → la chaîne d'expéditeur
  réutilise exactement ces primitives.
- **AES‑GCM brut + base64** : `gcmEncryptRaw`/`gcmDecryptRaw` (web + Android) déjà là.
- **SSE** `publish`/`subscribe` (src/realtime.ts) pour le temps réel par membre.
- **Pattern tables minimales** : `groups`/`group_members` suivent `e2e_prekeys` / `invites`.
- **UI** : la colonne de chat (web `chat.js`, Android `feature:chat`) se généralise à un
  `conversationId` (pair *ou* group) ; le rendu/threading par `group_id` ; liste de groupes
  dans « Réseau ».
- **Signatures** : ECDSA P‑256 via `crypto.subtle` (web) / `Signature("SHA256withECDSA")` (JCA).

## 7. Alternative plus simple (à connaître)

Pour de **petits groupes** (cercles restreints, cohérent avec le produit), le **fan‑out
pairwise** sans sender keys est plus simple et plus sûr (full PCS par paire) : on chiffre le
message une fois **par destinataire** avec le Double Ratchet 1‑à‑1 existant, et on l'envoie à
chacun. Coût O(N) chiffrements/message — négligeable pour N petit. **Aucune** nouvelle crypto.
Les sender keys ne deviennent gagnantes (1 chiffrement au lieu de N) qu'à plus grand N.
→ Si l'usage cible est ≤ ~10 personnes, je recommanderais d'**envisager d'abord le fan‑out
pairwise** ; les sender keys si on vise des groupes plus larges.

## 8. Plan de mise en œuvre (Option M + sender keys), par phases

1. **Crypto cœur** : module `groupSender` (TS réf. + portage) — chainKey ratchet symétrique,
   signature ECDSA, SKDM encode/decode ; **vecteurs partagés** (comme `ratchet.json`) pour
   l'interop web/Android.
2. **Serveur** : tables `groups`/`group_members` + colonne `messages.group_id` ; routes
   create/list/addMember/removeMember/leave + POST/GET messages de groupe (gardées par
   appartenance) ; prune inchangé ; tests.
3. **Web** : distribution SKDM via le ratchet, état de groupe (IndexedDB), envoi/réception +
   vérif signature, UI liste de groupes + colonne de conversation généralisée.
4. **Android** : miroir (repos, stores, écrans), test d'interop contre les vecteurs.
5. **Rotations** : membership change → rotation des sender keys + rediffusion.

## 9. Contrat — schéma SQL (Drizzle)

Migration (numéro à attribuer au moment de l'implémentation) :

```sql
CREATE TABLE groups (
  id          text PRIMARY KEY,                  -- uuid v4
  owner_iid   text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  name        text NOT NULL,
  avatar_url  text,
  key_epoch   integer NOT NULL DEFAULT 1,        -- ++ à chaque leave/kick
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id    text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_iid  text NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner','admin','member')),
  added_by    text REFERENCES identities(id),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, member_iid)
);
CREATE INDEX idx_group_members_member ON group_members(member_iid);

CREATE TABLE group_messages (
  id           text PRIMARY KEY,                 -- uuid v4
  group_id     text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  sender_iid   text NOT NULL,
  sender_dev   text NOT NULL,                    -- device id (cf. multidevice)
  epoch        integer NOT NULL,                 -- key_epoch utilisé
  iter         integer NOT NULL,                 -- compteur chain ratchet
  iv           bytea NOT NULL,
  ciphertext   bytea NOT NULL,
  sig          bytea NOT NULL,                   -- ECDSA P-256 (DER)
  sig_key_id   text NOT NULL,                    -- handle vers group_sender_keys
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL              -- created_at + 24h (prune job)
);
CREATE INDEX idx_group_messages_group_time ON group_messages(group_id, created_at DESC);

CREATE TABLE group_sender_keys (
  group_id        text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  epoch           integer NOT NULL,
  recipient_iid   text NOT NULL,
  recipient_dev   text NOT NULL,
  sender_iid      text NOT NULL,
  sender_dev      text NOT NULL,
  envelope        bytea NOT NULL,                -- SKDM chiffrée par ratchet 1:1
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, epoch, recipient_iid, recipient_dev, sender_iid, sender_dev)
);
CREATE INDEX idx_gsk_recipient ON group_sender_keys(recipient_iid, recipient_dev);

CREATE TABLE group_events (
  id          text PRIMARY KEY,
  group_id    text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind        text NOT NULL,                     -- 'create'|'join'|'leave'|'kick'|'rename'|'avatar'|'promote'|'demote'|'transfer'
  actor_iid   text NOT NULL,
  target_iid  text,
  payload     jsonb,                             -- ex: {oldName, newName}
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

Pruning : job existant (cf. prune messages 1:1) étendu à `group_messages.expires_at`.

## 10. Contrat — API REST

Toutes routes auth + CSRF. Erreurs `403` si non-membre, `409` si epoch périmé.

```
POST   /api/groups                       { name, members:[handle], avatarUrl? }     → { id, keyEpoch }
GET    /api/groups                                                                  → [{ id, name, role, memberCount, unread }]
GET    /api/groups/:id                                                              → { id, name, avatar, keyEpoch, members:[{iid,handle,role}], events:[…last 50] }
PATCH  /api/groups/:id                   { name?, avatarUrl? }                      → { ok }                      (admin+)
DELETE /api/groups/:id                                                              → { ok }                      (owner)

POST   /api/groups/:id/members           { handle }                                 → { iid, role:'member' }     (admin+)
DELETE /api/groups/:id/members/:iid                                                 → { ok, newEpoch }            (admin+ ou self pour quitter)
PATCH  /api/groups/:id/members/:iid      { role:'admin'|'member' }                  → { ok }                      (owner)
POST   /api/groups/:id/transfer          { iid }                                    → { ok }                      (owner)

POST   /api/groups/:id/messages          { epoch, iter, iv, ciphertext, sig, sigKeyId } → { id, createdAt }
GET    /api/groups/:id/messages?since=…                                             → [{ id, senderIid, senderDev, epoch, iter, iv, ct, sig, sigKeyId, createdAt }]

POST   /api/groups/:id/skdm              { epoch, envelopes:[{ recipientIid, recipientDev, senderDev, blob }] } → { stored }
GET    /api/groups/:id/skdm/me?epoch=…                                              → [{ groupId, epoch, senderIid, senderDev, blob }]
```

Notifications SSE par membre : `group.message:<id>`, `group.skdm:<id>`, `group.member:<id>`.

## 11. Contrat — enveloppes binaires

**SKDM (Sender Key Distribution Message)** — payload chiffré par le ratchet 1:1 vers
(recipient_iid, recipient_dev). Type sentinelle `gsk` (cf. `att`/`tmr` existants) :

```json
{
  "t": "gsk",
  "g": "<group_id>",
  "ep": 7,                              // epoch
  "ck": "<base64 chainKey 32o>",        // état initial de la chaîne
  "it": 0,                              // iter de départ
  "sp": "<base64 P-256 pub raw>",       // clé pub de signature du sender pour ce groupe/epoch
  "skid": "<id court (8o random)>"      // identifiant de la clé de signature (lookup côté receveur)
}
```

**Group message ciphertext** — `AES-GCM(mk_iter, plaintext, iv, aad)` avec
`aad = group_id || epoch || iter || sender_iid || sender_dev`. Signature ECDSA
P-256 sur SHA-256 du `aad || iv || ciphertext`, attachée séparément en `sig`.

**Plaintext** — JSON :
```json
{ "kind": "text", "body": "…" }
{ "kind": "media", "url": "…", "mime": "…", "key": "…", "iv": "…", "size": 1234, "name": "…" }
{ "kind": "system", "evt": "rename", "payload": { … } }
```

## 12. Rotation d'epoch — séquence exacte

À chaque `leave`/`kick` (jamais à `join`) :

1. Serveur : `UPDATE groups SET key_epoch = key_epoch + 1` + `DELETE FROM group_members`
   + `INSERT group_events (kind='leave'|'kick')`.
2. SSE push `group.member` à tous les membres restants avec `{ newEpoch }`.
3. **Chaque membre restant** détecte `newEpoch > localEpoch` et, en parallèle :
   - génère sa nouvelle `SK_m` (chainKey aléatoire + nouvelle paire de signature P-256) ;
   - construit un SKDM par (recipient_iid × recipient_dev) restant, chiffré par ratchet 1:1 ;
   - POST `/api/groups/:id/skdm` avec le batch.
4. Côté réception : `GET /api/groups/:id/skdm/me?epoch=newEpoch` au reconnect, ratchet-decrypt,
   stocke localement la `SK` de chaque expéditeur pour ce groupe/epoch.
5. Messages reçus avec `epoch < newEpoch` restent lisibles tant que la `SK` correspondante
   est en cache local (les messages eux-mêmes étant TTL 24 h, l'historique disparaît
   naturellement).

Cas dégradés couverts :
- **SKDM manquante** (réception avant SKDM ou perte) → afficher "indéchiffrable" + bouton
  "demander une rekey" qui pousse un message de contrôle 1:1 au sender concerné.
- **Course join + rotation** : si A invite B pendant que C quitte, l'ordre serveur tranche
  (timestamp d'insertion `group_events`). B reçoit la SK pour le nouvel epoch directement.
- **Owner offline lors d'un kick par admin** : l'admin déclenche le bump d'epoch, son
  propre SKDM part. Owner enverra le sien au reconnect (membres non-owner verront
  "indéchiffrable de @owner" jusque-là).

## 13. Sécurité — résumé des invariants

- Serveur n'accepte un POST message que si `(member_iid, group_id)` existe ET
  `epoch == groups.key_epoch`. Pas de réutilisation d'epoch.
- Serveur n'accepte un POST SKDM que de la part d'un membre actuel vers un membre actuel.
- Signature ECDSA vérifiée **avant** déchiffrement côté client (anti-DoS rejet rapide).
- Aucune lecture cross-tenant : toutes les requêtes scopent par `member_iid = currentIdentity`.
- Audit `group_events` pour la traçabilité ; jamais le contenu de message.

## 14. Plan d'implémentation (commits indépendants)

1. **Schéma + store** (`src/store/groups.ts`, migration Drizzle) — CRUD sans crypto, tests unitaires.
2. **API REST + SSE** (`src/routes/groups.ts`) — routes ci-dessus + tests `test/api.test.ts`.
3. **Crypto web** (`public/crypto/groups.js`) — chain ratchet + ECDSA + SKDM encode/decode + vecteurs partagés `test/vectors/group-ratchet.json`.
4. **UI web** — sidebar Groupes, création (modal 2 étapes), conversation, modal membres, rotation auto en SSE.
5. **MCP tools** (`src/mcp-cloud.ts`) — `create_group`, `list_groups`, `add_group_member`, `remove_group_member`, `send_group_message`, `list_group_messages` pour parité Milo.
6. **Android** — `feature:groups` (Compose), `core:crypto` étendu Sender Keys, vérif interop sur vecteurs partagés.

Chaque commit est OSS (pas de `.oss-exclude`).
