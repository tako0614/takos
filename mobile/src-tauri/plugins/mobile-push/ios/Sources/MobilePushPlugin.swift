import Foundation
import ObjectiveC
import Security
import Tauri
import UIKit
import UserNotifications
import WebKit

private let notificationReceivedEvent = "notification-received"
private let notificationTappedEvent = "notification-tapped"
private let tokenRefreshEvent = "token-refresh"
private let allowedEvents: Set<String> = [
    notificationReceivedEvent,
    notificationTappedEvent,
    tokenRefreshEvent,
]
private let maximumPendingEvents = 32
private let tokenRequestTimeoutSeconds: TimeInterval = 20

private final class EventRequest: Decodable {
    let event: String
}

private typealias DidRegisterFunction = @convention(c) (
    AnyObject,
    Selector,
    UIApplication,
    NSData
) -> Void

private typealias DidFailFunction = @convention(c) (
    AnyObject,
    Selector,
    UIApplication,
    NSError
) -> Void

private var installedDelegateClass: AnyClass?

private func installApnsDelegateCallbacks() {
    guard let delegate = UIApplication.shared.delegate else { return }
    let delegateClass: AnyClass = object_getClass(delegate as AnyObject)!
    if let installed = installedDelegateClass, installed === delegateClass { return }

    installDidRegisterCallback(on: delegateClass)
    installDidFailCallback(on: delegateClass)
    installedDelegateClass = delegateClass
}

private func installDidRegisterCallback(on delegateClass: AnyClass) {
    let selector = sel_registerName(
        "application:didRegisterForRemoteNotificationsWithDeviceToken:")
    let currentMethod = class_getInstanceMethod(delegateClass, selector)
    let previousImplementation = currentMethod.map { method_getImplementation($0) }
    let typeEncoding = currentMethod.flatMap { method_getTypeEncoding($0) }

    let callback: @convention(block) (AnyObject, UIApplication, NSData) -> Void = {
        receiver, application, token in
        if let previous = previousImplementation {
            let function = unsafeBitCast(previous, to: DidRegisterFunction.self)
            function(receiver, selector, application, token)
        }
        MobilePushPlugin.instance?.didRegisterForRemoteNotifications(token as Data)
    }
    let implementation = imp_implementationWithBlock(callback as Any)
    if let typeEncoding = typeEncoding {
        _ = class_replaceMethod(
            delegateClass, selector, implementation, typeEncoding)
    } else {
        _ = class_replaceMethod(
            delegateClass, selector, implementation, "v@:@@")
    }
}

private func installDidFailCallback(on delegateClass: AnyClass) {
    let selector = sel_registerName(
        "application:didFailToRegisterForRemoteNotificationsWithError:")
    let currentMethod = class_getInstanceMethod(delegateClass, selector)
    let previousImplementation = currentMethod.map { method_getImplementation($0) }
    let typeEncoding = currentMethod.flatMap { method_getTypeEncoding($0) }

    let callback: @convention(block) (AnyObject, UIApplication, NSError) -> Void = {
        receiver, application, error in
        if let previous = previousImplementation {
            let function = unsafeBitCast(previous, to: DidFailFunction.self)
            function(receiver, selector, application, error)
        }
        MobilePushPlugin.instance?.didFailToRegisterForRemoteNotifications()
    }
    let implementation = imp_implementationWithBlock(callback as Any)
    if let typeEncoding = typeEncoding {
        _ = class_replaceMethod(
            delegateClass, selector, implementation, typeEncoding)
    } else {
        _ = class_replaceMethod(
            delegateClass, selector, implementation, "v@:@@")
    }
}

private final class PushNotificationCenterDelegate: NSObject,
    UNUserNotificationCenterDelegate
{
    static let shared = PushNotificationCenterDelegate()
    var forwardedDelegate: UNUserNotificationCenterDelegate?

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler:
            @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if notification.request.trigger?.isKind(
            of: UNPushNotificationTrigger.self) == true {
            MobilePushPlugin.instance?.publishNotification(
                event: notificationReceivedEvent,
                content: notification.request.content)
        }
        if let forwarded = forwardedDelegate,
           forwarded.responds(
               to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(
                   _:willPresent:withCompletionHandler:))) {
            forwarded.userNotificationCenter?(
                center,
                willPresent: notification,
                withCompletionHandler: completionHandler)
        } else {
            if #available(iOS 14.0, *) {
                completionHandler([.banner, .list, .sound, .badge])
            } else {
                completionHandler([.alert, .sound, .badge])
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.notification.request.trigger?.isKind(
            of: UNPushNotificationTrigger.self) == true {
            MobilePushPlugin.instance?.publishNotification(
                event: notificationTappedEvent,
                content: response.notification.request.content)
        }
        if let forwarded = forwardedDelegate,
           forwarded.responds(
               to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(
                   _:didReceive:withCompletionHandler:))) {
            forwarded.userNotificationCenter?(
                center,
                didReceive: response,
                withCompletionHandler: completionHandler)
        } else {
            completionHandler()
        }
    }
}

