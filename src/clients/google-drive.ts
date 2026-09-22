import { createSign } from "node:crypto";

// TASK-423: uploading the nightly backup archive to Google Drive.
//
// Deliberately no `googleapis` dependency. A service-account access token is obtained by signing a
// JWT with the account's own private key, which is thirty lines of node:crypto, and the runtime
// image is `npm ci --omit=dev` so every runtime dependency ships in it forever.
//
// Scope is drive.file, NOT drive: it grants access only to files this service account itself
// created. A leaked key therefore cannot read the rest of the charity's Drive.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export type ServiceAccount = { clientEmail: string; privateKeyPem: string };

/**
 * Read the service-account JSON that was pasted into SSM by hand.
 *
 * Every failure here is a paste error, and each one gets a sentence rather than a stack trace:
 * this runs unattended at 2am, and "Unexpected token o in JSON" at the top of a log nobody is
 * reading is how a backup stays broken for months.
 */
export function parseServiceAccount(raw: string): ServiceAccount {
  if (!raw || !raw.trim()) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not set. Paste the service account key JSON into the SSM parameter.",
    );
  }

  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole downloaded key file, including the outer braces.",
    );
  }

  if (!parsed.client_email) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON has no client_email.");
  if (!parsed.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON has no private_key.");

  // The usual paste injury: the PEM's newlines arrive as the two characters backslash and n, so
  // the key is a single line and signing fails with an unhelpful OpenSSL error.
  const privateKeyPem = parsed.private_key.includes("\\n")
    ? parsed.private_key.replace(/\\n/g, "\n")
    : parsed.private_key;

  return { clientEmail: parsed.client_email, privateKeyPem };
}

export type AssertionOptions = ServiceAccount & {
  now: number;
  /**
   * The user to act as.
   *
   * Required when the destination is an ordinary Drive folder: a service account has no storage
   * quota of its own, so Drive rejects a file it would own. Omitted when the destination is a
   * Shared Drive, which owns its files itself. Getting this wrong fails only against the live API,
   * never locally, which is why it is covered by a test.
   */
  impersonate?: string;
};

export function buildAssertion(opts: AssertionOptions): string {
  const iat = Math.floor(opts.now / 1000);
  const claims: Record<string, unknown> = {
    iss: opts.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  if (opts.impersonate) claims.sub = opts.impersonate;

  const signingInput = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  return `${signingInput}.${signer.sign(opts.privateKeyPem, "base64url")}`;
}

export async function getAccessToken(opts: AssertionOptions): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(opts),
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).access_token as string;
}

export type UploadOptions = {
  accessToken: string;
  folderId: string;
  name: string;
  body: Buffer;
  /** true when folderId is, or lives inside, a Shared Drive. */
  sharedDrive: boolean;
};

/** Upload one file into the backup folder. Returns the new Drive file id. */
export async function uploadFile(opts: UploadOptions): Promise<string> {
  const boundary = `nbcc-${Date.now()}`;
  const metadata = JSON.stringify({ name: opts.name, parents: [opts.folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    ),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    opts.body,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  if (opts.sharedDrive) url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.accessToken}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id as string;
}
