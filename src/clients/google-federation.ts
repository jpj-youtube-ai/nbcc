import { signRequest, type AwsCredentials } from "./aws-sigv4";

// TASK-423: getting a Google access token from AWS without a key.
//
// The original plan was a downloaded service-account key. Google refused: the organisation
// enforces iam.disableServiceAccountKeyCreation, which is on by default for newer organisations
// because a downloaded key is a permanent password sitting in a file, and those get committed,
// emailed and left on laptops.
//
// Workload Identity Federation is the better answer anyway. Google is told to trust exactly one
// AWS role. Each night the backup job signs a GetCallerIdentity call with its ECS task-role
// credentials, Google replays that to AWS to check it, and issues a token good for under an hour.
// There is no key: nothing to store in SSM, nothing to rotate, nothing to leak. It reuses the
// SigV4 signer this repo already has for SES (src/clients/aws-sigv4.ts).
//
// Flow: sign STS GetCallerIdentity -> exchange at sts.googleapis.com for a federated token ->
// exchange that at iamcredentials.googleapis.com for the service account's own access token.

/** Binds a signed AWS request to one specific Google pool, so it cannot be replayed at another. */
export const STS_TARGET_HEADER = "x-goog-cloud-target-resource";

const AWS_STS_URL = "https://sts.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15";
const GOOGLE_STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS = "https://iamcredentials.googleapis.com/v1";

export type PoolRef = { projectNumber: string; poolId: string; providerId: string };

/** The pool that is allowed to vouch for us. Google matches the signed request against this. */
export function federationAudience(ref: PoolRef): string {
  return (
    `//iam.googleapis.com/projects/${ref.projectNumber}` +
    `/locations/global/workloadIdentityPools/${ref.poolId}/providers/${ref.providerId}`
  );
}

/**
 * The single AWS identity Google will trust, as granted in the console.
 *
 * This is the whole security boundary, which is why it is built here and asserted in a test
 * rather than typed into a console field and hoped for. It names one assumed role in one AWS
 * account: a different role, a different account, or a developer's laptop cannot present it.
 */
export function workloadIdentityPrincipal(opts: {
  projectNumber: string;
  poolId: string;
  awsAccountId: string;
  roleName: string;
}): string {
  return (
    `principalSet://iam.googleapis.com/projects/${opts.projectNumber}` +
    `/locations/global/workloadIdentityPools/${opts.poolId}` +
    `/attribute.aws_role/arn:aws:sts::${opts.awsAccountId}:assumed-role/${opts.roleName}`
  );
}

/**
 * Package a signed AWS request into the token Google expects.
 *
 * Google wants the whole request described as JSON, with headers as a LIST of {key, value} rather
 * than an object, then URL-encoded into one opaque string. Getting the shape wrong fails only
 * against the live API.
 */
export function buildSubjectToken(opts: {
  url: string;
  method: string;
  signedHeaders: Record<string, string>;
}): string {
  if (!opts.signedHeaders[STS_TARGET_HEADER]) {
    // Refusing here rather than sending it: without this header the signature is valid for any
    // pool, so a leaked request could be replayed against someone else's Google project.
    throw new Error(
      `refusing to build a subject token without ${STS_TARGET_HEADER}: it is what binds the signature to our workload identity pool`,
    );
  }
  return encodeURIComponent(
    JSON.stringify({
      url: opts.url,
      method: opts.method,
      headers: Object.entries(opts.signedHeaders).map(([key, value]) => ({ key, value })),
    }),
  );
}

/** Sign GetCallerIdentity with the task role, so Google can ask AWS who we are. */
export function signCallerIdentity(opts: {
  credentials: AwsCredentials;
  audience: string;
  now?: Date;
}): { url: string; method: string; signedHeaders: Record<string, string> } {
  const signedHeaders = signRequest({
    method: "POST",
    url: AWS_STS_URL,
    headers: { [STS_TARGET_HEADER]: opts.audience },
    body: "",
    region: "us-east-1", // the global STS endpoint is signed as us-east-1 regardless of where we run
    service: "sts",
    credentials: opts.credentials,
    now: opts.now,
  });
  return { url: AWS_STS_URL, method: "POST", signedHeaders };
}

/** Swap the signed AWS request for a short-lived Google federated token. */
export async function exchangeForFederatedToken(opts: {
  audience: string;
  subjectToken: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(GOOGLE_STS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audience: opts.audience,
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      subjectTokenType: "urn:ietf:params:aws:token-type:aws4_request",
      subjectToken: opts.subjectToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).access_token as string;
}

/**
 * Swap the federated token for the service account's own token, scoped to drive.file.
 *
 * drive.file, not drive: the token can only touch files this service account itself created, so
 * even a stolen token cannot read the rest of the charity's Drive.
 */
export async function impersonateServiceAccount(opts: {
  federatedToken: string;
  serviceAccountEmail: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${IAM_CREDENTIALS}/projects/-/serviceAccounts/${opts.serviceAccountEmail}:generateAccessToken`;
  const res = await doFetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.federatedToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      scope: ["https://www.googleapis.com/auth/drive.file"],
      lifetime: "3600s",
    }),
  });
  if (!res.ok) {
    throw new Error(`Service account impersonation failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).accessToken as string;
}
