use tauri::{command, AppHandle, Runtime};

use crate::models::{EventRequest, PermissionResponse, TokenResponse};
use crate::{MobilePushExt, Result};

#[command]
pub(crate) async fn request_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PermissionResponse> {
    app.mobile_push().request_permission()
}

#[command]
pub(crate) async fn get_token<R: Runtime>(app: AppHandle<R>) -> Result<TokenResponse> {
    app.mobile_push().get_token()
}

#[command]
pub(crate) async fn unregister<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mobile_push().unregister()
}

#[command]
pub(crate) async fn activate_event<R: Runtime>(
    app: AppHandle<R>,
    payload: EventRequest,
) -> Result<()> {
    app.mobile_push().activate_event(payload)
}

#[command]
pub(crate) async fn deactivate_event<R: Runtime>(
    app: AppHandle<R>,
    payload: EventRequest,
) -> Result<()> {
    app.mobile_push().deactivate_event(payload)
}
