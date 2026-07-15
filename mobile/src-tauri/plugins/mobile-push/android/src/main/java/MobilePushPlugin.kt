package jp.takos.mobile.push

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.atomic.AtomicBoolean

private const val NOTIFICATION_PERMISSION_ALIAS = "notifications"
private const val TAP_HANDLED_EXTRA = "jp.takos.mobile.push.TAP_HANDLED"
private const val MAX_INSTALLATION_ID_LENGTH = 4096
private const val REGISTRATION_REQUEST_TIMEOUT_MILLIS = 20_000L

@InvokeArg
class PushEventRequest {
    var event: String = ""
}

@TauriPlugin(
    permissions = [
        Permission(
            strings = [Manifest.permission.POST_NOTIFICATIONS],
            alias = NOTIFICATION_PERMISSION_ALIAS,
        ),
    ],
)
class MobilePushPlugin(private val activity: Activity) : Plugin(activity) {
    override fun load(webView: WebView) {
        super.load(webView)
        MobilePushRuntime.attach(this)
        handleNotificationTap(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        handleNotificationTap(intent)
    }

    override fun onResume() {
        handleNotificationTap(activity.intent)
    }

    override fun onDestroy(activity: AppCompatActivity) {
        MobilePushRuntime.detach(this)
    }

    @Command
    fun requestPermission(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolvePermission(invoke, true)
            return
        }
        activity.runOnUiThread {
            requestPermissionForAlias(
                NOTIFICATION_PERMISSION_ALIAS,
                invoke,
                "requestPermissionCallback",
            )
        }
    }

    @PermissionCallback
    fun requestPermissionCallback(invoke: Invoke) {
        val granted =
            getPermissionState(NOTIFICATION_PERMISSION_ALIAS)
                .toString()
                .equals("granted", ignoreCase = true)
        resolvePermission(invoke, granted)
    }

    @Command
    fun getToken(invoke: Invoke) {
        val generation = MobilePushRuntime.beginRegistration()
        val completed = AtomicBoolean(false)
        val handler = Handler(Looper.getMainLooper())
        val timeout = Runnable {
            if (completed.compareAndSet(false, true)) {
                invoke.reject("FCM registration request timed out.")
            }
        }
        handler.postDelayed(timeout, REGISTRATION_REQUEST_TIMEOUT_MILLIS)
        FirebaseMessaging.getInstance().register().addOnCompleteListener { registration ->
            if (!MobilePushRuntime.isRegistrationCurrent(generation)) {
                settleCancelledRegistration(invoke, completed, handler, timeout)
                ensureUnregisteredWhenInactive()
                return@addOnCompleteListener
            }
            if (!registration.isSuccessful) {
                settleUnavailableRegistration(invoke, completed, handler, timeout)
                return@addOnCompleteListener
            }
            FirebaseInstallations.getInstance().id.addOnCompleteListener { installation ->
                if (!MobilePushRuntime.isRegistrationCurrent(generation)) {
                    settleCancelledRegistration(invoke, completed, handler, timeout)
                    ensureUnregisteredWhenInactive()
                    return@addOnCompleteListener
                }
                if (!installation.isSuccessful) {
                    settleUnavailableRegistration(invoke, completed, handler, timeout)
                    return@addOnCompleteListener
                }
                val installationId = installation.result?.trim()
                if (
                    installationId.isNullOrEmpty() ||
                    installationId.length > MAX_INSTALLATION_ID_LENGTH ||
                    installationId.any { it.isWhitespace() || it.code < 0x20 || it.code == 0x7f }
                ) {
                    settleUnavailableRegistration(invoke, completed, handler, timeout)
                    return@addOnCompleteListener
                }
                val payload = registrationPayload(installationId)
                if (completed.compareAndSet(false, true)) {
                    handler.removeCallbacks(timeout)
                    invoke.resolve(payload)
                } else {
                    MobilePushRuntime.publish(EVENT_TOKEN_REFRESH, payload)
                }
            }
        }
    }

    @Command
    fun unregister(invoke: Invoke) {
        val generation = MobilePushRuntime.disableRegistration()
        val completed = AtomicBoolean(false)
        val handler = Handler(Looper.getMainLooper())
        val timeout = Runnable {
            if (completed.compareAndSet(false, true)) {
                invoke.reject("FCM unregistration request timed out.")
            }
        }
        handler.postDelayed(timeout, REGISTRATION_REQUEST_TIMEOUT_MILLIS)
        FirebaseMessaging.getInstance().unregister().addOnCompleteListener { task ->
            if (completed.compareAndSet(false, true)) {
                handler.removeCallbacks(timeout)
                if (task.isSuccessful) invoke.resolve()
                else invoke.reject("FCM unregistration failed.")
            }
            if (MobilePushRuntime.shouldRestoreAfterUnregister(generation)) {
                FirebaseMessaging.getInstance().register()
            }
        }
    }

