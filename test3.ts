// chatmessage_mkem.ts – ドキュメント v1.x 準拠 TypeScript 実装テンプレート + デモ (bug‑fix)
// 主要修正
//   • HPKE createRecipientContext/open が要求する ArrayBuffer 型に合わせて
//     Uint8Array → ArrayBuffer へ変換
//   • TypeScript 型エラー (#2345, #2740) を解消
//   • 変数名 tag → ctShared にリネーム（実体は ciphertext）
//
// ⚠️ import マップは環境に合わせて調整してください

/* deno.json 例
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

import { CipherSuite, HkdfSha256, Aes256Gcm } from "@hpke/core";
import { MlKem768 } from "@hpke/ml-kem";
import { hkdf } from "@noble/hashes/hkdf";
import { sha512 } from "@noble/hashes/sha512";
import { concatBytes } from "@noble/hashes/utils";
import { blake3 } from "@noble/hashes/blake3";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa";
import { utf8ToBytes } from "@noble/post-quantum/utils";
import { canonicalize } from "json-canonicalize";
import { Buffer } from "node:buffer";

const subtle: SubtleCrypto =
  globalThis.crypto?.subtle ?? (await import("node:crypto")).webcrypto.subtle;

// ---------- 型定義 -------------------------------------------------------------
export interface RecipientPublic {
  id: string; // recipient Actor URL
  kemPub: CryptoKey;
}
export interface SenderKeys {
  sigPriv: Uint8Array;
  sigPub: Uint8Array;
  actorId: string; // sender Actor URL
}
export interface ChatAttachmentInput {
  mediaType: string;
  plaintext: Uint8Array;
}
export interface ChatMessageObject {
  [k: string]: unknown;
}

// ---------- 定数 & util --------------------------------------------------------
const HINT_LEN = 16;
const IV_LEN = 12;
const SHARED_KEY_LEN = 32;

function ensureU8(d: unknown): Uint8Array {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  if (d instanceof Buffer) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  throw new Error("need Uint8Array-compatible data");
}

function hkdfExpand(key: Uint8Array, info: string, len = 32): Uint8Array {
  return hkdf(sha512, key, new Uint8Array(), new TextEncoder().encode(info), len);
}


function importAes(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usage);
}

function b64url(u8: Uint8Array): string {
  return Buffer.from(u8).toString("base64url");
}

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

// ---------- mKEM --------------------------------------------------------------
const hpkeSuite = new CipherSuite({ kem: new MlKem768(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

async function encapsulateSharedKey(
  recipients: RecipientPublic[],
  sharedKey: Uint8Array
): Promise<{ kemCt: Uint8Array; per: { hint: Uint8Array; ctShared: Uint8Array }[] }> {
  const per: { hint: Uint8Array; ctShared: Uint8Array }[] = [];
  let kemCtGlobal: Uint8Array | null = null;

  for (const r of recipients) {
    const ctx = await hpkeSuite.createSenderContext({ recipientPublicKey: r.kemPub });
    const encU8 = ensureU8(ctx.enc); // ctx.enc は ArrayBuffer
    if (!kemCtGlobal) kemCtGlobal = encU8;

    const ctShared = ensureU8(await ctx.seal(sharedKey.buffer as ArrayBuffer)); // 暗号化共有鍵 (K + tag)
    const hint = blake3(concatBytes(u8(r.id), encU8)).slice(0, HINT_LEN);
    per.push({ hint, ctShared });
  }

  if (!kemCtGlobal) throw new Error("no recipients");
  return { kemCt: kemCtGlobal, per };
}


function packMkEM(kemCt: Uint8Array, per: { hint: Uint8Array; ctShared: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [kemCt];
  for (const { hint, ctShared } of per) parts.push(hint, ctShared);
  return concatBytes(...parts);
}

// ---------- 添付ファイル暗号化 -----------------------------------------------
async function encryptAttachment(
  plaintext: Uint8Array,
  K_attachment: Uint8Array
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array; tag: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await importAes(K_attachment, ["encrypt"]);
  const ctRaw = await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const ct = new Uint8Array(ctRaw);
  return { iv, ciphertext: ct, tag: ct.slice(-16) };
}

// ---------- ChatMessage 生成 --------------------------------------------------
export async function createChatMessage(
  sender: SenderKeys,
  recipients: RecipientPublic[],
  plaintext: string,
  attachments: ChatAttachmentInput[] = []
): Promise<{ message: ChatMessageObject; signatureUrl: string }> {
  // 1) K 生成 & mKEM
  const K = crypto.getRandomValues(new Uint8Array(SHARED_KEY_LEN));
  const { kemCt, per } = await encapsulateSharedKey(recipients, K);
  const kemPacked = packMkEM(kemCt, per);

  // 2) 本文暗号化
  const K_body = hkdfExpand(K, "body");
  const ivBody = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const aesBody = await importAes(K_body, ["encrypt"]);
  const ctBody = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: ivBody }, aesBody, u8(plaintext)));

  // 3) 添付暗号化 (任意)
  const K_att = hkdfExpand(K, "attachment");
  const attachmentArr: {
    type: string;
    mediaType: string;
    url: string;
    "crypto:encrypted": boolean,
    "crypto:iv": string;
    "crypto:tag": string;
  }[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const { iv, ciphertext: _cipherText, tag } = await encryptAttachment(attachments[i].plaintext, K_att);
    attachmentArr.push({
      type: "ChatAttachment",
      mediaType: attachments[i].mediaType,
      url: `cid:att-${i}`,
      "crypto:encrypted": true,
      "crypto:iv": b64url(iv),
      "crypto:tag": b64url(tag)
    });
  }

  // 4) Unsigned message
  const msg: any = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      { crypto: "https://example.com/ns/crypto#" }
    ],
    type: "ChatMessage",
    id: `https://example.com/messages/${crypto.randomUUID?.()}`,
    attributedTo: sender.actorId,
    to: recipients.map((r) => r.id),
    published: new Date().toISOString(),
    "crypto:kemCipherText": b64url(kemPacked),
    "crypto:cipherText": b64url(concatBytes(ivBody, ctBody))
  };
  if (attachmentArr.length) msg.attachment = attachmentArr;

  // 5) 署名
  const canon = canonicalize(msg);
  const sigBytes = ml_dsa44.sign(sender.sigPriv, utf8ToBytes(canon));
  const sigUrl = `https://example.com/signatures/${crypto.randomUUID?.()}`;
  SignatureStore.set(sigUrl, b64url(sigBytes));

  msg["crypto:signature"] = {
    "crypto:keyId": `${sender.actorId}#sigkey`,
    "crypto:signatureUrl": sigUrl,
    "crypto:created": new Date().toISOString()
  };

  return { message: msg, signatureUrl: sigUrl };
}

// ---------- デモ用 Signature ストア ------------------------------------------
const SignatureStore = new Map<string, string>();

// ---------- verify & decrypt -------------------------------------------------
export async function verifyAndDecrypt(
  msg: ChatMessageObject,
  getSig: (url: string) => Promise<string>,
  myKemPriv: CryptoKey,
  myId: string,
  senderSigPub: Uint8Array
): Promise<{ plaintext: string }> {
  // 1) 署名検証
  const sigField = (msg as any)["crypto:signature"];
  const sigB64 = await getSig(sigField["crypto:signatureUrl"]);
  const sig = Buffer.from(sigB64, "base64url");
  const { ["crypto:signature"]: _, ...unsigned } = msg as any;
  if (!ml_dsa44.verify(senderSigPub, utf8ToBytes(canonicalize(unsigned)), sig))
    throw new Error("signature bad");

  // 2) sharedKey 復元
  const packed = Buffer.from((msg as any)["crypto:kemCipherText"], "base64url");
  const kemCt = packed.subarray(0, hpkeSuite.kem.encSize);
  const perData = packed.subarray(hpkeSuite.kem.encSize);
  const entryLen = HINT_LEN + SHARED_KEY_LEN + hpkeSuite.aead.tagSize;
  const expectHint = blake3(concatBytes(u8(myId), kemCt)).slice(0, HINT_LEN);
  let ctShared: Uint8Array | null = null;
  for (let off = 0; off < perData.length; off += entryLen) {
    if (perData.subarray(off, off + HINT_LEN).every((b, i) => b === expectHint[i])) {
      ctShared = perData.subarray(off + HINT_LEN, off + entryLen);
      break;
    }
  }
  if (!ctShared) throw new Error("no entry for me");
  const recipCtx = await hpkeSuite.createRecipientContext({ recipientKey: myKemPriv, enc: toAB(kemCt) });
  const K = ensureU8(await recipCtx.open(toAB(ctShared))); // ArrayBuffer → Uint8Array

  // 3) 本文復号
  const bin = Buffer.from((msg as any)["crypto:cipherText"], "base64url");
  const iv = bin.subarray(0, IV_LEN);
  const ct = bin.subarray(IV_LEN);
  const K_body = hkdfExpand(K, "body");
  const aes = await importAes(K_body, ["decrypt"]);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv }, aes, ct);
  return { plaintext: new TextDecoder().decode(pt) };
}

// ---------- quick demo -------------------------------------------------------
if (import.meta.main) {
  (async () => {
    // sender keys
    const seed = crypto.getRandomValues(new Uint8Array(SHARED_KEY_LEN));
    const { publicKey: sigPub, secretKey: sigPriv } = ml_dsa44.keygen(seed);
    const sender: SenderKeys = { sigPriv, sigPub, actorId: "https://example.com/users/alice" };

    // recipient kem keys
    const kemPair = await hpkeSuite.kem.generateKeyPair();
    const recipients: RecipientPublic[] = [{ id: "https://example.org/users/bob", kemPub: kemPair.publicKey }];

    const { message } = await createChatMessage(sender, recipients, "Quantum ✨ World!");
    console.log("Encrypted ChatMessage\n", JSON.stringify(message, null, 2));

    const res = await verifyAndDecrypt(
      message,
      async (url) => SignatureStore.get(url)!,
      kemPair.privateKey,
      "https://example.org/users/bob",
      sigPub
    );
    console.log("Decrypted:", res.plaintext);
  })().catch(console.error);
}