@objc(MobilePushPlugin)
public final class MobilePushPlugin: Plugin {
    fileprivate static var instance: MobilePushPlugin?

    private let stateLock = NSLock()
    private var activatedEvents: Set<String> = []
    private var pendingEvents: [String: [JSObject]] = [:]
    private var currentToken: String?
    private var pendingTokenInvokes: [Invoke] = []
    private var registrationRequested = false

    override public func load(webview: WKWebView) {
        MobilePushPlugin.instance = self
        configureNativeLifecycle()
    }

    @objc public func requestPermission(_ invoke: Invoke) {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, _ in
            invoke.resolve(["granted": granted])
        }
    }

    @objc public func getToken(_ invoke: Invoke) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                invoke.reject("APNs bridge is unavailable.")
                return
            }
            guard let environment = apnsEnvironment() else {
                invoke.reject("APNs environment entitlement is unavailable.")
                return
            }
            self.stateLock.lock()
            if let token = self.currentToken {
                self.stateLock.unlock()
                invoke.resolve(self.tokenPayload(token, environment: environment))
                return
            }
            self.pendingTokenInvokes.append(invoke)
            self.registrationRequested = true
            self.stateLock.unlock()
            DispatchQueue.main.asyncAfter(
                deadline: .now() + tokenRequestTimeoutSeconds
            ) { [weak self] in
                self?.timeoutPendingTokenInvoke(invoke)
            }
            installApnsDelegateCallbacks()
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    @objc public func unregister(_ invoke: Invoke) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                invoke.reject("APNs bridge is unavailable.")
                return
            }
            let pending: [Invoke]
            self.stateLock.lock()
            self.registrationRequested = false
            self.currentToken = nil
            pending = self.pendingTokenInvokes
            self.pendingTokenInvokes.removeAll()
            self.pendingEvents.removeValue(forKey: tokenRefreshEvent)
            self.stateLock.unlock()
            UIApplication.shared.unregisterForRemoteNotifications()
            for pendingInvoke in pending {
                pendingInvoke.reject("APNs registration was cancelled.")
            }
            invoke.resolve()
        }
    }

    @objc public func activateEvent(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(EventRequest.self)
        guard allowedEvents.contains(request.event) else {
            invoke.reject("Unsupported mobile push event.")
            return
        }
        let pending: [JSObject]
        stateLock.lock()
        activatedEvents.insert(request.event)
        pending = pendingEvents.removeValue(forKey: request.event) ?? []
        stateLock.unlock()
        for payload in pending {
            trigger(request.event, data: payload)
        }
        invoke.resolve()
    }

    @objc public func deactivateEvent(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(EventRequest.self)
        guard allowedEvents.contains(request.event) else {
            invoke.reject("Unsupported mobile push event.")
            return
        }
        stateLock.lock()
        // Tauri's native listener registry is authoritative. Once JS has
        // installed a listener for an event, never queue that event for a
        // later account/session after the listener is removed.
        activatedEvents.insert(request.event)
        pendingEvents.removeValue(forKey: request.event)
        stateLock.unlock()
        invoke.resolve()
    }

    fileprivate func didRegisterForRemoteNotifications(_ data: Data) {
        guard !data.isEmpty else {
            didFailToRegisterForRemoteNotifications()
            return
        }
        guard let environment = apnsEnvironment() else {
            didFailToRegisterForRemoteNotifications()
            return
        }
        // Device tokens are variable-length binary values. Keep only the
        // current launch's hexadecimal representation in memory.
        let token = data.map { String(format: "%02x", $0) }.joined()
        let invokes: [Invoke]
        stateLock.lock()
        guard registrationRequested else {
            stateLock.unlock()
            return
        }
        currentToken = token
        invokes = pendingTokenInvokes
        pendingTokenInvokes.removeAll()
        stateLock.unlock()

        let payload = tokenPayload(token, environment: environment)
        for invoke in invokes { invoke.resolve(payload) }
        publish(event: tokenRefreshEvent, payload: payload)
    }

    fileprivate func configureNativeLifecycle() {
        let configure = {
            installApnsDelegateCallbacks()
            let center = UNUserNotificationCenter.current()
            let pushDelegate = PushNotificationCenterDelegate.shared
            if center.delegate !== pushDelegate {
                pushDelegate.forwardedDelegate = center.delegate
                center.delegate = pushDelegate
            }
            // Registration is session-bound and starts from getToken(). This
            // keeps logout unregistered until the next signed-in request.
        }
        if Thread.isMainThread { configure() }
        else { DispatchQueue.main.async(execute: configure) }
    }

    fileprivate func didFailToRegisterForRemoteNotifications() {
        let invokes: [Invoke]
        stateLock.lock()
        guard registrationRequested else {
            stateLock.unlock()
            return
        }
        currentToken = nil
        invokes = pendingTokenInvokes
        pendingTokenInvokes.removeAll()
        stateLock.unlock()
        for invoke in invokes {
            invoke.reject("APNs device token is unavailable.")
        }
    }

    private func timeoutPendingTokenInvoke(_ invoke: Invoke) {
        let timedOut: Bool
        stateLock.lock()
        if let index = pendingTokenInvokes.firstIndex(where: { $0 === invoke }) {
            pendingTokenInvokes.remove(at: index)
            timedOut = true
        } else {
            timedOut = false
        }
        stateLock.unlock()
        if timedOut {
            invoke.reject("APNs device token request timed out.")
        }
    }

    fileprivate func publishNotification(
        event: String,
        content: UNNotificationContent
    ) {
        var data: JSObject = [:]
        for (key, value) in content.userInfo {
            guard let key = key as? String, key != "aps",
                  let coerced = coercePushValue(value) else { continue }
            data[key] = coerced
        }

        var payload: JSObject = ["data": data]
        if !content.title.isEmpty { payload["title"] = content.title }
        if !content.body.isEmpty { payload["body"] = content.body }
        if content.badge != nil { payload["badge"] = content.badge! }
        if let aps = content.userInfo["aps"] as? [String: Any],
           let sound = aps["sound"] as? String, !sound.isEmpty {
            payload["sound"] = sound
        }
        publish(event: event, payload: payload)
    }

    private func publish(event: String, payload: JSObject) {
        let shouldTrigger: Bool
        stateLock.lock()
        shouldTrigger = activatedEvents.contains(event)
        if !shouldTrigger {
            var queue = pendingEvents[event] ?? []
            if event == tokenRefreshEvent { queue.removeAll() }
            if queue.count >= maximumPendingEvents {
                queue.removeFirst(queue.count - maximumPendingEvents + 1)
            }
            queue.append(payload)
            pendingEvents[event] = queue
        }
        stateLock.unlock()
        if shouldTrigger { trigger(event, data: payload) }
    }

    private func tokenPayload(_ token: String, environment: String) -> JSObject {
        [
            "token": token,
            "provider": "apns",
            "environment": environment,
        ]
    }
}

private func coercePushValue(_ value: Any) -> JSValue? {
    switch value {
    case let string as String:
        return string
    case let number as NSNumber:
        return number
    case let values as [Any]:
        return values.compactMap(coercePushValue)
    case let dictionary as [String: Any]:
        var result: JSObject = [:]
        for (key, nested) in dictionary {
            if let coerced = coercePushValue(nested) { result[key] = coerced }
        }
        return result
    default:
        return nil
    }
}

private func apnsEnvironment() -> String? {
    guard let task = SecTaskCreateFromSelf(nil),
          let value = SecTaskCopyValueForEntitlement(
              task, "aps-environment" as CFString, nil) as? String else {
        return nil
    }
    switch value {
    case "development":
        return "sandbox"
    case "production":
        return "production"
    default:
        return nil
    }
}

@_cdecl("init_plugin_mobile_push")
func initPlugin() -> Plugin {
    let plugin = MobilePushPlugin()
    MobilePushPlugin.instance = plugin
    plugin.configureNativeLifecycle()
    return plugin
}