    @Command
    fun activateEvent(invoke: Invoke) {
        val event = validatedEvent(invoke) ?: return
        MobilePushRuntime.activate(event, this)
        invoke.resolve()
    }

    @Command
    fun deactivateEvent(invoke: Invoke) {
        val event = validatedEvent(invoke) ?: return
        MobilePushRuntime.deactivate(event)
        invoke.resolve()
    }

    internal fun emit(event: String, payload: JSObject) {
        trigger(event, payload)
    }

    private fun resolvePermission(invoke: Invoke, granted: Boolean) {
        invoke.resolve(JSObject().apply { put("granted", granted) })
    }

    private fun settleCancelledRegistration(
        invoke: Invoke,
        completed: AtomicBoolean,
        handler: Handler,
        timeout: Runnable,
    ) {
        if (!completed.compareAndSet(false, true)) return
        handler.removeCallbacks(timeout)
        invoke.reject("FCM registration was cancelled.")
    }

    private fun settleUnavailableRegistration(
        invoke: Invoke,
        completed: AtomicBoolean,
        handler: Handler,
        timeout: Runnable,
    ) {
        if (!completed.compareAndSet(false, true)) return
        handler.removeCallbacks(timeout)
        invoke.reject("FCM installation registration is unavailable.")
    }

    private fun ensureUnregisteredWhenInactive() {
        if (!MobilePushRuntime.acceptsRegistrationEvents()) {
            FirebaseMessaging.getInstance().unregister()
        }
    }

    private fun validatedEvent(invoke: Invoke): String? {
        val event = invoke.parseArgs(PushEventRequest::class.java).event
        if (
            event != EVENT_NOTIFICATION_RECEIVED &&
            event != EVENT_NOTIFICATION_TAPPED &&
            event != EVENT_TOKEN_REFRESH
        ) {
            invoke.reject("Unsupported mobile push event.")
            return null
        }
        return event
    }

    private fun handleNotificationTap(intent: Intent?) {
        val current = intent ?: return
        if (current.getBooleanExtra(TAP_HANDLED_EXTRA, false)) return
        val extras = current.extras ?: return
        val isFirebaseNotification =
            extras.containsKey("google.message_id") ||
                extras.containsKey("gcm.message_id") ||
                extras.containsKey("google.c.a.e")
        if (!isFirebaseNotification) return
        current.putExtra(TAP_HANDLED_EXTRA, true)
        MobilePushRuntime.publish(
            EVENT_NOTIFICATION_TAPPED,
            notificationPayload(
                title = firstStringExtra(current, "gcm.n.title", "gcm.notification.title"),
                body = firstStringExtra(current, "gcm.n.body", "gcm.notification.body"),
                data = customData(extras.keySet().associateWith { extras.get(it) }),
                badge = firstIntExtra(current, "gcm.n.notification_count"),
                sound = firstStringExtra(current, "gcm.n.sound2", "gcm.n.sound"),
            ),
        )
    }
}

internal fun registrationPayload(installationId: String): JSObject =
    JSObject().apply {
        // The cross-provider bridge calls this opaque value `token`; for FCM
        // 25.1+ it is a Firebase Installation ID and is sent as message.fid.
        put("token", installationId)
        put("provider", "fcm")
        put("environment", "production")
    }

internal fun notificationPayload(
    title: String?,
    body: String?,
    data: JSObject,
    badge: Int?,
    sound: String?,
): JSObject =
    JSObject().apply {
        if (!title.isNullOrBlank()) put("title", title)
        if (!body.isNullOrBlank()) put("body", body)
        put("data", data)
        if (badge != null && badge >= 0) put("badge", badge)
        if (!sound.isNullOrBlank()) put("sound", sound)
    }

internal fun customData(values: Map<String, Any?>): JSObject =
    JSObject().apply {
        for ((key, value) in values) {
            if (isFirebaseInternalKey(key)) continue
            when (value) {
                is String, is Boolean, is Int, is Long, is Double, is Float -> put(key, value)
            }
        }
    }

private fun isFirebaseInternalKey(key: String): Boolean =
    key.startsWith("google.") ||
        key.startsWith("gcm.") ||
        key == "from" ||
        key == "collapse_key" ||
        key == "message_type" ||
        key == TAP_HANDLED_EXTRA

private fun firstStringExtra(intent: Intent, vararg keys: String): String? {
    for (key in keys) {
        val value = intent.extras?.get(key)
        if (value is String && value.isNotBlank()) return value
    }
    return null
}

private fun firstIntExtra(intent: Intent, vararg keys: String): Int? {
    for (key in keys) {
        val value = intent.extras?.get(key)
        when (value) {
            is Int -> return value
            is Number -> return value.toInt()
            is String -> value.toIntOrNull()?.let { return it }
        }
    }
    return null
}
