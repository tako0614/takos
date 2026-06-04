/**
 * COSE / CBOR helpers for WebAuthn attestation parsing.
 *
 * extractCosePublicKey() pulls the CBOR-encoded credential public key out
 * of the authenticatorData field of an AuthenticatorAttestationResponse.
 * coseToJwk() converts the COSE key into a JWK the backend can import
 * via crypto.subtle.importKey('jwk', ...).
 *
 * Only the COSE / CBOR subset that the major platform authenticators
 * (Touch ID / Windows Hello / hardware FIDO2) actually produce is
 * supported: EC2 (P-256 / P-384 / P-521) and RSA. RSAPSS / OKP are
 * passed through but untested.
 *
 * Ported verbatim from takosumi dashboard-ui/src/lib/webauthn/cose.ts.
 */

export function b64urlToBuf(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Pull the CBOR-encoded credential public key out of authenticatorData. */
export function extractCosePublicKey(
  attestationObject: ArrayBuffer,
): Uint8Array {
  const attObj = new Uint8Array(attestationObject);
  const decoded = decodeCbor(attObj) as { authData: Uint8Array };
  const authData = decoded.authData;
  // rpIdHash(32) + flags(1) + signCount(4) + AAGUID(16) + credIdLen(2) + credId + COSE
  let offset = 37;
  offset += 16; // AAGUID (unused here)
  const credIdLen = (authData[offset] << 8) | authData[offset + 1];
  offset += 2;
  offset += credIdLen;
  return authData.slice(offset);
}

export function coseToJwk(cose: Uint8Array): JsonWebKey {
  const map = decodeCbor(cose) as Map<number, unknown>;
  const kty = map.get(1);
  if (kty === 2) {
    const crvNum = map.get(-1);
    const x = map.get(-2) as Uint8Array;
    const y = map.get(-3) as Uint8Array;
    const crv = crvNum === 1
      ? "P-256"
      : crvNum === 2
      ? "P-384"
      : crvNum === 3
      ? "P-521"
      : `unknown(${crvNum})`;
    return {
      kty: "EC",
      crv,
      x: bufToB64url(bytesToArrayBuffer(x)),
      y: bufToB64url(bytesToArrayBuffer(y)),
    };
  }
  if (kty === 3) {
    const n = map.get(-1) as Uint8Array;
    const e = map.get(-2) as Uint8Array;
    return {
      kty: "RSA",
      n: bufToB64url(bytesToArrayBuffer(n)),
      e: bufToB64url(bytesToArrayBuffer(e)),
    };
  }
  throw new Error(`unsupported COSE kty: ${kty}`);
}

/**
 * Minimal CBOR decoder — handles the subset that WebAuthn attestation
 * objects produce: unsigned/negative ints, byte strings, text strings,
 * arrays, maps. Not a general-purpose CBOR library.
 *
 * Maps with all-string keys are flattened to plain objects (this matches
 * attestationObject's `{fmt, attStmt, authData}` shape); mixed/int keys
 * stay as Map<unknown, unknown> (COSE keys use negative int keys).
 */
export function decodeCbor(buf: Uint8Array): unknown {
  let pos = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const readLen = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) {
      const v = view.getUint8(pos);
      pos += 1;
      return v;
    }
    if (info === 25) {
      const v = view.getUint16(pos);
      pos += 2;
      return v;
    }
    if (info === 26) {
      const v = view.getUint32(pos);
      pos += 4;
      return v;
    }
    if (info === 27) {
      const hi = view.getUint32(pos);
      const lo = view.getUint32(pos + 4);
      pos += 8;
      return hi * 0x1_0000_0000 + lo;
    }
    throw new Error("unsupported CBOR length info: " + info);
  };
  const readItem = (): unknown => {
    const byte = view.getUint8(pos);
    pos += 1;
    const major = byte >> 5;
    const info = byte & 0x1f;
    if (major === 0) return readLen(info);
    if (major === 1) return -1 - readLen(info);
    if (major === 2) {
      const len = readLen(info);
      const out = buf.slice(pos, pos + len);
      pos += len;
      return out;
    }
    if (major === 3) {
      const len = readLen(info);
      const out = buf.slice(pos, pos + len);
      pos += len;
      return new TextDecoder().decode(out);
    }
    if (major === 4) {
      const len = readLen(info);
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) arr.push(readItem());
      return arr;
    }
    if (major === 5) {
      const len = readLen(info);
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < len; i++) {
        const k = readItem();
        const v = readItem();
        map.set(k, v);
      }
      if ([...map.keys()].every((k) => typeof k === "string")) {
        const obj: Record<string, unknown> = {};
        for (const [k, v] of map) obj[k as string] = v;
        return obj;
      }
      return map;
    }
    throw new Error(`unsupported CBOR major type: ${major}`);
  };
  return readItem();
}
