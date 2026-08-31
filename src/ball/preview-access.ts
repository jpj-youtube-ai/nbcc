import { getPreviewPasswordHash } from "../db/ball";
import { config } from "../config";
import { GATE_COOKIE, readCookie, verifyGateToken } from "./gate";

// TASK-320: the single answer to "is this request allowed to see the ball before launch?"
//
// Two places now ask it — /ball itself, and the home page, which shows the promotion band to
// anyone holding a preview cookie so staff can see what the front page will look like on
// launch morning WITHOUT publishing it to the world. That is exactly the kind of question
// that must have one implementation: two copies drift, and the copy that drifts leniently
// leaks an unannounced event.

// The gate's secret. Once staff set a password in the admin area we use its hash — for BOTH
// checking the password and signing the preview cookie. Signing with the hash means changing
// the password immediately invalidates every cookie issued under the old one, which is what
// someone changing a shared password expects: it should lock out whoever they changed it
// because of. Falls back to the config value until a password has been set.
export async function previewSecret(): Promise<{ hash: string | null; signingKey: string }> {
  const hash = await getPreviewPasswordHash();
  return { hash, signingKey: hash ?? config.BALL_PREVIEW_PASSWORD };
}

// Does this request carry a preview cookie we actually issued and that has not expired?
//
// Fails CLOSED. A missing cookie, a forged one, an expired one, or an error reading the
// password hash all return false, because the cost of the two answers is not symmetric:
// wrongly saying yes announces an event The Designer Rooms has not announced yet, while
// wrongly saying no means a member of staff types the password again.
export async function holdsPreviewCookie(cookieHeader: string | undefined): Promise<boolean> {
  const cookie = readCookie(cookieHeader, GATE_COOKIE);
  if (!cookie) return false;
  try {
    const { signingKey } = await previewSecret();
    return verifyGateToken(cookie, signingKey, new Date());
  } catch {
    return false;
  }
}
