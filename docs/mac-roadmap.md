# Roadmap — Piste Apple / Mac

Statut : **roadmap** (tâches). Date : 2026-05-29.

**Prérequis transverse : un Mac avec Xcode** (+ un compte Apple Developer pour la
distribution). **Aucune** de ces tâches n'est buildable ni vérifiable sur
l'environnement Linux actuel — elles sont regroupées ici précisément pour ça.

Contexte : `mindlog · id` est déjà livré en **web (PWA)** et **Android natif**. Cette
piste couvre l'écosystème Apple : app iOS (wrapper Capacitor de la PWA), build desktop
macOS (Tauri), QA Safari/WebKit, push iOS, passkeys Apple, assets et distribution.

## Tâches

| # | Tâche | Détail | Effort | Prérequis |
|---|---|---|---|---|
| M1 | **App iOS (Capacitor)** | `@capacitor/core` + `cli` + `ios` ; `capacitor.config` (server.url → app web déployée, ou bundle de `public/`) ; `npx cap add ios` ; build simulateur puis appareil dans Xcode | M | Mac+Xcode |
| M2 | **Build desktop macOS (Tauri)** | Cible macOS de l'app Tauri (D1) : build universel arm64+x86_64, signature *Developer ID*, notarisation (`notarytool`), DMG | M | Mac+Xcode, D1 |
| M3 | **Assets Apple** | Icônes iOS (jeu complet + 1024²), `.icns` macOS, splash screens — générés depuis `public/milo.svg` | S | outils image |
| M4 | **QA Safari / WebKit** | Valider sur Safari desktop + iOS : PWA install/offline (B1/B2), **SQLite-WASM/OPFS sur WebKit**, Web Push (iOS 16.4+ écran d'accueil, B3), appels WebRTC, passkeys, mise en page. Debug via Web Inspector | M | Mac (Safari/iOS) |
| M5 | **Push iOS** | Trancher **Web Push** (PWA écran d'accueil, iOS 16.4+ — déjà couvert par B3) vs **APNs natif** (plugin Capacitor) pour l'app iOS native ; si APNs, intégration serveur | M | M1 |
| M6 | **Passkeys sur Apple** | Vérifier le flux WebAuthn web avec iCloud Keychain (Safari/iOS) ; app native → AuthenticationServices / ASAuthorization | M | Mac (Safari/iOS) |
| M7 | **Distribution Apple** | Compte Apple Developer, certificats/profils, App Store Connect, TestFlight, étiquettes de confidentialité, revue App Store (iOS + macOS) | L | M1, M2 |

## Notes & points d'attention

- **OPFS sur WebKit** : Safari 17+ supporte OPFS + `FileSystemSyncAccessHandle` (en
  worker). C'est le point le plus incertain — **valider B2 spécifiquement sur Safari/iOS**
  (M4). Sinon, prévoir un repli (IndexedDB) côté WebKit.
- **Web Push iOS** : uniquement pour une PWA **ajoutée à l'écran d'accueil** (iOS 16.4+) ;
  pas de push en onglet Safari. B3 (VAPID) couvre déjà ce cas → **M5 ne concerne que l'app
  native** Capacitor (où l'on peut préférer APNs).
- **CSP `wasm-unsafe-eval`** (ajoutée pour B2) : vérifier qu'elle est bien honorée par
  WebKit pour SQLite-WASM (M4).
- **Ordre conseillé** : M3 (assets) → M1 (app iOS) → M4 / M5 / M6 → M7 (distribution).
  M2 (macOS) en parallèle dès que D1 (Tauri) est prêt.
- L'ancienne tâche **D2 (« iOS Capacitor ») de `parity-roadmap.md` est absorbée par M1**.
