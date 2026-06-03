# Proposition : multi‑appareils E2E « natif » (sessions par appareil + fan‑out)

> Statut : **proposition** (à valider). Remplace le palliatif actuel du *cache de
> clairs* (`/api/e2e/cache`) par un vrai multi‑appareils de bout en bout.

## 1. Problème

Aujourd'hui, chaque **identité** publie **une** clé E2E (`identities.pubkey`) et **un**
bundle de prekeys (`e2e_prekeys` 1:1 + pool `e2e_one_time_prekeys`). Une conversation
= **une** session Double Ratchet entre deux identités, et `messages` stocke **un**
ciphertext par message.

Conséquence : seul l'appareil qui détient les **clés privées de prekeys** courantes
peut déchiffrer nativement. Un 2ᵉ appareil ne peut pas (forward secrecy + clés privées
locales). Le cache de clairs chiffré sous l'IK contourne ça, mais :
- dépend qu'un appareil déchiffre puis pousse ;
- expose un cache de clairs (chiffré, mais ré‑identifiable 24 h) côté serveur ;
- course d'écriture multi‑appareils (atténuée, pas éliminée) ;
- l'appareil « détenteur » hors‑ligne ⇒ les autres ne lisent pas les nouveaux messages.

## 2. Objectif

Plusieurs appareils par compte, chacun lit/écrit **nativement** (sa propre session DR),
sans cache de clairs côté serveur. Modèle éprouvé : **Signal** — clé d'identité **par
appareil**, **fan‑out** à l'envoi (un ciphertext par appareil destinataire, y compris
les **autres appareils de l'expéditeur**).

## 3. Architecture cible

### 3.1 Registre d'appareils
Nouvelle table `devices` :
```
devices(id, identity_id, device_id TEXT, e2e_pubkey TEXT, name TEXT,
        created_at, last_seen, revoked_at NULL)
```
- `device_id` = identifiant stable généré par le client (UUID), 1 keypair E2E par appareil.
- L'**identité** (compte, clé d'accès) ne change pas ; la crypto devient per‑appareil.

### 3.2 Prekeys par appareil
`e2e_prekeys` et `e2e_one_time_prekeys` re‑clés par `device_pk` (FK `devices.id`) au
lieu de `identity_id`. Chaque appareil publie sa SPK + son pool d'OPK.

`GET /api/e2e/prekeys/:handle` renvoie **un bundle par appareil actif** du pair :
`[{ deviceId, ik, spkPub, spkId, opkPub?, opkId? }, …]` (OPK consommée par couple
(monAppareil, sonAppareil)).

### 3.3 Sessions
Session DR indexée par `(monDevice, peerDevice)`. Le store local gère N sessions par pair.

### 3.4 Fan‑out à l'envoi
Pour envoyer un message à `jacques` (appareils J1,J2) depuis `diana/D1` :
1. Récupérer les bundles de **tous** les appareils de jacques **et de mes autres
   appareils** (D2…) via les prekeys.
2. Chiffrer le payload **séparément** pour chaque appareil destinataire (J1,J2,D2).
3. Poster **N enveloppes** (une par appareil destinataire).

Les autres appareils de l'expéditeur reçoivent ainsi une copie (« sync message ») et
affichent le message envoyé sans cache.

### 3.5 Stockage des messages (enveloppes)
`messages` devient « logique » + enveloppes par destinataire :
```
messages(id, pair, client_msg_id, sender_id, sender_device_id, created_at,
         expires_at, read_once, …)              -- métadonnée logique (1 ligne)
message_envelopes(id, message_id, recipient_device_id, iv, ciphertext)  -- N lignes
```
Chaque appareil lit `GET /api/messages/:handle` → ne reçoit que **ses** enveloppes
(`recipient_device_id = monDevice`) + la métadonnée logique partagée.
`client_msg_id` relie réactions / lecture / suppression / minuterie au message **logique**.

## 4. Effets de bord (le gros du travail)

- **Réactions** : référencent `client_msg_id` (logique), pas une ligne par appareil.
- **Accusés de réception / lecture** : par appareil → agrégés (« lu » quand ≥1 appareil
  du destinataire a lu, ou « lu sur tous » selon choix UX).
- **Suppression** : supprime la métadonnée + toutes ses enveloppes.
- **Minuterie / lecture unique** : sur le message logique.
- **Pièces jointes** : le blob chiffré reste partagé ; la **clé** de la pièce jointe doit
  être livrée par appareil (dans chaque enveloppe) — sinon les autres appareils ne
  peuvent pas la déchiffrer. À retravailler.
