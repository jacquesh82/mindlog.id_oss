# Roadmap — Parité fonctionnelle Web ↔ Android

Statut : **parité Web↔Android atteinte** ✅ — toutes les features livrées et vérifiées
(Android `assembleDebug` OK, 126/126 tests TS). Reste : la piste Apple/Mac
(`docs/mac-roadmap.md`) et la QA en conditions réelles (appareil / navigateur).
Dernière mise à jour : 2026-05-29. Branche : `feat/secure-messaging`.

> **Récap livraison** — Web→Android : tags, email de récupération, rotation de clé,
> suppression de compte, **passkey** (Credential Manager). Android→Web : **PWA** installable,
> **offline PIM** (SQLite-WASM/OPFS), **push** (VAPID sans payload). Transverse : coffre E2E
> **vérifié interopérable** ; **desktop Tauri 2** (scaffold). Détail par tâche en §3.

Objectif : recenser les écarts fonctionnels entre le client **Web** (`public/`) et le
client **Android** (`android/`), puis lister les tâches pour les rapprocher. Le **serveur**
(`src/`) est la référence commune : la plupart des manques Android disposent **déjà** d'un
endpoint serveur (utilisé par le web et par le MCP), donc le travail Android est surtout
client (DTO + méthode Retrofit + repository + UI).

## Méthode de confirmation

