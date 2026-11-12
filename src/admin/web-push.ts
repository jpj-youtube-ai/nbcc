// Web Push: encrypting a notification for a staff phone, and signing it as us.
//
// Written from RFC 8291 (Message Encryption for Web Push), RFC 8188 (the aes128gcm content
// encoding it builds on) and RFC 8292 (VAPID). There is no `web-push` package here and there
// cannot be: the npm registry is blocked on the owner's machine, so a new runtime dependency would
// break local dev — the same reason the AWS SigV4 signer and the QR encoder are hand-written.
//
// Everything is pure and synchronous, with the two sources of randomness injectable, so
// test/unit/web-push-crypto.test.ts can reproduce RFC 8291's published intermediate values exactly.
// Nothing here touches the database, the network or the clock unless it is handed one.

import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

/** The record size we advertise. One notification is far smaller; this is the usual value. */
const RECORD_SIZE = 4096;

/** A P-256 point, uncompressed: 0x04 then 32 bytes of X and 32 of Y. */
const P256_POINT_BYTES = 65;

const hmac = (key: Buffer, data: Buffer): Buffer => createHmac("sha256", key).update(data).digest();

/**
 * One HKDF step as the two RFCs use it: the info already carries its own trailing 0x00, and the
 * single 0x01 below is HKDF-Expand's counter. Only ever one block is needed (32 bytes at most).
 */
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer =>
  hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([0x01])])).subarray(0, length);

const CEK_INFO = Buffer.concat([Buffer.from("Content-Encoding: aes128gcm", "ascii"), Buffer.from([0x00])]);
const NONCE_INFO = Buffer.concat([Buffer.from("Content-Encoding: nonce", "ascii"), Buffer.from([0x00])]);

export interface ContentKeys {
  /** RFC 8291's input keying material, from the auth secret and the shared secret. */
  ikm: Buffer;
  prk: Buffer;
  /** The AES-128-GCM key: 16 bytes. */
  cek: Buffer;
  /** The AES-128-GCM nonce: 12 bytes. */
  nonce: Buffer;
}

/**
 * The content key and nonce for one push message (RFC 8291 §3.3-3.4).
 *
 * Exported, and returning its intermediates, so each step can be pinned against the RFC's own
 * published values. A push service rejects a wrong body with an opaque 400, so a test that could
 * only check the final ciphertext would tell us something was wrong and never which part.
 *
 * `key_info` is BUILT here rather than taken as a parameter: reproducing the RFC's IKM from a
 * locally-assembled key_info is what proves §3.4 was followed.
 */
export function contentKeys(input: {
  uaPublicKey: Buffer;
  authSecret: Buffer;
  asPublicKey: Buffer;
  sharedSecret: Buffer;
  salt: Buffer;
}): ContentKeys {
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info", "ascii"),
    Buffer.from([0x00]),
    input.uaPublicKey,
    input.asPublicKey,
  ]);
  const ikm = hkdf(input.authSecret, input.sharedSecret, keyInfo, 32);
  const prk = hmac(input.salt, ikm);
  return {
    ikm,
    prk,
    cek: hkdf(input.salt, ikm, CEK_INFO, 16),
    nonce: hkdf(input.salt, ikm, NONCE_INFO, 12),
  };
}

/**
 * One notification, encrypted for one subscription, as a complete aes128gcm record (RFC 8188 §2.1):
 *
 *     salt (16) | record size (4, big-endian) | key id length (1) | key id (65) | ciphertext
 *
 * The key id is our ephemeral public key — the subscriber needs it to derive the same keys, and it
 * is different on every send, which together with the fresh salt is what stops a nonce ever
 * repeating under one key.
 *
 * `salt` and `ephemeral` are injectable ONLY so the RFC's worked example can be reproduced in a
 * test. Both default to fresh randomness and callers in the app never pass them.
 */
export function encryptPayload(input: {
  plaintext: Buffer;
  uaPublicKey: Buffer;
  authSecret: Buffer;
  salt?: Buffer;
  ephemeral?: ReturnType<typeof createECDH>;
}): Buffer {
  const salt = input.salt ?? randomBytes(16);
  const ephemeral = input.ephemeral ?? (() => {
    const e = createECDH("prime256v1");
    e.generateKeys();
    return e;
  })();
  const asPublicKey = ephemeral.getPublicKey();

  const { cek, nonce } = contentKeys({
    uaPublicKey: input.uaPublicKey,
    authSecret: input.authSecret,
    asPublicKey,
    sharedSecret: ephemeral.computeSecret(input.uaPublicKey),
    salt,
  });

  // 0x02 marks the last record. 0x01 would mark a non-final one and the subscriber would reject
  // the message for ending early.
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([input.plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1 + P256_POINT_BYTES);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(P256_POINT_BYTES, 20);
  asPublicKey.copy(header, 21);

  return Buffer.concat([header, sealed]);
}

/** The PKCS#8 prefix for a P-256 private key, up to the 32-byte scalar. */
const P256_PKCS8_PREFIX = Buffer.from("308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420", "hex");

const b64url = (b: Buffer): string => b.toString("base64url");

/**
 * The `Authorization` header asserting the push came from us (RFC 8292): an ES256 JWT naming the
 * push service's origin, how to reach us, and when the token stops being valid, alongside the
 * public key the subscription was created with.
 *
 * Twelve hours, comfortably inside the RFC's 24-hour ceiling, and signed afresh per send — there
 * is nothing to cache at one notification a minute.
 */
export function vapidAuthHeader(input: {
  audience: string;
  subject: string;
  publicKey: string;
  privateKey: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: input.audience,
        sub: input.subject,
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
      }),
    ),
  );
  const signingInput = Buffer.from(`${header}.${claims}`);

  // PKCS#8 assembled around the raw scalar, because that is the only shape node will sign with.
  // dsaEncoding "ieee-p1363" is what makes the signature a raw r||s pair: the default is DER, and
  // a DER signature here is rejected by every push service.
  const key = createPrivateKey({
    key: Buffer.concat([
      P256_PKCS8_PREFIX,
      Buffer.from(input.privateKey, "base64url"),
      Buffer.from("a144034200", "hex"),
      Buffer.from(input.publicKey, "base64url"),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const signature = sign("sha256", signingInput, { key, dsaEncoding: "ieee-p1363" });

  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${input.publicKey}`;
}

/**
 * Whether a failed send means the subscription is gone for good.
 *
 * 404 and 410 are the push service saying this endpoint no longer exists — the phone was wiped,
 * the app deleted, or permission withdrawn — and the row should go. Everything else, including a
 * 400 we may have caused ourselves and a 500 at their end, is a wobble: dropping the subscription
 * would quietly unsubscribe somebody because of a bug or an outage.
 */
export function subscriptionIsDead(err: { statusCode?: number }): boolean {
  return err.statusCode === 404 || err.statusCode === 410;
}
