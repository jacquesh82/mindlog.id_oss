# Proposition — Messagerie de groupe E2E (sender keys)

Statut : **proposition de conception** (rien d'implémenté). Objectif : permettre des
conversations à plusieurs, **chiffrées de bout en bout**, en gardant autant que possible
le modèle actuel : **messages éphémères** (blobs opaques, TTL 24 h) et **serveur qui ne
voit jamais le contenu ni les clés**.

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

## 9. Points ouverts à trancher

- **Option Z vs M** (métadonnée d'appartenance serveur) — *je recommande M*.
- **Sender keys vs fan‑out pairwise** selon la taille de groupe cible.
- **Multi‑appareil des groupes** (le roster/sender keys sont per‑device ; faut‑il les mettre
  dans le coffre ? cela ajoute de la surface).
- **Taille max de groupe** et limites (anti‑abus du fan‑out).
- **Admins/permissions** (qui peut ajouter/retirer).