Écarts confirmés en lisant la surface réelle de chaque client (pas d'inférence) :

- **Android** : `android/core/network/.../MindlogApi.kt` (liste exhaustive des endpoints
  appelés), `android/core/model/.../Card.kt` (modèle de domaine),
  `android/core/data/.../CardRepository.kt`.
- **Web / serveur** : `public/plugins/chat.js`, `src/passkey.ts`, et les outils MCP
  (`set_recovery_email`, `rotate_access_key`, `delete_account`, `add_tag`/`remove_tag`/
  `list_tags`, WebAuthn…).

Légende : ✅ complet · ➖ partiel / spécifique · ❌ absent.

## 1. Parité actuelle

### Identité & carte
| Fonctionnalité | Web | Android |
|---|---|---|
| Carte d'identité (attributs) | ✅ | ✅ |
| Tags | ✅ | ✅ (A1 — chips éditables dans CardScreen) |
| Recherche d'identités | ✅ | ✅ |
| Onboarding / création de compte | ✅ | ✅ |
| Photo de profil | ✅ | ✅ |

### Agenda, disponibilités & RDV
| Fonctionnalité | Web | Android |
|---|---|---|
| Événements (ajout / suppression) | ✅ | ✅ |
| Disponibilités / statut du jour | ✅ | ✅ (`setDayStatus`) |
| Créneaux d'un profil | ✅ | ✅ (`slots`) |
| Demandes de RDV (créer / répondre / supprimer) | ✅ | ✅ (`MeetingRequest`) |

### Relations & réseau
| Fonctionnalité | Web | Android |
|---|---|---|
| Relations (amis / pro / autre, 3 degrés) | ✅ | ✅ |
| Invitation sans annuaire (`/i/<token>`) | ✅ | ✅ (partage lien + scan QR) |
| Notifications in-app + badges | ✅ | ✅ |

### Messagerie sécurisée E2E — parité complète
| Fonctionnalité | Web | Android |
|---|---|---|
| Chiffrement E2E (ECDH P-256 / AES-GCM) | ✅ | ✅ |
| Forward secrecy (Double Ratchet X3DH) | ✅ | ✅ |
| Vérification anti-MITM (safety number + QR) | ✅ | ✅ |
| Pièces jointes chiffrées | ✅ | ✅ |
| Messages vocaux | ✅ | ✅ |
| Minuterie de disparition | ✅ | ✅ |
| Messages à lecture unique (burn) | ✅ | ✅ |
| Groupes E2E (sender keys, admin, rotation) | ✅ | ✅ |
| Appels audio/vidéo (WebRTC) | ✅ | ✅ |

### Sécurité, compte & plateforme
| Fonctionnalité | Web | Android |
|---|---|---|
| Coffre de clés E2E (portabilité) | ✅ passkey PRF + passphrase | ✅ biométrie + passphrase — **interop vérifiée** (C1) |
| Sauvegarde proactive (`needsBackup`) | ✅ | ✅ |
| Connexion passkey (WebAuthn) | ✅ | ✅ Credential Manager (A5) |
| Email de récupération | ✅ | ✅ (A2) |
| Rotation de la clé d'accès | ✅ | ✅ (A3) |
| Suppression de compte | ✅ | ✅ (A4) |
| Notifications quand l'app/onglet est fermé | ✅ Web Push VAPID (B3) | ✅ notifs système + service |
| Mode hors-ligne (offline-first) | ✅ SQLite-WASM/OPFS, PIM (B2) | ✅ cache Room = source de vérité |
| Application installable | ✅ PWA (B1) · desktop Tauri (D1) | ✅ |

## 2. Écarts comblés ✅

Tous les écarts initiaux sont **livrés** (détail en §3) :

- **Android → comblé** : tags, email de récupération, rotation d'access key, suppression
  de compte, passkey (Credential Manager).
- **Web → comblé** : mode hors-ligne (**SQLite-WASM/OPFS**, PIM), notifications hors onglet
  (**Web Push VAPID**), app installable (**PWA**) ; client **desktop Tauri 2** (scaffold).

**Hors parité Web↔Android (reste)** : portée Apple → `docs/mac-roadmap.md` (iOS, macOS) ;
QA en conditions réelles (appareil, navigateur, déploiement assetlinks + clés VAPID) ;
B4 (Background Sync, optionnel) ; hardening interop (vecteur de coffre partagé, cf. C1).

## 3. Tâches de convergence

### A. Web → Android *(backend prêt → travail client Android)*
| # | Tâche | Détail | Effort | Prio |
|---|---|---|---|---|
| A1 | Tags sur Android | ✅ **Livré** — `tags` dans MeDto/AccountFlags, `addTag`/`removeTag` (API+repo+VM), section chips dans CardScreen | S | 🔴 haute |
| A2 | Email de récupération | ✅ **Livré** — `setRecoveryEmail` (API+repo), dialogue section « Compte » des Réglages | S–M | 🔴 haute |
| A3 | Rotation de l'access key | ✅ **Livré** — `rotateAccessKey` (AuthRepository re-persiste la clé), confirmation + affichage/copie de la nouvelle clé | M | 🟠 moyenne |
| A4 | Suppression de compte | ✅ **Livré** — `deleteAccount` (`DELETE /api/me` + purge Room/Keystore via signOut), double confirmation | M | 🟠 moyenne |
| A5 | Passkey natif | ✅ **Livré** — Credential Manager (onboarding : champ handle + bouton passkey), `AuthRepository` begin/finish, `auth/finish` renvoie la clé d'accès, route `/.well-known/assetlinks.json`. Vérif : assembleDebug + 126/126 tests. Reste : déployer assetlinks (SHA-256 du cert via `ANDROID_CERT_SHA256`) + test du flux sur appareil | L | 🟢 basse |

### B. Android → Web — PWA + offline
*Choix d'avril 2026 : PWA standard + stockage local SQLite-WASM ; pas de moteur de sync local-first.*

> **Décision technique.** L'offline web ne cible que les **données PIM** (carte, agenda,
> contacts, notifications) — les messages E2E sont éphémères (TTL 24 h) + ratchet destructif,
> donc on ne les stocke pas au repos. Stockage local = **SQLite-WASM sur OPFS** (miroir de
> Room côté Android). Pas de moteur de sync local-first (mauvais fit E2E + surface d'audit).

| # | Tâche | Détail | Effort | Prio |
|---|---|---|---|---|
| B1 | Coquille PWA | ✅ **Livré** — `public/manifest.webmanifest` + `public/sw.js` servis depuis la racine (scope `/`, version = STARTED_AT) ; shell précaché, `/api`+SSE jamais cachés ; métas iOS + icônes 192/512/maskable. Reste : vérif navigateur (install/offline) | M | 🔴 haute |
| B2 | Offline PIM (SQLite-WASM/OPFS) | ✅ **Livré** — `public/local-db.js` (VFS OPFS SAHPool, PIM-only, exclut clé d'accès + messages), sqlite-wasm vendored, CSP `wasm-unsafe-eval`, hooks offline dans `renderPrivate` (dégradation gracieuse → 0 régression). Vérif : assets servis (`.wasm`=`application/wasm`) + 126/126 tests. Reste : QA navigateur (OPFS) | M–L | 🟠 moyenne |
| B3 | Push web (VAPID) | ✅ **Livré** — `src/push.ts` (VAPID ES256, envoi *sans payload*), migration 0018 `push_subscriptions`, endpoints subscribe/vapid-key, hook `notify()`, SW push/notificationclick, `public/push-client.js`. Vérif : 126/126 tests. Reste : configurer les clés VAPID (`node scripts/gen-vapid.mjs`) + livraison navigateur | M | 🟠 moyenne |
| B4 | Background Sync *(option)* | envoi différé des messages au retour de connexion — ⚠️ **Chromium uniquement** | S | 🟢 basse |

### C. Harmonisation / qualité de parité
| # | Tâche | Détail | Effort |
|---|---|---|---|
| C1 | Unlock coffre E2E commun | ✅ **Vérifié — déjà interopérable** : passphrase identique des 2 côtés (PBKDF2-SHA256 600k/256, sel 16 o, AES-256-GCM IV 12 o/tag 128, enveloppe `{v,pass:{salt,iv,ct}}`, JWK P-256). Coffre passphrase échangeable web↔Android ; `prf`/biométrie = unlocks additifs sur le même schéma. Reste (hardening) : vecteur de test partagé pour verrouiller l'interop | M |
| C2 | Doc de parité + interop | ✅ **Tenu à jour** — doc consolidée (parité atteinte ; tableaux §1 reflètent les ✅). Interop : ratchet couvert par `test/vectors/ratchet.json` ; coffre vérifié par audit (C1), vecteur partagé = hardening restant | S |

### D. Portée multi-plateforme *(réutilisation de l'UI web)*
| # | Tâche | Détail | Effort | Prio |
|---|---|---|---|---|
| D1 | App desktop Tauri 2 | ✅ **Livré (scaffold vérifié)** — `desktop/` (Tauri 2, fenêtre → app web déployée, cœur Rust, capacités `core:default`). Vérif : `cargo check` OK (webkit2gtk-4.1). Reste : `npm run build` pour les bundles (.deb/.AppImage/.dmg/.msi) ; macOS signé/notarisé = M2 | L | 🟠 moyenne |
| D2 | App iOS (Capacitor) | ➡️ **Déplacé vers la piste Apple/Mac** — voir `docs/mac-roadmap.md` (tâche M1) | L | — |

## 4. Suite

Le **code de parité est terminé**. Étapes restantes (matériel / conditions réelles) :

1. **QA réelle** : appareil Android (A1–A5) ; navigateur pour PWA / offline / push (B1–B3) ;
   déploiement `assetlinks.json` (`ANDROID_CERT_SHA256`) + clés VAPID (`node scripts/gen-vapid.mjs`).
2. **Piste Apple/Mac** : `docs/mac-roadmap.md` (M1–M7) — iOS, macOS signé, QA Safari/WebKit.
3. **Optionnel** : B4 (Background Sync, Chromium) ; hardening interop coffre (vecteur partagé).
4. **Avant déploiement** : valider les migrations (`0017_ratchet_cache` journalisée idempotente,
   `0018_push_subscriptions`).
