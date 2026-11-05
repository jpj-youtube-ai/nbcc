import { config } from "../config";
import { sendElfSignInCode } from "../clients/email";
import { activeFamilyByEmail, saveElfSignInCode } from "../db/elf";
import { SIGN_IN_CODE_TTL_MS, hashSignInCode, newSignInCode } from "../fundraising/sign-in";
import { buildElfSignInCodeEmail } from "./emails";

// NBCC Elf Detective School: emailing a family a sign in code. The sign in page asks for one
// (src/routes/elf.ts), and so can a head elf for a family who cannot sign in (Head Elf HQ,
// src/routes/admin-elf.ts). Moved here from src/routes/elf.ts so both use the one sender.

/** Email a sign in code, but only to a family that has paid for detectives and has not been removed.
 *  Never throws. */
export async function sendSignInCodeTo(email: string): Promise<void> {
  try {
    const family = await activeFamilyByEmail(email);
    if (!family) return;
    const code = newSignInCode();
    await saveElfSignInCode(email, hashSignInCode(email, code, config.ADMIN_SESSION_SECRET), new Date(Date.now() + SIGN_IN_CODE_TTL_MS));
    const mail = buildElfSignInCodeEmail(code);
    await sendElfSignInCode(family.grownUpName, { email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
  } catch (err) {
    console.error("elf sign in code request failed:", err instanceof Error ? err.message : err);
  }
}
