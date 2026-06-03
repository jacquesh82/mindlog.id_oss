# Roadmap messagerie — combler l'écart vs Signal / Olvid

Issu de l'analyse comparative (mai 2026). Périmètre : **uniquement les fonctionnalités
qui ne nécessitent PAS de persistance serveur durable** — le chat reste éphémère
(TTL 24 h, blobs opaques relayés). Les fonctionnalités exigeant un stockage durable
côté serveur sont listées en bas (hors périmètre pour l'instant).

## À faire (sans nouvelle persistance serveur)

- [x] **Forward secrecy (Double Ratchet)** — ✅ ECDH statique remplacé par X3DH + Double
  Ratchet maison (P-256/HKDF/HMAC/AES-GCM). Forward secrecy + post-compromise security.
  État ratchet côté client ; bundles de prekeys publics ; le serveur ne relaie que des
  blobs. Interop web/Android garantie par vecteurs partagés (`test/vectors/ratchet.json`).
  *Écart cryptographique n°1 — comblé.*
- [x] **Vérification d'identité anti-MITM** — ✅ numéro de sécurité façon Signal (SHA-512
  itéré sur les deux clés d'identité), QR + scan, statut « vérifié » synchronisé serveur,
  badge ✓/⚠️ si la clé change.
- [x] **Pièces jointes chiffrées éphémères** — ✅ images/fichiers chiffrés client (clé AES
  aléatoire par fichier), blob opaque dans `data/`, TTL 24 h, élagage fichiers+lignes.
- [x] **Messages vocaux chiffrés éphémères** — ✅ enregistrement (web WebM/Opus, Android
  AAC/MP4), réutilise l'infra pièces jointes, lecteur audio inline.
- [x] **Conversations de groupe texte (sender keys, Option M)** — ✅ groupes chiffrés de
  bout en bout façon megolm : chaîne symétrique KDF_CK/KDF_MK + signature ECDSA P-256 par
  message (anti-forge) ; clé d'expéditeur (SKDM) distribuée via le canal Double Ratchet
  1‑à‑1 (sentinelle `skd`). Persistance serveur minimale : appartenance seule (tables
  `groups`/`group_members`, migration 0014), messages éphémères réutilisant `messages`
  (pair `g:<id>`, TTL 24 h). Admin = créateur (ajoute/retire) ; rotation de clé au retrait.
  Serveur + web + Android (interop crypto par vecteurs partagés). Forward secrecy ;
  post-compromise réduit (rotation à chaque changement d'effectif).
- [ ] **Appels de groupe P2P** — WebRTC mesh (ou SFU) ; signalisation éphémère via le
  flux temps réel existant (SSE), pas de persistance.
- [x] **Minuterie de disparition configurable** — ✅ message de contrôle partagé (sentinelle
  `tmr<sec>`), TTL par message borné serveur [60 s, 24 h], note système, préréglages 24h/8h/1h/30min/5min.
- [ ] **App iOS native (ou PWA installable)** — parité avec le client Android ; côté
  client uniquement.
- [ ] **App desktop dédiée** — PWA installable / Electron réutilisant le client web.

## Spécifique Olvid (non couvert ailleurs)

- [ ] **Certification de sécurité indépendante (CSPN / ANSSI)** — démarche d'audit/
  certification ; Olvid est certifié CSPN. *(hors code)*
- [x] **Contact sans annuaire (mode invite-only)** — ✅ invitation par QR/lien à usage
  unique (`/i/<token>`, table `invites`, expiration 7 j) ; à l'acceptation, relation
  mutuelle créée sans recherche d'annuaire. Web : QR + lien ; Android : partage + scan.
- [x] **Messages à lecture unique** — ✅ drapeau `read_once`, cache « toucher pour voir »,
  suppression (burn) initiée par le destinataire après révélation. *(minuterie à l'ouverture : non incluse)*
- [ ] **Profils cachés / mode sous contrainte (duress)** *(optionnel — écarté pour l'instant)* —
  révéler un profil caché via un code distinct ; protection des utilisateurs à risque.

## Hors périmètre (nécessitent de la persistance serveur durable)

- Historique persistant des messages (au-delà du TTL éphémère).
- Notifications push en arrière-plan (registre de tokens push à persister).
- **Sauvegarde chiffrée restaurable de l'historique** (backup key façon Olvid) — éphémère par design.
- Multi-appareil avec **synchronisation d'historique** (la portabilité de clé via le
  coffre est déjà faite ; seule la sync d'historique est exclue).

## Notes

- Le chat de mindlog est un **complément** à un produit d'identité : éphémère, 1‑à‑1,
  entre contacts réciproques. La profondeur messagerie n'est pas l'axe de
  différenciation (qui reste : identité + RDV + IA + souveraineté).
- Priorité suggérée : 1) Double Ratchet, 2) vérification d'identité, 3) pièces
  jointes / voix.
