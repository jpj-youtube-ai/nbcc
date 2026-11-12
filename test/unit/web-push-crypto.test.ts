import { describe, it, expect } from "vitest";
import { createDecipheriv, createECDH, createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  assertVapidPair,
  contentKeys,
  encryptPayload,
  MAX_PLAINTEXT,
  subscriptionIsDead,
  vapidAuthHeader,
} from "../../src/admin/web-push";

// Web Push encryption, written from the RFCs (TASK-NNN).
//
// There is no `web-push` package in this repo and there cannot be: the npm registry is blocked on
// the owner's machine, which is why the AWS SigV4 signer and the QR encoder are hand-written too.
// So this is ours, and it has no safety net — every way of getting it wrong fails identically:
// the push service accepts the request, returns success, and the phone shows nothing.
//
// Which is why these tests pin the INTERMEDIATE values from RFC 8291 Appendix A rather than only
// a final ciphertext, and why the decoder below is a CONFORMING one that reads the record size
// out of the header. An earlier version of this file split the body at a fixed offset and
// swallowed the rest as one record, which passed happily for payloads no browser could open.

const b64 = (s: string) => Buffer.from(s, "base64url");

/** RFC 8291 Section 5 and Appendix A, verbatim. */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
};

const rfcEphemeral = () => {
  const e = createECDH("prime256v1");
  e.setPrivateKey(b64(RFC.asPrivate));
  return e;
};

const newPair = () => {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return { publicKey: e.getPublicKey().toString("base64url"), privateKey: e.getPrivateKey().toString("base64url") };
};

/**
 * A receiver that follows RFC 8188 rather than trusting the sender: it reads `rs` out of the
 * header and takes the records the header says are there. This is what a browser does, so it is
 * the only decoder whose success means anything.
 */
function openAsABrowserWould(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body.readUInt8(20);
  const asPublicKey = body.subarray(21, 21 + idlen);
  const payload = body.subarray(21 + idlen);

  const ua = createECDH("prime256v1");
  ua.setPrivateKey(uaPrivate);
  const { cek, nonce } = contentKeys({
    uaPublicKey: ua.getPublicKey(),
    authSecret,
    asPublicKey,
    sharedSecret: ua.computeSecret(asPublicKey),
    salt,
  });

  const out: Buffer[] = [];
  for (let seq = 0, at = 0; at < payload.length; seq += 1, at += rs) {
    const record = payload.subarray(at, Math.min(at + rs, payload.length));
    // RFC 8188 §2.3: the record sequence number is XORed into the last 6 bytes of the nonce.
    const iv = Buffer.from(nonce);
    for (let i = 0; i < 6; i += 1) iv[11 - i] ^= (seq >> (8 * i)) & 0xff;
    const d = createDecipheriv("aes-128-gcm", cek, iv);
    d.setAuthTag(record.subarray(record.length - 16));
    const opened = Buffer.concat([d.update(record.subarray(0, record.length - 16)), d.final()]);
    const delimiter = opened[opened.length - 1];
    if (delimiter !== (at + rs >= payload.length ? 0x02 : 0x01)) throw new Error("wrong padding delimiter");
    out.push(opened.subarray(0, opened.length - 1));
  }
  return Buffer.concat(out).toString();
}

describe("the keys a push message is encrypted with (RFC 8291 Appendix A)", () => {
  const derived = () =>
    contentKeys({
      uaPublicKey: b64(RFC.uaPublic),
      authSecret: b64(RFC.authSecret),
      asPublicKey: b64(RFC.asPublic),
      sharedSecret: rfcEphemeral().computeSecret(b64(RFC.uaPublic)),
      salt: b64(RFC.salt),
    });

  it("agrees with the RFC on the shared secret, so the key pair is being used correctly", () => {
    expect(rfcEphemeral().computeSecret(b64(RFC.uaPublic)).toString("base64url")).toBe(RFC.ecdhSecret);
  });

  // The one that proves the rule rather than the constant: key_info is assembled inside
  // contentKeys from "WebPush: info" || 0x00 || ua_public || as_public.
  it("reaches the RFC's IKM from a key_info it builds itself", () => {
    expect(derived().ikm.toString("base64url")).toBe(RFC.ikm);
  });

  it("agrees with the RFC on the PRK, the content key and the nonce", () => {
    expect(derived().prk.toString("base64url")).toBe(RFC.prk);
    expect(derived().cek.toString("base64url")).toBe(RFC.cek);
    expect(derived().nonce.toString("base64url")).toBe(RFC.nonce);
  });

  it("produces a 16-byte key and a 12-byte nonce, as AES-128-GCM needs", () => {
    expect(derived().cek).toHaveLength(16);
    expect(derived().nonce).toHaveLength(12);
  });
});

