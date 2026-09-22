import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { buildAssertion, parseServiceAccount } from "../../src/clients/google-drive";

// TASK-423. Google issues an access token in exchange for a JWT the service account signs itself.
// That is thirty lines of node:crypto, so this avoids taking on the googleapis dependency: the
// runtime image is `npm ci --omit=dev` and every runtime dependency ships in it forever.

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const NOW = Date.parse("2026-09-22T02:00:00.000Z");
const CLIENT = "nbcc-backup-writer@nbcc-backups.iam.gserviceaccount.com";

const claimsOf = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

describe("the assertion Google exchanges for an access token", () => {
  it("is signed so Google can verify it with the matching public key", () => {
    const jwt = buildAssertion({ clientEmail: CLIENT, privateKeyPem: PEM, now: NOW });
    const [header, payload, signature] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  // drive.file grants access only to files this service account created. A key that leaked could
  // not then read the rest of the charity's Drive, which plain `drive` would have allowed.
  it("asks for the narrow drive.file scope, never full Drive access", () => {
    const claims = claimsOf(buildAssertion({ clientEmail: CLIENT, privateKeyPem: PEM, now: NOW }));
    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive.file");
  });

  it("expires within the hour Google allows", () => {
    const claims = claimsOf(buildAssertion({ clientEmail: CLIENT, privateKeyPem: PEM, now: NOW }));
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
    expect(claims.iat).toBe(Math.floor(NOW / 1000));
  });

  // A service account has no Drive storage quota of its own, so a file it owns in an ordinary
  // folder is rejected. On a Workspace edition without Shared Drives it must therefore act AS a
  // real user, which is the `sub` claim. Getting this wrong fails only against the live API.
  it("acts as a real user when one is configured, and does not when it is not", () => {
    const delegated = buildAssertion({
      clientEmail: CLIENT,
      privateKeyPem: PEM,
      now: NOW,
      impersonate: "backups@nbcc.scot",
    });
    expect(claimsOf(delegated).sub).toBe("backups@nbcc.scot");

    const shared = buildAssertion({ clientEmail: CLIENT, privateKeyPem: PEM, now: NOW });
    expect(claimsOf(shared).sub).toBeUndefined();
  });
});

describe("reading the service account key file", () => {
  const KEY = JSON.stringify({
    type: "service_account",
    client_email: CLIENT,
    private_key: PEM,
    project_id: "nbcc-backups",
  });

  it("pulls out the two fields that matter", () => {
    const sa = parseServiceAccount(KEY);
    expect(sa.clientEmail).toBe(CLIENT);
    expect(sa.privateKeyPem).toBe(PEM);
  });

  // The key is pasted into SSM by hand. Every way that goes wrong should fail at startup with a
  // sentence explaining it, not at 2am with a stack trace nobody reads.
  it("refuses an empty value rather than failing at 2am", () => {
    expect(() => parseServiceAccount("")).toThrow(/not set|empty/i);
  });

  it("refuses something that is not JSON, and says so", () => {
    expect(() => parseServiceAccount("{oops")).toThrow(/not valid JSON/i);
  });

  it("refuses JSON that is missing the key material", () => {
    expect(() => parseServiceAccount(JSON.stringify({ client_email: CLIENT }))).toThrow(
      /private_key/,
    );
  });

  // A real, common paste error: the newlines in the PEM arrive as the two characters \ and n.
  it("repairs escaped newlines in the private key, which is how pasting usually breaks it", () => {
    const mangled = JSON.stringify({ client_email: CLIENT, private_key: PEM }).replace(
      /\\n/g,
      "\\\\n",
    );
    expect(parseServiceAccount(mangled).privateKeyPem).toBe(PEM);
  });
});
