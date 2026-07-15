package jp.takos.mobile.push

import app.tauri.plugin.JSObject

internal const val EVENT_NOTIFICATION_RECEIVED = "notification-received"
internal const val EVENT_NOTIFICATION_TAPPED = "notification-tapped"
internal const val EVENT_TOKEN_REFRESH = "token-refresh"

private const val MAX_PENDING_EVENTS = 32

internal object MobilePushRuntime {
    private val activatedEvents = mutableSetOf<String>()
    private val pendingEvents = mutableMapOf<String, ArrayDeque<JSObject>>()
    private var plugin: MobilePushPlugin? = null
    private var registrationEnabled = false
    private var registrationGeneration = 0L

    @Synchronized
    fun beginRegistration(): Long {
        if (!registrationEnabled) registrationGeneration += 1
        registrationEnabled = true
        return registrationGeneration
    }

    @Synchronized
    fun disableRegistration(): Long {
        registrationEnabled = false
        registrationGeneration += 1
        pendingEvents.remove(EVENT_TOKEN_REFRESH)
        return registrationGeneration
    }

    @Synchronized
    fun isRegistrationCurrent(generation: Long): Boolean =
        registrationEnabled && registrationGeneration == generation

    @Synchronized
    fun acceptsRegistrationEvents(): Boolean = registrationEnabled

    @Synchronized
    fun shouldRestoreAfterUnregister(generation: Long): Boolean =
        registrationEnabled && registrationGeneration != generation

    @Synchronized
    fun attach(next: MobilePushPlugin) {
        plugin = next
    }

    @Synchronized
    fun detach(current: MobilePushPlugin) {
        if (plugin === current) plugin = null
    }

    fun publish(event: String, payload: JSObject) {
        val target = synchronized(this) {
            val current = plugin
            if (event in activatedEvents) {
                current
            } else {
                enqueue(event, payload)
                null
            }
        }
        target?.emit(event, payload)
    }

    fun activate(event: String, current: MobilePushPlugin) {
        val pending = synchronized(this) {
            plugin = current
            activatedEvents.add(event)
            pendingEvents.remove(event)?.toList().orEmpty()
        }
        for (payload in pending) current.emit(event, payload)
    }

    @Synchronized
    fun deactivate(event: String) {
        // Tauri's listener registry is authoritative. Keep this event behind
        // the activation barrier so events from a signed-out session are
        // dropped instead of being flushed into the next session.
        activatedEvents.add(event)
        pendingEvents.remove(event)
    }

    @Synchronized
    private fun enqueue(event: String, payload: JSObject) {
        val queue = pendingEvents.getOrPut(event) { ArrayDeque() }
        if (event == EVENT_TOKEN_REFRESH) queue.clear()
        while (queue.size >= MAX_PENDING_EVENTS) queue.removeFirst()
        queue.addLast(payload)
    }
}