describe("inputs that would send a message nobody can open", () => {
  const ok = {
    uaPublicKey: b64(RFC.uaPublic),
    authSecret: b64(RFC.authSecret),
    asPublicKey: b64(RFC.asPublic),
    sharedSecret: rfcEphemeral().computeSecret(b64(RFC.uaPublic)),
    salt: b64(RFC.salt),
  };

  // A compressed point is a VALID point, so the curve maths succeeds. But key_info mixes the key
  // BYTES in, so the subscriber — which always uses its 65-byte uncompressed form — derives a
  // different key, and the phone silently shows nothing.
  it("refuses a validly-encoded point of the wrong length", () => {
    const compressed = Buffer.concat([Buffer.from([0x02]), b64(RFC.uaPublic).subarray(1, 33)]);
    expect(() => contentKeys({ ...ok, uaPublicKey: compressed })).toThrow(/65-byte uncompressed/);
  });

  it("refuses an auth secret that is not the 16 bytes RFC 8291 requires", () => {
    expect(() => contentKeys({ ...ok, authSecret: Buffer.alloc(0) })).toThrow(/auth secret must be 16/);
    expect(() => contentKeys({ ...ok, authSecret: Buffer.alloc(8) })).toThrow(/auth secret must be 16/);
  });

  it("refuses a salt that is not 16 bytes, which would corrupt the header", () => {
    expect(() => contentKeys({ ...ok, salt: Buffer.alloc(32) })).toThrow(/salt must be 16/);
  });

  // The defect this test exists for: one record holds rs - 17 bytes. Go one byte over and a
  // conforming receiver finds no tag where the header says a record ends, while the push service
  // reports success. Loud here beats silent on the phone.
  it("refuses a payload too big for the record size it advertises", () => {
    const args = { uaPublicKey: b64(RFC.uaPublic), authSecret: b64(RFC.authSecret) };
    expect(() => encryptPayload({ ...args, plaintext: Buffer.alloc(MAX_PLAINTEXT + 1) })).toThrow(/at most 4079/);
    expect(() => encryptPayload({ ...args, plaintext: Buffer.alloc(MAX_PLAINTEXT) })).not.toThrow();
  });
});

describe("the body that goes on the wire (RFC 8188)", () => {
  const body = () =>
    encryptPayload({
      plaintext: Buffer.from(RFC.plaintext),
      uaPublicKey: b64(RFC.uaPublic),
      authSecret: b64(RFC.authSecret),
      testVectors: { salt: b64(RFC.salt), ephemeral: rfcEphemeral() },
    });

  it("opens with the 86-octet header the RFC describes", () => {
    const b = body();
    expect(b.subarray(0, 16).toString("base64url")).toBe(RFC.salt);
    expect(b.readUInt32BE(16)).toBe(4096);
    expect(b.readUInt8(20)).toBe(65);
    expect(b.subarray(21, 86).toString("base64url")).toBe(RFC.asPublic);
  });

  it("can be opened by a receiver that follows the RFC, and says what we meant to say", () => {
    expect(openAsABrowserWould(body(), b64(RFC.uaPrivate), b64(RFC.authSecret))).toBe(RFC.plaintext);
  });

  it("is still readable at the largest payload it accepts", () => {
    const big = Buffer.alloc(MAX_PLAINTEXT, 0x61);
    const sealed = encryptPayload({ plaintext: big, uaPublicKey: b64(RFC.uaPublic), authSecret: b64(RFC.authSecret) });
    expect(openAsABrowserWould(sealed, b64(RFC.uaPrivate), b64(RFC.authSecret))).toBe(big.toString());
  });

  // Reusing a nonce under one AES-GCM key does not merely weaken the encryption: it reveals the
  // XOR of the two plaintexts and leaks the authentication subkey.
  it("never repeats a salt or an ephemeral key across many sends", () => {
    const args = { plaintext: Buffer.from("hello"), uaPublicKey: b64(RFC.uaPublic), authSecret: b64(RFC.authSecret) };
    const salts = new Set<string>();
    const keys = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const b = encryptPayload(args);
      salts.add(b.subarray(0, 16).toString("hex"));
      keys.add(b.subarray(21, 86).toString("hex"));
    }
    expect(salts.size).toBe(200);
    expect(keys.size).toBe(200);
  });
});

