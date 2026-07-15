const COMMANDS: &[&str] = &[
    "activate_event",
    "deactivate_event",
    "get_token",
    "register_listener",
    "remove_listener",
    "request_permission",
    "unregister",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
