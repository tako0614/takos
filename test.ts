// test.ts - ML-KEM + HPKE based encryption demo for takos2
import { CipherSuite, HkdfSha256, Aes256Gcm } from "jsr:@hpke/core";
import { MlKem768 } from "jsr:@hpke/ml-kem";
import { randomBytes } from 'npm:@noble/hashes/utils';
import { bytesToHex } from 'npm:@noble/hashes/utils';
import { Buffer } from "node:buffer";
import { blake3 } from 'npm:@noble/hashes/blake3';
import { webcrypto as crypto } from 'node:crypto';
import process from "node:process";

// Constants
const HINT_LENGTH = 16;

// UTF-8 Text Encoding/Decoding helpers
function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// 型変換ヘルパー
function ensureUint8Array(data: any): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof Buffer) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  // 最終手段として文字列からの変換を試みる
  if (typeof data === 'string') {
    return textToBytes(data);
  }
  throw new Error(`Cannot convert to Uint8Array: ${typeof data}`);
}

// デバッグヘルパー
function logBuffer(label: string, data: any, maxBytes: number = 16) {
  try {
    const safeData = ensureUint8Array(data);
    const hexPrefix = bytesToHex(safeData.slice(0, maxBytes));
    console.log(`${label} (${safeData.length} bytes): ${hexPrefix}${safeData.length > maxBytes ? '...' : ''}`);
  } catch (err) {
    console.log(`${label}: [Cannot display as hex: ${err.message}]`);
  }
}

interface Recipient {
  id: string;
  keypair: CryptoKeyPair;
  encryptedData?: {
    enc: Uint8Array;        // カプセル化された値
    encryptedPayload: Uint8Array; // 暗号化されたペイロード
  };
  decryptedData?: {
    plaintext: string;
  };
}

