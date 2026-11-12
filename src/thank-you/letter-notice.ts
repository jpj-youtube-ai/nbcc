import { noticePage } from "../site/notice-page";

// What a thank you letter's link answers when it cannot show the letter (src/routes/thank-you.ts): the
// link is not valid, or the letter is gone. A page of the site, with its banner and footer (TASK-615);
// the letter itself is a sheet to print (src/thank-you/letter-page.ts). The words are as they were.

/** The page, saying `message`, which is the route's own fixed words. */
export function letterNoticePage(message: string): string {
  return noticePage({ title: "Thank-you letter | NBCC", body: `<h1>Thank-you letter</h1><p>${message}</p>` });
}
