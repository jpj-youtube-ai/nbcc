import { describe, it, expect } from "vitest";
import { createDecipheriv, createECDH, createPublicKey, verify as cryptoVerify } from "node:crypto";
import {
  contentKeys,
  encryptPayload,
  subscriptionIsDead,
  vapidAuthHeader,
} from "../../src/admin/web-push";

// Web Push encryption, written from the RFCs (TASK-NNN).
//
// There is no `web-push` package in this repo and there cannot be: the npm registry is blocked on
// the owner's machine, which is why the AWS SigV4 signer and the QR encoder are hand-written too.
// So this is ours, and it has no safety net — a push service rejects a wrong body with an opaque
// 400 and no hint which of six derivation steps was wrong.
//
// Which is why these tests pin the INTERMEDIATE values from RFC 8291 Appendix A rather than only
// the final ciphertext. If a step drifts, the failing assertion names it.
//
// One of them is load-bearing in a way that is easy to miss: `key_info` is NOT copied from the RFC
// here, it is built by the implementation from the rule in Section 3.4. Reproducing the RFC's
// published IKM from a locally-built key_info is what proves the rule was followed, rather than
// proving a constant was pasted correctly.

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

  it("agrees with the RFC on the PRK", () => {
    expect(derived().prk.toString("base64url")).toBe(RFC.prk);
  });

  it("agrees with the RFC on the content key and the nonce", () => {
    expect(derived().cek.toString("base64url")).toBe(RFC.cek);
    expect(derived().nonce.toString("base64url")).toBe(RFC.nonce);
  });

  it("produces a 16-byte key and a 12-byte nonce, as AES-128-GCM needs", () => {
    expect(derived().cek).toHaveLength(16);
    expect(derived().nonce).toHaveLength(12);
  });
});

describe("the body that goes on the wire (RFC 8188)", () => {
  const body = () =>
    encryptPayload({
      plaintext: Buffer.from(RFC.plaintext),
      uaPublicKey: b64(RFC.uaPublic),
      authSecret: b64(RFC.authSecret),
      salt: b64(RFC.salt),
      ephemeral: rfcEphemeral(),
    });

  it("opens with the 86-octet header the RFC describes", () => {
    const b = body();
    expect(b.subarray(0, 16).toString("base64url")).toBe(RFC.salt); // salt
    expect(b.readUInt32BE(16)).toBe(4096); // record size, big-endian
    expect(b.readUInt8(20)).toBe(65); // key id length
    expect(b.subarray(21, 86).toString("base64url")).toBe(RFC.asPublic); // the key id IS the public key
  });

  // The receiver is the authority on whether we got this right, so the test plays the receiver:
  // it derives the keys from the OTHER side of the exchange and opens the record.
  it("can be opened by the subscriber, and says what we meant to say", () => {
    const b = body();
    const ua = createECDH("prime256v1");
    ua.setPrivateKey(b64(RFC.uaPrivate));
    const { cek, nonce } = contentKeys({
      uaPublicKey: b64(RFC.uaPublic),
      authSecret: b64(RFC.authSecret),
      asPublicKey: b.subarray(21, 86),
      sharedSecret: ua.computeSecret(b.subarray(21, 86)),
      salt: b.subarray(0, 16),
    });
    const sealed = b.subarray(86);
    const d = createDecipheriv("aes-128-gcm", cek, nonce);
    d.setAuthTag(sealed.subarray(sealed.length - 16));
    const opened = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
    expect(opened.subarray(0, opened.length - 1).toString()).toBe(RFC.plaintext);
    expect(opened[opened.length - 1]).toBe(0x02); // the final-record delimiter, not 0x01
  });

  it("uses a fresh salt and a fresh key every time, so two sends never repeat a nonce", () => {
    const args = { plaintext: Buffer.from("hello"), uaPublicKey: b64(RFC.uaPublic), authSecret: b64(RFC.authSecret) };
    const a = encryptPayload(args);
    const b = encryptPayload(args);
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false);
    expect(a.subarray(21, 86).equals(b.subarray(21, 86))).toBe(false);
  });
});

describe("the VAPID token that says the push is from us (RFC 8292)", () => {
  // A throwaway pair, so the test never depends on a real key.
  const pair = (() => {
    const e = createECDH("prime256v1");
    e.generateKeys();
    return { publicKey: e.getPublicKey().toString("base64url"), privateKey: e.getPrivateKey().toString("base64url") };
  })();

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
    const jwt = /t=([^,]+)/.exec(header())![1];
    const [h, p, sig] = jwt.split(".");
    expect(Buffer.from(sig, "base64url")).toHaveLength(64);
    const spki = Buffer.concat([
      Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"),
      Buffer.from(pair.publicKey, "base64url"),
    ]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    expect(cryptoVerify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("expires, so a stolen token is not good forever", () => {
    const far = vapidAuthHeader({
      audience: "https://x.example", subject: "mailto:ops@nbcc.scot",
      publicKey: pair.publicKey, privateKey: pair.privateKey, now: new Date("2026-11-12T00:00:00Z"),
    });
    const claims = JSON.parse(Buffer.from(/t=([^,]+)/.exec(far)![1].split(".")[1], "base64url").toString());
    expect(claims.exp - Math.floor(Date.parse("2026-11-12T00:00:00Z") / 1000)).toBeLessThanOrEqual(24 * 60 * 60);
  });
});

describe("telling a gone subscription from a wobble", () => {
  it.each([404, 410])("drops the subscription on %i", (statusCode) => {
    expect(subscriptionIsDead({ statusCode })).toBe(true);
  });

  it.each([400, 429, 500, 503])("keeps it on %i", (statusCode) => {
    expect(subscriptionIsDead({ statusCode })).toBe(false);
  });

  it("keeps it when the send failed with no status at all, such as a dropped connection", () => {
    expect(subscriptionIsDead({})).toBe(false);
  });
});
