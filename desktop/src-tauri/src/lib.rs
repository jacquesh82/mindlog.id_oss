// Point d'entrée Tauri 2 (compatible desktop ET futur mobile).
// L'app charge l'UI web déployée (cf. la fenêtre `url` dans tauri.conf.json) :
// aucun frontend à builder, on réutilise tel quel le client web mindlog · id.
//
// Plugins natifs activés (gain UX 100% côté Rust, indépendant du web app distant) :
//   - window-state   : persiste taille/position de la fenêtre entre les lancements
//   - single-instance: ré-active la fenêtre existante si on relance l'app (desktop only)
//
// Web Notification API + getUserMedia (cam/mic du live broadcaster) sont déjà gérés
// par le webview système (WebKitGTK / WebView2 / WKWebView) pour les origines HTTPS.
// TODO Linux : brancher le signal WebKit `permission-request` si jamais l'auto-grant
// HTTPS ne suffit pas pour cam/mic (live broadcaster, appels WebRTC).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