async function encryptMessageForRecipient(publicKey: CryptoKey, plaintext: string): Promise<{
  enc: Uint8Array;
  encryptedPayload: Uint8Array;
}> {
  // HPKEスイートの設定
  const suite = new CipherSuite({
    kem: new MlKem768(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
  
  // 送信者コンテキストの作成
  const sender = await suite.createSenderContext({
    recipientPublicKey: publicKey,
  });
  
  // メッセージの暗号化
  const plaintextBytes = textToBytes(plaintext);
  const encryptedPayload = await sender.seal(plaintextBytes);
  
  return {
    enc: ensureUint8Array(sender.enc),
    encryptedPayload: ensureUint8Array(encryptedPayload),
  };
}

async function decryptMessageForRecipient(privateKey: CryptoKey, enc: Uint8Array, encryptedPayload: Uint8Array): Promise<string> {
  // HPKEスイートの設定
  const suite = new CipherSuite({
    kem: new MlKem768(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
  
  // 受信者コンテキストの作成
  const recipient = await suite.createRecipientContext({
    recipientKey: privateKey,
    enc: ensureUint8Array(enc),
  });
  
  // メッセージの復号化
  const decryptedBytes = await recipient.open(ensureUint8Array(encryptedPayload));
  return bytesToText(decryptedBytes);
}

async function demo(recipientCount: number = 2) {
  const startTime = performance.now();
  console.log(`Starting ML-KEM-768 + HPKE demo with ${recipientCount} recipients\n`);

  // HPKEスイートの設定
  const suite = new CipherSuite({
    kem: new MlKem768(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });

  console.log(`HPKE parameters:`);
  console.log(`- KEM: ML-KEM-768 (encSize: ${suite.kem.encSize} bytes)`);
  console.log(`- KDF: HKDF-SHA256`);
  console.log(`- AEAD: AES-256-GCM (tagSize: ${suite.aead.tagSize} bytes)`);

  // 1. 受信者の鍵ペアを生成
  console.log(`\nGenerating ${recipientCount} recipient key pairs...`);
  const recipients: Recipient[] = [];
  
  for (let i = 0; i < recipientCount; i++) {
    const keypair = await suite.kem.generateKeyPair();
    const id = `https://example.com/users/recipient${i + 1}`;
    recipients.push({ id, keypair });
    console.log(`- Generated key pair for ${id}`);
  }

  // 2. メッセージの内容
  const message = "Hello Post-Quantum World from Alice, secured with ML-KEM-768!";
  console.log(`\nOriginal message: "${message}"`);

  // 3. 各受信者向けにメッセージを暗号化
  console.log(`\nEncrypting message for each recipient...`);
  
  for (const recipient of recipients) {
    console.log(`\n[Encrypting for ${recipient.id}]`);
    
    try {
      // 受信者の公開鍵でメッセージを暗号化
      const encryptedData = await encryptMessageForRecipient(
        recipient.keypair.publicKey,
        message
      );
      
      // 暗号化データをログ表示
      logBuffer("Encapsulated key (enc)", encryptedData.enc);
      logBuffer("Encrypted payload", encryptedData.encryptedPayload);
      
      // 復号化のためにデータを保存
      recipient.encryptedData = encryptedData;
      
    } catch (err) {
      console.error(`Error encrypting for ${recipient.id}:`, err);
    }
  }

  // 4. 各受信者が自分のメッセージを復号
  console.log(`\n--- Recipient Decryption Process ---`);
  let allSuccessful = true;
  
  for (const recipient of recipients) {
    console.log(`\n[Decrypting for ${recipient.id}]`);
    
    try {
      // 暗号化データがあるか確認
      if (!recipient.encryptedData) {
        throw new Error("No encrypted data found");
      }
      
      // 復号化
      const plaintext = await decryptMessageForRecipient(
        recipient.keypair.privateKey,
        recipient.encryptedData.enc,
        recipient.encryptedData.encryptedPayload
      );
      
      recipient.decryptedData = { plaintext };
      
      // 結果を表示
      console.log(`Decrypted message: "${plaintext}"`);
      console.log(`Verification: ${plaintext === message ? "✅ Success" : "❌ Failed"}`);
      
      if (plaintext !== message) {
        allSuccessful = false;
      }
      
    } catch (err) {
      console.error(`Error decrypting for ${recipient.id}:`, err);
      allSuccessful = false;
    }
  }

  // 5. 結果サマリー
  const endTime = performance.now();
  console.log("\n--- Summary ---");
  console.log(`Total execution time: ${(endTime - startTime).toFixed(2)} ms`);
  console.log(`All operations successful: ${allSuccessful ? "✅" : "❌"}`);
}

// 拡張版のデモ機能 - メッセージを複数受信者に一度に暗号化
async function advancedDemo() {
  const startTime = performance.now();
  console.log("Starting advanced ML-KEM-768 + HPKE demo\n");

  // 1. HPKEスイートの設定
  const suite = new CipherSuite({
    kem: new MlKem768(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
  
  // 2. 複数の受信者を設定
  console.log("Generating recipient key pairs...");
  const recipients: {
    id: string;
    keypair: CryptoKeyPair;
    hint?: Uint8Array;
  }[] = [];
  
  const recipientCount = 3;
  for (let i = 0; i < recipientCount; i++) {
    const keypair = await suite.kem.generateKeyPair();
    const id = `https://example.com/users/recipient${i + 1}`;
    recipients.push({ id, keypair });
    console.log(`- Generated key pair for ${id}`);
  }
  
  // 3. メッセージの準備とランダムな共有キーの生成
  const message = "This is a secret message for multiple recipients using ML-KEM!";
  const sharedKey = randomBytes(32); // 32バイトの共有キー
  console.log(`\nGenerated shared key: ${bytesToHex(sharedKey)}`);
  
  // 4. 各受信者用の暗号化データを生成
  const recipientData: {
    id: string;
    enc: Uint8Array;
    encryptedKey: Uint8Array;
    hint: Uint8Array;
  }[] = [];
  
  for (const recipient of recipients) {
    const sender = await suite.createSenderContext({
      recipientPublicKey: recipient.keypair.publicKey,
    });
    
    // 共有キーを暗号化
    const encryptedKey = await sender.seal(sharedKey);
    
    // 受信者を識別するためのヒントを生成
    const idBytes = textToBytes(recipient.id);
    const enc = ensureUint8Array(sender.enc);
    const hintInput = new Uint8Array(idBytes.length + enc.length);
    hintInput.set(idBytes, 0);
    hintInput.set(enc, idBytes.length);
    const hint = blake3(hintInput).slice(0, HINT_LENGTH);
    
    recipient.hint = hint;
    
    // 各受信者のデータを保存
    recipientData.push({
      id: recipient.id,
      enc: ensureUint8Array(enc),
      encryptedKey: ensureUint8Array(encryptedKey),
      hint
    });
    
    console.log(`\n[Encrypted for ${recipient.id}]`);
    logBuffer("Encapsulation (enc)", enc);
    logBuffer("Hint", hint);
    logBuffer("Encrypted shared key", encryptedKey);
  }
  
  // 5. メッセージを共有キーで暗号化
  const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM用のIV
  const key = await crypto.subtle.importKey("raw", sharedKey, "AES-GCM", false, ["encrypt"]);
  const messageBytes = textToBytes(message);
  const encryptedMessageBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    messageBytes
  );
  const encryptedMessage = new Uint8Array(encryptedMessageBuffer);
  
  // 6. 全受信者データをまとめる
  const combinedData: Uint8Array[] = [];
  for (const data of recipientData) {
    combinedData.push(data.enc);
    combinedData.push(data.hint);
    combinedData.push(data.encryptedKey);
  }
  const combinedBytes = Buffer.concat(combinedData);
  
  console.log("\n--- Multiplexed Encryption Results ---");
  console.log(`Combined recipient data: ${combinedBytes.length} bytes`);
  console.log(`Encrypted message: ${encryptedMessage.length} bytes`);
  logBuffer("IV", iv);
  
  // 7. 各受信者が共有キーを復号して、メッセージを読み取る
  console.log("\n--- Recipient Decryption Process ---");
  
  for (const recipient of recipients) {
    console.log(`\n[Recipient: ${recipient.id}]`);
    
    try {
      // 自分向けのデータを探す
      let myData: { enc: Uint8Array, encryptedKey: Uint8Array } | undefined;
      
      for (const data of recipientData) {
        if (data.id === recipient.id) {
          myData = {
            enc: data.enc,
            encryptedKey: data.encryptedKey
          };
          break;
        }
      }
      
      if (!myData) {
        throw new Error("Recipient data not found");
      }
      
      // 共有キーの復号
      const recipientContext = await suite.createRecipientContext({
        recipientKey: recipient.keypair.privateKey,
        enc: myData.enc
      });
      
      const recoveredSharedKey = await recipientContext.open(myData.encryptedKey);
      logBuffer("Recovered shared key", recoveredSharedKey);
      
      // メッセージの復号
      const decryptKey = await crypto.subtle.importKey("raw", recoveredSharedKey, "AES-GCM", false, ["decrypt"]);
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        decryptKey,
        encryptedMessage
      );
      
      const decryptedMessage = bytesToText(new Uint8Array(decryptedBuffer));
      console.log(`Decrypted message: "${decryptedMessage}"`);
      console.log(`Verification: ${decryptedMessage === message ? "✅ Success" : "❌ Failed"}`);
      
    } catch (err) {
      console.error(`Error decrypting for ${recipient.id}:`, err);
    }
  }
  
  const endTime = performance.now();
  console.log("\n--- Summary ---");
  console.log(`Total execution time: ${(endTime - startTime).toFixed(2)} ms`);
}

// 引数の解析とデモの実行
const arg = globalThis.Deno ? Deno.args[0] : process.argv[2];

if (arg === "advanced") {
  advancedDemo().catch(console.error);
} else {
  const recipientCount = arg ? parseInt(arg) : 2;
  demo(recipientCount).catch(console.error);
}
