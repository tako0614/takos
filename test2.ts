// chatmessage_mkem.ts – 仕様遵守 TypeScript 実装テンプレート + デモ
// ⚠️ 依存ライブラリや環境に合わせて import マップを調整してください

/*
import map 例 (deno.json):
"imports": {
  "@hpke/core": "jsr:@hpke/core@latest",
  "@hpke/ml-kem": "jsr:@hpke/ml-kem@latest",
  "@noble/hashes/hkdf": "npm:@noble/hashes@1.4.0/hkdf.js",
  "@noble/hashes/sha512": "npm:@noble/hashes@1.4.0/sha512.js",
  "@noble/hashes/utils": "npm:@noble/hashes@1.4.0/utils.js",
  "@noble/hashes/blake3": "npm:@noble/hashes@1.4.0/blake3.js",
  "@noble/post-quantum/ml-dsa": "npm:@noble/post-quantum@1.1.0/ml-dsa.js",
  "@noble/post-quantum/utils": "npm:@noble/post-quantum@1.1.0/utils.js",
  "json-canonicalize": "npm:json-canonicalize@1.0.0"
}
*/

import { CipherSuite, HkdfSha256, Aes256Gcm }  from "@hpke/core";
import { MlKem768 }                            from "@hpke/ml-kem";
import { hkdf }                                from "@noble/hashes/hkdf";
import { sha512 }                              from "@noble/hashes/sha512";
import { concatBytes }                         from "@noble/hashes/utils";
import { blake3 }                              from "@noble/hashes/blake3";
import { ml_dsa44 }                            from "@noble/post-quantum/ml-dsa";
import { utf8ToBytes }                         from "@noble/post-quantum/utils";
import {
    canonicalize 
}                           from "json-canonicalize";
import { Buffer } from "node:buffer";

// WebCrypto API の取得 (ブラウザ / Node 両対応)
const subtle: SubtleCrypto = globalThis.crypto?.subtle ?? (await import("node:crypto")).webcrypto.subtle;

// ――― 型定義 ----------------------------------------------------------------
export interface RecipientPublic { id: string; kemPub: CryptoKey; }
export interface SenderKeys { sigPriv: Uint8Array; sigPub: Uint8Array; }
export interface ChatAttachmentInput { mediaType: string; plaintext: Uint8Array; }
export interface ChatMessageObject { [k: string]: unknown; }


// ――― 定数 & ユーティリティ -----------------------------------------------------
const HINT_LEN = 16;
const IV_LEN   = 12;
const SHARED_KEY_LEN = 32;

function ensureUint8Array(data: any): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Buffer) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error(`Cannot convert to Uint8Array: ${typeof data}`);
}

function hkdfExpand(key: Uint8Array, info: string, len = 32): Uint8Array {
  return hkdf(sha512, key, new Uint8Array(), new TextEncoder().encode(info), len);
}

async function importAesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return subtle.importKey("raw", ensureUint8Array(raw), { name: "AES-GCM" }, false, usage);
}

