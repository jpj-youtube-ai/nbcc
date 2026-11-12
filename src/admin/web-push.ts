// Web Push: encrypting a notification for a staff phone, and signing it as us.
//
// Written from RFC 8291 (Message Encryption for Web Push), RFC 8188 (the aes128gcm content
// encoding it builds on) and RFC 8292 (VAPID). There is no `web-push` package here and there
// cannot be: the npm registry is blocked on the owner's machine, so a new runtime dependency would
// break local dev — the same reason the AWS SigV4 signer and the QR encoder are hand-written.
//
// Everything is pure and synchronous, with the two sources of randomness injectable (test only),
// so test/unit/web-push-crypto.test.ts can reproduce RFC 8291's published intermediate values.
//
// A NOTE ON WHY THIS FILE IS SO SUSPICIOUS OF ITS OWN INPUTS. Every way of getting this wrong
// fails the same way: the push service accepts the request, returns a success code, and the phone
// shows nothing. There is no error to read and nothing in a log to search. So each precondition
// the RFCs state is asserted here, loudly, at the point it is knowable — a thrown error naming
// the wrong field beats a notification that silently never arrives.

import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

/** The record size we advertise in the header. */
const RECORD_SIZE = 4096;

/**
 * The most plaintext one record can hold: the record size less the 16-byte GCM tag and the
 * one-byte padding delimiter (RFC 8188 §2). Above this, a conforming receiver — which is to say
 * every browser — reads the first `rs` octets as record zero, finds no tag, and discards the
 * message, while the push service happily reports success.
 */
export const MAX_PLAINTEXT = RECORD_SIZE - 17;

/** A P-256 point, uncompressed: 0x04 then 32 bytes of X and 32 of Y. */
const P256_POINT_BYTES = 65;
/** RFC 8291 §3.2: the subscription's authentication secret is 16 octets. */
const AUTH_SECRET_BYTES = 16;
const SALT_BYTES = 16;
const P256_SCALAR_BYTES = 32;

const hmac = (key: Buffer, data: Buffer): Buffer => createHmac("sha256", key).update(data).digest();

/**
 * One HKDF step as the two RFCs use it: the info already carries its own trailing 0x00, and the
 * single 0x01 below is HKDF-Expand's counter.
 *
 * Only ever one block, so it refuses to be asked for more than one rather than quietly returning
 * a short key to whoever reuses this next.
 */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  if (length > 32) throw new Error(`hkdf here does one block; ${length} bytes asked for`);
  return hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([0x01])])).subarray(0, length);
}

const CEK_INFO = Buffer.concat([Buffer.from("Content-Encoding: aes128gcm", "ascii"), Buffer.from([0x00])]);
const NONCE_INFO = Buffer.concat([Buffer.from("Content-Encoding: nonce", "ascii"), Buffer.from([0x00])]);

/** A P-256 point we are willing to do maths with. */
function assertPoint(name: string, point: Buffer): void {
  if (point.length !== P256_POINT_BYTES || point[0] !== 0x04) {
    throw new Error(
      `${name} must be a 65-byte uncompressed P-256 point starting 0x04, got ${point.length} bytes starting 0x${(point[0] ?? 0).toString(16)}`,
    );
  }
}

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
 *
 * The length checks are not ceremony. A validly-encoded point of the WRONG length — a 33-byte
 * compressed one, say — sails through `computeSecret` and derives a different IKM from the one
 * the subscriber will derive, because key_info mixes the key bytes in. The message then encrypts,
 * sends, succeeds, and cannot be opened by the phone it was sent to.
 */
