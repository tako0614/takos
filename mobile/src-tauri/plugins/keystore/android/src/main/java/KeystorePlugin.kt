package jp.takos.mobile.keystore

import android.app.Activity
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val ANDROID_KEY_STORE = "AndroidKeyStore"
private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
private const val PREFERENCES_NAME = "jp.takos.mobile.keystore.v1"
private const val KEY_ALIAS_PREFIX = "jp.takos.mobile.keystore."
private const val ENCODED_VALUE_VERSION = "v1"

@InvokeArg
class StoreRequest {
    var service: String = ""
    var user: String = ""
    var value: String = ""
}

@InvokeArg
class ItemRequest {
    var service: String = ""
    var user: String = ""
}

@TauriPlugin
class KeystorePlugin(private val activity: Activity) : Plugin(activity) {
    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
    }

    @Command
    fun store(invoke: Invoke) {
        val request = invoke.parseArgs(StoreRequest::class.java)
        val itemId = itemIdOrReject(invoke, request.service, request.user) ?: return
        if (request.value.isEmpty()) {
            invoke.reject("Secure storage value must not be empty.")
            return
        }

        try {
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey(itemId))
            val encrypted = cipher.doFinal(request.value.toByteArray(StandardCharsets.UTF_8))
            val encoded = listOf(
                ENCODED_VALUE_VERSION,
                Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
                Base64.encodeToString(encrypted, Base64.NO_WRAP),
            ).joinToString(":")
            val stored = activity
                .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(itemId, encoded)
                .commit()
            if (!stored) {
                invoke.reject("Secure storage write did not commit.")
                return
            }
            invoke.resolve()
        } catch (_: Exception) {
            invoke.reject("Secure storage write failed.")
        }
    }

    @Command
    fun retrieve(invoke: Invoke) {
        val request = invoke.parseArgs(ItemRequest::class.java)
        val itemId = itemIdOrReject(invoke, request.service, request.user) ?: return
        val encoded = activity
            .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .getString(itemId, null)

        if (encoded == null) {
            invoke.resolve(JSObject().apply { put("value", JSONObject.NULL) })
            return
        }

        try {
            val parts = encoded.split(":", limit = 3)
            if (parts.size != 3 || parts[0] != ENCODED_VALUE_VERSION) {
                invoke.reject("Secure storage value has an unsupported format.")
                return
            }
            val entry = keyStore.getEntry(keyAlias(itemId), null) as? KeyStore.SecretKeyEntry
            if (entry == null) {
                invoke.reject("Secure storage key is unavailable.")
                return
            }
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                entry.secretKey,
                GCMParameterSpec(128, Base64.decode(parts[1], Base64.NO_WRAP)),
            )
            val cleartext = cipher.doFinal(Base64.decode(parts[2], Base64.NO_WRAP))
            invoke.resolve(
                JSObject().apply {
                    put("value", String(cleartext, StandardCharsets.UTF_8))
                },
            )
        } catch (_: Exception) {
            invoke.reject("Secure storage read failed.")
        }
    }

    @Command
    fun remove(invoke: Invoke) {
        val request = invoke.parseArgs(ItemRequest::class.java)
        val itemId = itemIdOrReject(invoke, request.service, request.user) ?: return
        try {
            val removed = activity
                .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .remove(itemId)
                .commit()
            if (!removed) {
                invoke.reject("Secure storage removal did not commit.")
                return
            }
            val alias = keyAlias(itemId)
            if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
            invoke.resolve()
        } catch (_: Exception) {
            invoke.reject("Secure storage removal failed.")
        }
    }

    private fun getOrCreateSecretKey(itemId: String): SecretKey {
        val alias = keyAlias(itemId)
        val current = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry
        if (current != null) return current.secretKey

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun itemIdOrReject(invoke: Invoke, service: String, user: String): String? {
        if (service.isBlank() || user.isBlank()) {
            invoke.reject("Secure storage service and user must not be empty.")
            return null
        }
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$service\u0000$user".toByteArray(StandardCharsets.UTF_8))
        return digest.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private fun keyAlias(itemId: String): String = KEY_ALIAS_PREFIX + itemId
}
