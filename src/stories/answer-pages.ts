import { noticePage } from "../site/notice-page";

// What the Share your story form answers when a browser sends it without JavaScript (POST /api/my-story,
// src/routes/api.ts): the thank you, and the three ways it can be turned back. Pages of the site, with
// its banner and footer (TASK-615). The words are as they were; the thank you keeps its narrow, centred
// look.

/** The thank you, with the way back to the home page. */
export function storyThanksPage(): string {
  return noticePage({
    title: "Thank you | Night Before Christmas Campaign",
    className: "my-story-thanks",
    centred: true,
    body: '<h1>Thank you</h1>\n<p>Your story becomes part of ours.</p>\n<p><a href="/">Back to the home page</a></p>',
  });
}

/** Something the form needs was missing or not right. */
export function storyCheckPage(): string {
  return noticePage({
    title: "Please check your details",
    body: "<h1>Please check your details</h1><p>Some required details were missing or invalid. Please go back and try again.</p>",
  });
}

/** Too many stories from one connection in a short while. */
export function storyTooManyPage(): string {
  return noticePage({
    title: "Please try again later",
    body: "<h1>Please try again later</h1><p>Too many submissions from this connection. Please try again later.</p>",
  });
}

/** The story could not be saved. */
export function storyFailedPage(): string {
  return noticePage({
    title: "Something went wrong",
    body: "<h1>Something went wrong</h1><p>We could not save your story right now. Please try again later.</p>",
  });
}