export function contentKeys(input: {
  uaPublicKey: Buffer;
  authSecret: Buffer;
  asPublicKey: Buffer;
  sharedSecret: Buffer;
  salt: Buffer;
}): ContentKeys {
  assertPoint("The subscriber's key (p256dh)", input.uaPublicKey);
  assertPoint("Our ephemeral key", input.asPublicKey);
  if (input.authSecret.length !== AUTH_SECRET_BYTES) {
    throw new Error(`The subscription's auth secret must be ${AUTH_SECRET_BYTES} bytes, got ${input.authSecret.length}`);
  }
  if (input.salt.length !== SALT_BYTES) {
    throw new Error(`The salt must be ${SALT_BYTES} bytes, got ${input.salt.length}`);
  }

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
 * `testVectors` exists ONLY so RFC 8291's worked example can be reproduced, and is grouped under
 * that name so no ordinary caller reaches for it by accident. Handing the same salt and ephemeral
 * key to two messages reuses an AES-GCM nonce under one key, which does not merely weaken the
 * encryption — it reveals the XOR of the two plaintexts and leaks the authentication subkey.
 * Application code passes nothing and gets fresh randomness per call.
 */
export function encryptPayload(input: {
  plaintext: Buffer;
  uaPublicKey: Buffer;
  authSecret: Buffer;
  testVectors?: { salt: Buffer; ephemeral: ReturnType<typeof createECDH> };
}): Buffer {
  if (input.plaintext.length > MAX_PLAINTEXT) {
    throw new Error(
      `A push payload must be at most ${MAX_PLAINTEXT} bytes to fit one ${RECORD_SIZE}-byte record, got ${input.plaintext.length}`,
    );
  }

  const salt = input.testVectors?.salt ?? randomBytes(SALT_BYTES);
  const ephemeral =
    input.testVectors?.ephemeral ??
    (() => {
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

  const header = Buffer.alloc(SALT_BYTES + 4 + 1 + asPublicKey.length);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublicKey.length, 20);
  asPublicKey.copy(header, 21);

  return Buffer.concat([header, sealed]);
}

/**
 * The PKCS#8 wrapper Node will accept around a raw 32-byte P-256 scalar, with the public key in
 * its optional [1] field. Byte-for-byte what Node itself exports for a P-256 private key.
 *
 * The length bytes matter and are easy to get wrong in a way nothing complains about: an earlier
 * version of this file declared the outer SEQUENCE as 65 bytes rather than 135, so the encoding
 * ended before the public key field and Node silently discarded it. The key still loaded, still
 * signed, and a public key that did not belong to the scalar was never noticed — which, with the
 * two halves pasted into two separate SSM parameters by hand, is exactly the mistake somebody
 * will make. assertVapidPair below is the real defence; this is merely correct.
 */
const P256_PKCS8_PREFIX = Buffer.from(
  "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420",
  "hex",
);
const P256_PKCS8_PUBLIC_TAG = Buffer.from("a144034200", "hex");

const b64url = (b: Buffer): string => b.toString("base64url");

/**
 * Check a VAPID key pair really is a pair, before anything depends on it.
 *
 * Nothing in the DER catches a mismatch: a key built from one scalar and a stranger's public key
 * loads happily and signs happily, and the only symptom is that every push service returns 401 or
 * 403 forever while `subscriptionIsDead` correctly reports the subscription is fine. The sweep
 * then retries, every minute, with nothing anywhere naming the cause.
 *
 * Deriving the point from the scalar and comparing is the whole check, and it costs one ECDH.
 */
export function assertVapidPair(publicKey: string, privateKey: string): void {
  const scalar = Buffer.from(privateKey, "base64url");
  const point = Buffer.from(publicKey, "base64url");
  if (scalar.length !== P256_SCALAR_BYTES) {
    throw new Error(`VAPID_PRIVATE_KEY must decode to ${P256_SCALAR_BYTES} bytes, got ${scalar.length}`);
  }
  assertPoint("VAPID_PUBLIC_KEY", point);

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  if (!ecdh.getPublicKey().equals(point)) {
    throw new Error("VAPID_PUBLIC_KEY is not the public half of VAPID_PRIVATE_KEY");
  }
}

/**
 * The `Authorization` header asserting the push came from us (RFC 8292): an ES256 JWT naming the
 * push service's origin, how to reach us, and when the token stops being valid, alongside the
 * public key the subscription was created with.
 *
 * `audience` must be the push service's ORIGIN, not the subscription's full endpoint URL. APNs
 * rejects the latter outright, so it is checked here rather than discovered on Jaimie's phone.
 *
 * Twelve hours, comfortably inside the RFC's 24-hour ceiling, and signed afresh per send — there
 * is nothing worth caching at one notification a minute.
 */
export function vapidAuthHeader(input: {
  audience: string;
  subject: string;
  publicKey: string;
  privateKey: string;
  now?: Date;
}): string {
  assertVapidPair(input.publicKey, input.privateKey);

  let origin: string;
  try {
    origin = new URL(input.audience).origin;
  } catch {
    throw new Error(`The VAPID audience must be a URL, got ${JSON.stringify(input.audience)}`);
  }
  if (origin !== input.audience) {
    throw new Error(`The VAPID audience must be the push service's origin (${origin}), not ${input.audience}`);
  }

  const now = input.now ?? new Date();
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: origin,
        sub: input.subject,
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
      }),
    ),
  );

  // dsaEncoding "ieee-p1363" is what makes the signature a raw r||s pair. The default is DER, and
  // a DER signature here is rejected by every push service.
  const key = createPrivateKey({
    key: Buffer.concat([
      P256_PKCS8_PREFIX,
      Buffer.from(input.privateKey, "base64url"),
      P256_PKCS8_PUBLIC_TAG,
      Buffer.from(input.publicKey, "base64url"),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });

  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${input.publicKey}`;
}

/**
 * Whether a failed send means the subscription is gone for good.
 *
 * 404 and 410 are the push service saying this endpoint no longer exists — the phone was wiped,
 * the app deleted, or permission withdrawn — and the row should go. Everything else, including a
 * 400 we may have caused ourselves and a 403 from a wrong VAPID key, is a wobble: dropping the
 * subscription there would quietly unsubscribe somebody because of our own bug or an outage.
 */
export function subscriptionIsDead(err: { statusCode?: number }): boolean {
  return err.statusCode === 404 || err.statusCode === 410;
}
