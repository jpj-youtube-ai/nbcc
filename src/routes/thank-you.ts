import { Router, type Request, type Response } from "express";
import { verifyThankYouLetterToken, LetterTokenError } from "../thank-you/letter-token";
import { getThankYouSentById } from "../db/thank-you";
import { buildThankYouLetterPage } from "../thank-you/letter-page";
import { config } from "../config";

// Public printable thank-you letter page (TASK-165/REQ-069). A thank-you email links to
// `${PORTAL_BASE_URL}/thank-you/letter/<token>`; the token is a stateless HMAC of the sent-letter id
// (signed with ADMIN_SESSION_SECRET), so a letter — which carries a donor's name, gift and personal
// message — can't be enumerated by guessing ids. A valid token renders the letter as a print-ready
// A4 page; an invalid token → 400, and a valid token for a deleted/missing row → 404.
export const thankYouLetterRouter = Router();

function notice(status: number, message: string): (res: Response) => Response {
  return (res) =>
    res
      .status(status)
      .type("html")
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thank-you letter | NBCC</title></head>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>Thank-you letter</h1><p>${message}</p></body></html>`,
      );
}

thankYouLetterRouter.get("/thank-you/letter/:token", async (req: Request, res: Response) => {
  let sentId: number;
  try {
    sentId = verifyThankYouLetterToken(req.params.token, config.ADMIN_SESSION_SECRET);
  } catch (err) {
    if (err instanceof LetterTokenError) {
      return notice(400, "This letter link is not valid.")(res);
    }
    throw err;
  }
  const letter = await getThankYouSentById(sentId);
  if (!letter) return notice(404, "This letter could not be found.")(res);
  return res.status(200).type("html").send(buildThankYouLetterPage(letter));
});
