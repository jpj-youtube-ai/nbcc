import { createHash, createHmac } from "node:crypto";

// AWS Signature Version 4 signing + credential resolution, dependency-free (TASK: Resend→SES
// migration). Hand-rolled on node:crypto rather than @aws-sdk/client-sesv2 on purpose: the npm
// registry is blocked on the owner's machine (see docs/NEWSLETTER-STATUS.md "npm registry is
// blocked"), so a new runtime dependency would leave local dev unable to boot the app at all —
// exactly the exceljs failure mode, but fatal. SigV4 is a stable, documented algorithm and the
// signer below is pinned to AWS's own published test vector in test/unit/aws-sigv4.test.ts.
//
// Everything here is PURE or dependency-injected (clock, fetch, env values) so it unit-tests
// without config, network, or AWS.

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s, "utf8").digest();

// RFC 3986 encoding — encodeURIComponent leaves !'()* alone, SigV4 does not.
const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignRequestOptions {
  method: string;
  url: string; // absolute URL; query string (if any) is read from here
  headers?: Record<string, string>; // extra headers to sign (e.g. content-type)
  body?: string; // empty string for GET
  region: string;
  service: string; // "ses" for the SESv2 API
  credentials: AwsCredentials;
  now?: Date; // injectable clock so the signature is reproducible under test
}

/**
 * Sign a request, returning the COMPLETE header map to send: the caller's headers plus host,
 * x-amz-date, x-amz-security-token (when the credentials are temporary — ECS task-role
 * credentials always are) and the authorization header itself.
 */
export function signRequest(opts: SignRequestOptions): Record<string, string> {
  const url = new URL(opts.url);
  const now = opts.now ?? new Date();
  // YYYYMMDDTHHMMSSZ — ISO with separators and milliseconds stripped.
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const body = opts.body ?? "";

  const headers: Record<string, string> = { host: url.host, "x-amz-date": amzDate };
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;
  if (opts.credentials.sessionToken) headers["x-amz-security-token"] = opts.credentials.sessionToken;

  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = signedNames.join(";");

  // Canonical query string: RFC 3986-encoded pairs, sorted by key then value.
  const pairs = [...url.searchParams.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)] as const);
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const canonicalQuery = pairs.map(([k, v]) => `${k}=${v}`).join("&");

  const canonicalRequest = [
    opts.method.toUpperCase(),
    url.pathname || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n");

  const scope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${opts.credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, opts.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Credential resolution. Two sources, in order:
//   1. Static env credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY [+ AWS_SESSION_TOKEN])
//      — local dev and one-off scripts.
//   2. The ECS container-credentials endpoint (169.254.170.2 + the relative URI Fargate injects)
//      — the task role, i.e. production. These rotate, so they are cached only until shortly
//      before their stated expiry.
// The env VALUES are passed in by the caller (src/clients/ses.ts reads them through src/config —
// golden rule 3: nothing outside the config module touches process.env).

export interface AwsCredentialEnv {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  containerCredentialsRelativeUri?: string;
}

// Refresh task-role credentials this long before AWS says they expire.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export function createCredentialProvider(
  env: AwsCredentialEnv,
  fetchImpl: typeof fetch = fetch,
  nowFn: () => number = Date.now,
): () => Promise<AwsCredentials> {
  let cached: { creds: AwsCredentials; refreshAfterMs: number | null } | null = null;

  return async function resolveAwsCredentials(): Promise<AwsCredentials> {
    if (cached && (cached.refreshAfterMs === null || nowFn() < cached.refreshAfterMs)) {
      return cached.creds;
    }

    if (env.accessKeyId && env.secretAccessKey) {
      cached = {
        creds: {
          accessKeyId: env.accessKeyId,
          secretAccessKey: env.secretAccessKey,
          ...(env.sessionToken ? { sessionToken: env.sessionToken } : {}),
        },
        refreshAfterMs: null, // static credentials never rotate
      };
      return cached.creds;
    }

    if (env.containerCredentialsRelativeUri) {
      const res = await fetchImpl(`http://169.254.170.2${env.containerCredentialsRelativeUri}`);
      if (!res.ok) throw new Error(`ECS credentials endpoint responded ${res.status}`);
      const data = (await res.json()) as {
        AccessKeyId?: string;
        SecretAccessKey?: string;
        Token?: string;
        Expiration?: string;
      };
      if (!data.AccessKeyId || !data.SecretAccessKey) {
        throw new Error("ECS credentials endpoint returned no keys");
      }
      const expiresMs = data.Expiration ? Date.parse(data.Expiration) : NaN;
      cached = {
        creds: {
          accessKeyId: data.AccessKeyId,
          secretAccessKey: data.SecretAccessKey,
          ...(data.Token ? { sessionToken: data.Token } : {}),
        },
        refreshAfterMs: Number.isFinite(expiresMs) ? expiresMs - EXPIRY_MARGIN_MS : null,
      };
      return cached.creds;
    }

    throw new Error(
      "No AWS credentials available (no static keys and no ECS credentials endpoint)",
    );
  };
}
