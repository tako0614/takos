#![cfg(mobile)]

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod mobile;
mod models;

pub use error::{Error, Result};
use mobile::MobilePush;

pub trait MobilePushExt<R: Runtime> {
    fn mobile_push(&self) -> &MobilePush<R>;
}

impl<R: Runtime, T: Manager<R>> MobilePushExt<R> for T {
    fn mobile_push(&self) -> &MobilePush<R> {
        self.state::<MobilePush<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-push")
        .invoke_handler(tauri::generate_handler![
            commands::activate_event,
            commands::deactivate_event,
            commands::get_token,
            commands::request_permission,
            commands::unregister
        ])
        .setup(|app, api| {
            let mobile_push = mobile::init(app, api)?;
            app.manage(mobile_push);
            Ok(())
        })
        .build()
}
