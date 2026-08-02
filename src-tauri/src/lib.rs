#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_stronghold::Builder::new(|password| {
      use argon2::Argon2;

      let mut key = [0_u8; 32];
      Argon2::default()
        .hash_password_into(
          password.as_ref(),
          b"MouseKeeper-v1-Stronghold-KDF",
          &mut key,
        )
        .expect("failed to derive the Stronghold encryption key");
      key.to_vec()
    }).build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
