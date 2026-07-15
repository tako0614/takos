use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{EventRequest, PermissionResponse, TokenResponse};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mobile_push);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<MobilePush<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("jp.takos.mobile.push", "MobilePushPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_mobile_push)?;
    Ok(MobilePush(handle))
}

pub struct MobilePush<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MobilePush<R> {
    pub fn request_permission(&self) -> crate::Result<PermissionResponse> {
        self.0
            .run_mobile_plugin("requestPermission", ())
            .map_err(Into::into)
    }

    pub fn get_token(&self) -> crate::Result<TokenResponse> {
        self.0.run_mobile_plugin("getToken", ()).map_err(Into::into)
    }

    pub fn unregister(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("unregister", ())
            .map_err(Into::into)
    }

    pub fn activate_event(&self, payload: EventRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("activateEvent", payload)
            .map_err(Into::into)
    }

    pub fn deactivate_event(&self, payload: EventRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("deactivateEvent", payload)
            .map_err(Into::into)
    }
}
