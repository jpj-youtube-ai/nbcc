import { Router, type Request, type Response } from "express";
import { verifyThankYouLetterToken, LetterTokenError } from "../thank-you/letter-token";
import { getThankYouSentById } from "../db/thank-you";
import { buildThankYouLetterPage } from "../thank-you/letter-page";
import { letterNoticePage } from "../thank-you/letter-notice";
import { pageFailed, sendSitePage } from "../site/chrome";
import { config } from "../config";

// Public printable thank-you letter page (TASK-165/REQ-069). A thank-you email links to
// `${PORTAL_BASE_URL}/thank-you/letter/<token>`; the token is a stateless HMAC of the sent-letter id
// (signed with ADMIN_SESSION_SECRET), so a letter — which carries a donor's name, gift and personal
// message — can't be enumerated by guessing ids. A valid token renders the letter as a print-ready
// A4 page; an invalid token → 400, and a valid token for a deleted/missing row → 404.
//
// TASK-615: those two answers are pages of the site, with its banner and footer
// (src/thank-you/letter-notice.ts), sent as every page goes out. The letter stays a sheet to print.
export const thankYouLetterRouter = Router();

thankYouLetterRouter.get("/thank-you/letter/:token", async (req: Request, res: Response) => {
  try {
    let sentId: number;
    try {
      sentId = verifyThankYouLetterToken(req.params.token, config.ADMIN_SESSION_SECRET);
    } catch (err) {
      if (err instanceof LetterTokenError) {
        await sendSitePage(req, res.status(400), letterNoticePage("This letter link is not valid."));
        return;
      }
      throw err;
    }
    const letter = await getThankYouSentById(sentId);
    if (!letter) {
      await sendSitePage(req, res.status(404), letterNoticePage("This letter could not be found."));
      return;
    }
    res.status(200).type("html").send(buildThankYouLetterPage(letter));
  } catch (err) {
    pageFailed(res, "thank you letter", err);
  }
});
