// Point d'entrée Tauri 2 (compatible desktop ET futur mobile).
// L'app charge l'UI web déployée (cf. la fenêtre `url` dans tauri.conf.json) :
// aucun frontend à builder, on réutilise tel quel le client web mindlog · id.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
