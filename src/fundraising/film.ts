// The one minute film on Get involved ("Got an idea?"), shown only while fundraising is switched
// on: the film is about fundraising for NBCC, and with fundraising off the page says nothing of it.
//
// What NBCC decided (Jaimie, 2026-10-06):
//   - a first visit: full size above the cards, playing by itself with the sound OFF (no browser
//     allows anything else), captions showing, and a "Play with sound" button on it;
//   - any later visit: a slim strip in the same place, "Watch our one minute film", so the events
//     are seen straight away. Pressing it opens the film there and plays it with sound.
//
// Which of the two is decided before the page is drawn, by FILM_HEAD below, so nobody sees the film
// appear and then fold away. The rest is assets/js/events.js (initFilm) and assets/css/events.css.
// "Seen" is one note in the visitor's own browser (local storage, key nbcc-film-seen). It is not a
// cookie and it is never sent to the server. privacy.html says so.
//
// The film is a 13 MB file, so it is replaced by shipping a NEW file name: the browser keeps
// anything in /assets/video for a week (assetHeaders, src/routes/site.ts).

export const FILM_HEAD_MARKER = "<!-- getinvolved:film-head -->";
export const FILM_MARKER = "<!-- getinvolved:film -->";

/**
 * Runs in the head, before anything is drawn. A browser with no note is a first visit, as long as
 * a note can be written (or every visit would be a first visit); anything else is a later one,
 * including a browser with storage switched off.
 */
export const FILM_HEAD =
  '<script>(function(c,k){try{if(localStorage.getItem(k)===null){localStorage.setItem(k+"-t","1");' +
  'localStorage.removeItem(k+"-t");c="film-first"}}catch(e){}document.documentElement.classList.add(c)})' +
  '("film-later","nbcc-film-seen")</script>';

/** The voice-over, word for word as NBCC supplied it. The captions file says the same. */
export const FILM_LINES = [
  "Got an idea that could raise money for NBCC?",
  "Good. Because fundraising for NBCC just got easier.",
  "A sponsored walk. A bake sale. A quiz night. Whatever you have in mind.",
  "Raise money your way, and we will help. With your own page, posters, a bucket, and more.",
  "Start at nbcc.scot/get-involved.",
  "It takes a few minutes. Tell us what you're planning.",
  "Give it a name.",
  "Set a target, if you'd like one. Say what would help.",
  "Check it, and send it.",
  "Putting on an event? We can list it. You can even ask us along.",
  "A real person reads every sign up, and gets in touch.",
  "Once it's a yes, your page is live.",
  "Share it. Print your QR code. And watch it add up.",
  "It all helps children, young people and vulnerable adults across South West Scotland.",
  "So. Got an idea? Let's make it happen.",
  "nbcc.scot/get-involved",
  "NBCC. Here all year.",
];

const PLAY_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

// Without JavaScript this is a plain player: the still (a background of the frame, in events.css),
// the browser's own controls, captions, and the words underneath. The video has no poster of its
// own so that a folded away film asks for no big picture; events.js gives it one when it shows.
export const FILM_SECTION =
  '<section class="gi-film" aria-labelledby="film-heading" data-film>' +
  '<div class="wrap">' +
  '<h2 class="sr-only" id="film-heading">Our one minute film</h2>' +
  '<button class="gi-film__strip" type="button" data-film-open>' +
  '<span class="gi-film__thumb">' +
  '<img src="/assets/video/get-involved-film-thumb.jpg" alt="" width="96" height="54" loading="lazy" />' +
  `<span class="gi-film__badge">${PLAY_ICON}</span>` +
  "</span>" +
  '<span class="gi-film__strip-words">Watch our one minute film</span>' +
  "</button>" +
  '<div class="gi-film__player" data-film-player>' +
  '<div class="gi-film__frame">' +
  '<video class="gi-film__video" data-film-video controls playsinline preload="none" width="1920" height="1080" ' +
  'data-poster="/assets/video/get-involved-film-poster.jpg" ' +
  'aria-label="Got an idea? Our one minute film about fundraising for NBCC">' +
  '<source src="/assets/video/get-involved-film.mp4" type="video/mp4" />' +
  '<track kind="captions" srclang="en" label="English" src="/assets/video/get-involved-film.en.vtt" default />' +
  "</video>" +
  `<button class="btn btn-primary gi-film__sound" type="button" data-film-sound hidden>${PLAY_ICON}<span data-film-sound-words>Play with sound</span></button>` +
  "</div>" +
  '<p class="gi-film__close-row"><button class="gi-film__close" type="button" data-film-close>Close the film</button></p>' +
  "</div>" +
  '<details class="gi-film__words">' +
  "<summary>Read what the film says</summary>" +
  '<div class="gi-film__lines">' +
  FILM_LINES.map((line) => `<p>${line.replace(/'/g, "&#39;")}</p>`).join("") +
  "</div>" +
  "</details>" +
  "</div>" +
  "</section>";
