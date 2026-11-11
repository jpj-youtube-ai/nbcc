import { config } from "../config";
import { smsConfigured } from "../clients/sms";

// NBCC Elf Detective School wave 2: whether an alert tries its texts. One rule, asked by the worker's photo
// alert (src/elf/worker.ts) and by the test alert (src/routes/admin-elf.ts), so the two never disagree.
// Unit tested in test/unit/elf-texts-on.test.ts.

/** Texts are tried once they are switched on (SMS_PROVIDER=sns), and outside production, where the text
 *  client sends nothing (it stubs). In production with texts off, no text is tried. Read when asked, never
 *  when this file loads. */
export function elfTextsOn(): boolean {
  return smsConfigured || config.NODE_ENV !== "production";
}
