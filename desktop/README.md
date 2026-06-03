# mindlog · id — client desktop (Tauri 2)

Wrapper natif **desktop** (macOS / Windows / Linux) de l'app web `mindlog · id`.
La fenêtre charge directement l'app web déployée (`https://id.mindlog.today`) :
aucun frontend à builder, on réutilise le client web tel quel.

## Prérequis
- **Rust** (stable) + prérequis système Tauri 2 :
  - Linux : `webkit2gtk-4.1`, `libsoup-3.0`, `libgtk-3` (paquets `-dev`).
  - macOS : Xcode Command Line Tools (build signé/notarisé : cf. `docs/mac-roadmap.md`, M2).
  - Windows : WebView2 (préinstallé sur Windows 10+).
- **Tauri CLI** : via `npm install` (fournit `@tauri-apps/cli`) ou `cargo install tauri-cli`.

## Lancer / builder
```bash
cd desktop
npm install
npm run dev      # fenêtre de développement
npm run build    # build + bundle (.deb / .AppImage / .dmg / .msi selon l'OS)
```
Sans la CLI npm : `cargo build` (ou `cargo tauri build`) depuis `src-tauri/`.

## Pointer vers un autre serveur
Modifier `app.windows[0].url` dans `src-tauri/tauri.conf.json`
(ex. `http://localhost:8787` pour le serveur de dev local).

## Notes
- L'app ne fait qu'afficher le web : pas d'API Tauri exposée (capacités = `core:default`).
- Le build **macOS** signé + notarisé est suivi dans `docs/mac-roadmap.md` (tâche **M2**).
- Le PWA (offline, push) reste géré par l'app web embarquée.
