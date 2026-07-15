const COMMANDS: &[&str] = &["remove", "retrieve", "store"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
