package jp.takos.mobile.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class TakosFirebaseMessagingService : FirebaseMessagingService() {
    override fun onRegistered(installationId: String) {
        super.onRegistered(installationId)
        if (!MobilePushRuntime.acceptsRegistrationEvents()) return
        val normalized = installationId.trim()
        if (normalized.isEmpty() || normalized.length > 4096) return
        MobilePushRuntime.publish(EVENT_TOKEN_REFRESH, registrationPayload(normalized))
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val notification = message.notification
        MobilePushRuntime.publish(
            EVENT_NOTIFICATION_RECEIVED,
            notificationPayload(
                title = notification?.title,
                body = notification?.body,
                data = customData(message.data),
                badge = notification?.notificationCount,
                sound = notification?.sound,
            ),
        )
    }
}
