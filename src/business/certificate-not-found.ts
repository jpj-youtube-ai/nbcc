import { noticePage } from "../site/notice-page";

// What a Platinum certificate's link answers when there is no certificate to show (src/routes/
// business.ts): one answer for every case, so a token that is not eligible cannot be told apart from
// one that does not exist. A page of the site, with its banner and footer (TASK-615); the certificate
// itself is a sheet to print (src/business/certificate.ts). The words are as they were.

/** The page. */
export function certificateNotFoundPage(): string {
  return noticePage({
    title: "Certificate | Night Before Christmas Campaign",
    body: "<h1>Certificate not found</h1><p>This certificate link is not valid.</p>",
  });
}