function b64url(u8: Uint8Array): string {
  return Buffer.from(u8).toString("base64url");
}

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ――― mKEM (HPKE N→1 パッキング) ------------------------------------------------
const hpkeSuite = new CipherSuite({ kem: new MlKem768(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

async function encapsulateSharedKey(
  recipients: RecipientPublic[],
  sharedKey: Uint8Array
): Promise<{ kemCt: Uint8Array; per: { hint: Uint8Array; tag: Uint8Array }[] }> {
  const per: { hint: Uint8Array; tag: Uint8Array }[] = [];
  let kemCtGlobal: Uint8Array | null = null;

  for (const r of recipients) {
    const ctx = await hpkeSuite.createSenderContext({ recipientPublicKey: r.kemPub });
    const enc = ensureUint8Array(ctx.enc);
    kemCtGlobal ??= enc;
    
    const tagRaw = await ctx.seal(sharedKey.buffer as ArrayBuffer);
    const tag = ensureUint8Array(tagRaw);
    const hintFull = blake3(concatBytes(u8(r.id), enc));
    const hint = ensureUint8Array(hintFull).slice(0, HINT_LEN);
    per.push({ hint, tag });
  }

  if (!kemCtGlobal) throw new Error("No recipients");
  return { kemCt: kemCtGlobal, per };
}

function packMkEM(
  kemCt: Uint8Array,
  per: { hint: Uint8Array; tag: Uint8Array }[]
): Uint8Array {
  const parts: Uint8Array[] = [ensureUint8Array(kemCt)];
  for (const entry of per) {
    parts.push(ensureUint8Array(entry.hint), ensureUint8Array(entry.tag));
  }
  return concatBytes(...parts);
}

// ――― ChatMessage 生成 ---------------------------------------------------------
export async function createChatMessage(
  sender: SenderKeys,
  recipients: RecipientPublic[],
  plaintext: string,
  attachments: ChatAttachmentInput[] = []
): Promise<ChatMessageObject> {
  const sharedKey = crypto.getRandomValues(new Uint8Array(SHARED_KEY_LEN));
  const { kemCt, per } = await encapsulateSharedKey(recipients, sharedKey);
  const kemCtPacked = packMkEM(kemCt, per);

  const K_body = hkdfExpand(sharedKey, "body");
  const ivB = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const aesB = await importAesKey(K_body, ["encrypt"]);
  const ctBRaw = await subtle.encrypt({ name: "AES-GCM", iv: ivB }, aesB, u8(plaintext));
  const ctB = ensureUint8Array(ctBRaw);

  const msg: any = {
    "@context": ["https://www.w3.org/ns/activitystreams", { crypto: "https://example.com/ns/crypto#" }],
    type: "ChatMessage",
    id: `urn:uuid:${crypto.randomUUID?.()}`,
    attributedTo: "urn:me",
    to: recipients.map(r => r.id),
    published: new Date().toISOString(),
    "crypto:kemCipherText": b64url(kemCtPacked),
    "crypto:cipherText": b64url(concatBytes(ivB, ctB))
  };

  const unsignedMsg = { ...msg };
  const canonForSign = canonicalize(unsignedMsg);
  const sigBytes = ml_dsa44.sign(sender.sigPriv, utf8ToBytes(canonForSign));
  msg["crypto:signature"] = {
    "crypto:keyId": "urn:sender-sigkey",
    "crypto:created": new Date().toISOString(),
    "crypto:value": b64url(sigBytes)
  };

  return msg;
}

// ――― ChatMessage 検証 & 復号 ----------------------------------------------------
export async function verifyAndDecrypt(
  msg: ChatMessageObject,
  myKemPriv: CryptoKey,
  myId: string,
  senderSigPub: Uint8Array
): Promise<{ plaintext: string }> {
  // 1) 署名検証
  const { "crypto:signature": sigF, ...unsignedMsg } = msg as any;
  const canonForVerify = canonicalize(unsignedMsg);
  const sigBytes = Buffer.from(sigF["crypto:value"], "base64url");
  if (!ml_dsa44.verify(senderSigPub, utf8ToBytes(canonForVerify), sigBytes)) {
    throw new Error("invalid signature");
  }

  // 2) mKEM 共有鍵復元
  const packed = ensureUint8Array(Buffer.from((msg as any)["crypto:kemCipherText"], "base64url"));
  const kemCt = packed.slice(0, hpkeSuite.kem.encSize);
  const perData = packed.slice(hpkeSuite.kem.encSize);
  let foundTag: Uint8Array | null = null;
  const entryLen = HINT_LEN + SHARED_KEY_LEN + hpkeSuite.aead.tagSize;
  for (let offset = 0; offset < perData.length; offset += entryLen) {
    const hint = perData.slice(offset, offset + HINT_LEN);
    const tag = perData.slice(offset + HINT_LEN, offset + entryLen);
    const exp = blake3(concatBytes(u8(myId), kemCt)).slice(0, HINT_LEN);
    if (Buffer.from(exp).toString('hex') === Buffer.from(hint).toString('hex')) {
      foundTag = tag;
      break;
    }
  }

  if (!foundTag) throw new Error("No tag for this recipient");
  const recipCtx = await hpkeSuite.createRecipientContext({ recipientKey: myKemPriv, enc: kemCt.buffer as ArrayBuffer });
  const sharedKey = ensureUint8Array(await recipCtx.open(foundTag.buffer as ArrayBuffer));
  // 3) 本文復号
  const bin = Buffer.from((msg as any)["crypto:cipherText"], "base64url");
  const iv = bin.slice(0, IV_LEN);
  const ct = bin.slice(IV_LEN);
  const K_body = hkdfExpand(sharedKey, "body");
  const aes = await importAesKey(K_body, ["decrypt"]);
  const ptRaw = await subtle.decrypt({ name: "AES-GCM", iv }, aes, ct);
  const plaintext = new TextDecoder().decode(ptRaw);
  return { plaintext };
}

// ――― デモ ----------------------------------------------------------------------
if (import.meta.main) {
  (async () => {
    const seed = crypto.getRandomValues(new Uint8Array(SHARED_KEY_LEN));
    const { publicKey: sigPub, secretKey: sigPriv } = ml_dsa44.keygen(seed);
    const kemPair = await hpkeSuite.kem.generateKeyPair();
    const recipients = [{ id: "urn:recipient", kemPub: kemPair.publicKey }];

    const chat = await createChatMessage({ sigPriv, sigPub }, recipients, "Hello Quantum World!");
    console.log("--- Encrypted ChatMessage ---", JSON.stringify(chat, null, 2));

    const result = await verifyAndDecrypt(chat, kemPair.privateKey, "urn:recipient", sigPub);
    console.log("--- Decrypted plaintext ---", result.plaintext);
  })().catch(console.error);
}
