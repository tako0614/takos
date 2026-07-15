import Foundation
import Security
import SwiftRs
import Tauri

private class StoreRequest: Decodable {
    let service: String
    let user: String
    let value: String
}

private class ItemRequest: Decodable {
    let service: String
    let user: String
}

private final class KeystorePlugin: Plugin {
    @objc func store(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(StoreRequest.self)
        try validate(service: request.service, user: request.user)
        guard !request.value.isEmpty, let data = request.value.data(using: .utf8) else {
            throw storageError("Secure storage value must not be empty.")
        }

        let query = itemQuery(service: request.service, user: request.user)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            invoke.resolve()
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw storageError("Secure storage update failed.", status: updateStatus)
        }

        var newItem = query
        newItem.merge(attributes) { _, new in new }
        let addStatus = SecItemAdd(newItem as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw storageError("Secure storage write failed.", status: addStatus)
        }
        invoke.resolve()
    }

    @objc func retrieve(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(ItemRequest.self)
        try validate(service: request.service, user: request.user)
        var query = itemQuery(service: request.service, user: request.user)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            invoke.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            throw storageError("Secure storage read failed.", status: status)
        }
        invoke.resolve(["value": value])
    }

    @objc func remove(_ invoke: Invoke) throws {
        let request = try invoke.parseArgs(ItemRequest.self)
        try validate(service: request.service, user: request.user)
        let status = SecItemDelete(
            itemQuery(service: request.service, user: request.user) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw storageError("Secure storage removal failed.", status: status)
        }
        invoke.resolve()
    }

    private func itemQuery(service: String, user: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: user,
        ]
    }

    private func validate(service: String, user: String) throws {
        if service.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            user.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw storageError("Secure storage service and user must not be empty.")
        }
    }

    private func storageError(_ message: String, status: OSStatus? = nil) -> NSError {
        var userInfo: [String: Any] = [NSLocalizedDescriptionKey: message]
        if let status = status {
            userInfo["osStatus"] = String(status)
        }
        return NSError(domain: "jp.takos.mobile.keystore", code: Int(status ?? -1), userInfo: userInfo)
    }
}

@_cdecl("init_plugin_keystore")
func initPlugin() -> Plugin {
    KeystorePlugin()
}