describe("checking a VAPID pair really is a pair", () => {
  // The defect this exists for: nothing in the key encoding catches a mismatch. A key built from
  // one scalar and a stranger's public key loads, signs, and produces a token every push service
  // rejects with a 403 — forever, with nothing in any log naming the cause. The two halves are
  // pasted into two separate SSM parameters by hand, so this is a mistake somebody will make.
  it("catches a public key that belongs to a different private key", () => {
    const a = newPair();
    const b = newPair();
    expect(() => assertVapidPair(b.publicKey, a.privateKey)).toThrow(/not the public half/);
  });

  it("accepts a real pair", () => {
    const a = newPair();
    expect(() => assertVapidPair(a.publicKey, a.privateKey)).not.toThrow();
  });

  // base64url decoding never throws, so junk arrives as a short buffer rather than an error.
  it.each([
    ["an empty key", ""],
    ["the Terraform placeholder", "REPLACE_ME"],
    ["a truncated key", "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AEL"],
  ])("catches %s as a private key", (_what, privateKey) => {
    expect(() => assertVapidPair(newPair().publicKey, privateKey)).toThrow(/must decode to 32 bytes/);
  });

  it("catches a public key that is not a 65-byte uncompressed point", () => {
    expect(() => assertVapidPair("", newPair().privateKey)).toThrow(/65-byte uncompressed/);
  });
});

describe("the VAPID token that says the push is from us (RFC 8292)", () => {
  const pair = newPair();
  const header = () =>
    vapidAuthHeader({
      audience: "https://fcm.googleapis.com",
      subject: "mailto:ops@nbcc.scot",
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      now: new Date("2026-11-12T00:00:00Z"),
    });

  it("names the push service, us, and when it stops being valid", () => {
    const jwt = /t=([^,]+)/.exec(header())![1];
    expect(JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      sub: "mailto:ops@nbcc.scot",
      exp: Math.floor(Date.parse("2026-11-12T12:00:00Z") / 1000),
    });
  });

  it("carries the public key the subscription was made with", () => {
    expect(/k=(.+)$/.exec(header())![1]).toBe(pair.publicKey);
  });

  // createSign() would give DER here, which every push service rejects. Catching that needs a
  // real signature check, not a length check alone.
  it("signs with a raw r||s signature a push service can actually verify", () => {
    const [h, p, sig] = /t=([^,]+)/.exec(header())![1].split(".");
    expect(Buffer.from(sig, "base64url")).toHaveLength(64);
    const spki = Buffer.concat([
      Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"),
      Buffer.from(pair.publicKey, "base64url"),
    ]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    expect(
      cryptoVerify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")),
    ).toBe(true);
  });

  it("refuses a mismatched pair rather than signing something no service will accept", () => {
    expect(() =>
      vapidAuthHeader({ audience: "https://x.example", subject: "mailto:a@b.c", publicKey: newPair().publicKey, privateKey: pair.privateKey }),
    ).toThrow(/not the public half/);
  });

  // APNs rejects a token whose audience is the whole endpoint rather than the origin.
  it("insists the audience is the push service's origin, not the subscription URL", () => {
    expect(() =>
      vapidAuthHeader({
        audience: "https://fcm.googleapis.com/fcm/send/abc123",
        subject: "mailto:a@b.c",
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
      }),
    ).toThrow(/must be the push service's origin/);
  });
});

describe("telling a gone subscription from a wobble", () => {
  it.each([404, 410])("drops the subscription on %i", (statusCode) => {
    expect(subscriptionIsDead({ statusCode })).toBe(true);
  });

  // 403 is what a wrong VAPID key returns. Dropping the row there would unsubscribe every phone
  // in the charity because of one mistyped key.
  it.each([400, 403, 429, 500, 503])("keeps it on %i", (statusCode) => {
    expect(subscriptionIsDead({ statusCode })).toBe(false);
  });

  it("keeps it when the send failed with no status at all, such as a dropped connection", () => {
    expect(subscriptionIsDead({})).toBe(false);
  });
});