- **Groupes (sender keys)** : la SKDM (distribution de clé) doit être fan‑out vers tous
  les appareils de chaque membre.
- **Coffre de clé** : aujourd'hui il porte **la** clé d'identité. En per‑appareil, chaque
  appareil a sa propre clé — le coffre sert alors surtout à l'auth/restauration de
  compte, plus à « relire les messages » (qui devient natif). À clarifier.
- **Numéro de sécurité (anti‑MITM)** : doit couvrir **l'ensemble des appareils** d'un
  pair (sinon un appareil ajouté frauduleusement passe inaperçu). cf. §6.

## 5. Migration (compat ascendante)

- Chaque identité existante : créer un `devices` « device 0 » à partir de
  `identities.pubkey` + `e2e_prekeys`/OPK actuels (re‑clés sur device 0).
- Messages v2 existants : laissés tels quels (éphémères 24 h → s'éteignent seuls). On
  bascule le **nouvel** envoi en fan‑out ; coexistence le temps de la fenêtre 24 h.
- Le cache `/api/e2e/cache` reste **optionnel** (transfert d'historique vers un appareil
  neuf, à la Signal), ou est retiré. Décision §7.

## 6. Sécurité — point critique

Le multi‑appareils ouvre une surface d'attaque : **qui peut enregistrer un appareil ?**
Avec la seule clé d'accès, un attaquant qui l'obtient pourrait ajouter un appareil et
lire les futurs messages. Mitigations :
- Enregistrement d'appareil **autorisé** par un appareil existant (signature de l'IK
  d'appareil par une clé du compte / approbation explicite), façon « lier un appareil ».
- Le **numéro de sécurité** doit refléter la liste des appareils → tout nouvel appareil
  change l'empreinte ⇒ re‑vérification visible par le pair.
- Notification « nouvel appareil ajouté » sur les appareils existants.

## 7. Décisions (verrouillées le 2026-05-30)

1. **Autorisation d'un nouvel appareil** : ✅ **approbation par un appareil existant**
   (appairage type QR/approbation ; un appareil actif signe l'IK du nouvel appareil).
   Pas d'auto‑enrôlement silencieux via la seule clé d'accès.
2. **Stockage** : ✅ **enveloppes par appareil** (`messages` logique + `message_envelopes`).
3. **Cache de clairs `/api/e2e/cache`** : ✅ **retiré** une fois le fan‑out natif livré
   (P7) ; aucun clair, même chiffré, ne subsiste côté serveur. Un appareil neuf ne voit
   que les messages reçus **après** son enrôlement (pas de transfert d'historique).
4. **Limite d'appareils** : à fixer (proposition : 5) + révocation explicite.
5. **Accusé de lecture** multi‑appareils : à préciser en P5 (proposition : « lu » dès
   qu'**un** appareil du destinataire a lu).

## 8. Plan par phases (incrémental, chaque phase livrable/testable)

- **P0 — Design & schéma** : valider §7, migrations `devices` + re‑clés prekeys, vecteurs.
- **P1 — Serveur** : registre d'appareils, prekeys per‑appareil, endpoints bundles
  multi‑appareils, stockage enveloppes, lecture filtrée par appareil, fan‑out des reads.
- **P2 — Crypto client (partagée)** : génération d'IK par appareil, N sessions par pair,
  helper de fan‑out (chiffrer pour chaque appareil cible + mes autres appareils).
- **P3 — Web** : enrôlement d'appareil, envoi fan‑out, lecture enveloppes, sync messages.
- **P4 — Android** : idem (parité), DTO/API, sessions multiples dans RatchetStore.
- **P5 — Effets de bord** : réactions/reads/deletes/minuterie/pièces jointes/groupes.
- **P6 — Sécurité** : autorisation d'appareil, numéro de sécurité multi‑appareils,
  notifications « nouvel appareil », révocation.
- **P7 — Migration & nettoyage** : device 0, retrait éventuel du cache de clairs,
  whitepaper (`docs/whitepaper/mindlog-crypto.tex`).

## 9. Estimation / risque

Refonte cryptographique majeure, multi‑semaines, **porte à sens unique** (format de
message + schéma). Recommandation : valider §7, geler le format des enveloppes et des
bundles (vecteurs partagés web↔Android), puis avancer phase par phase derrière un flag.
