use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{RemoveRequest, RetrieveRequest, RetrieveResponse, StoreRequest};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_keystore);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Keystore<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("jp.takos.mobile.keystore", "KeystorePlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_keystore)?;
    Ok(Keystore(handle))
}

pub struct Keystore<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Keystore<R> {
    pub fn store(&self, payload: StoreRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("store", payload)
            .map_err(Into::into)
    }

    pub fn retrieve(&self, payload: RetrieveRequest) -> crate::Result<RetrieveResponse> {
        self.0
            .run_mobile_plugin("retrieve", payload)
            .map_err(Into::into)
    }

    pub fn remove(&self, payload: RemoveRequest) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("remove", payload)
            .map_err(Into::into)
    }
}
