// Elf Detective School's own short film, on its front page (src/elf/pages/calendar.ts). TASK-616.
//
// What NBCC decided (Jaimie, 11 November 2026: "make it autoplay when they arrive"):
//   - it sits near the top of the front page, after the title and its opening words, on December's
//     doors on and off, in the paper look: a photo taped to the page (.elf-film in assets/css/elf.css);
//   - it plays by itself when people arrive, without sound (no browser allows anything else), once and
//     no more, with the browser's own controls, and a clear paper button, "Turn the sound on", that
//     unmutes, hands focus to the film and then goes away (assets/js/elf-film.js);
//   - the script is the only thing that starts it: the video has no autoplay attribute. Anyone who has
//     asked for less motion, or to save data, sees the poster and a play button, and the film is never
//     started for them. The video is preload="metadata", so until it plays (or the script plays it) a
//     browser asks only for the start of the file, where its index is, and no pictures;
//   - while it plays it waits whenever it is scrolled fully out of view, and never starts again once it
//     has ended or once the person has paused it.
//
// The Get involved film (src/fundraising/film.ts) is the house pattern: a poster picture and an mp4
// served from /assets/video, which the site keeps in the visitor's browser for a week (assetHeaders,
// src/routes/site.ts). A film is replaced by shipping a NEW file name for that reason.
//
// Captions: there are none yet. When the charity sends the words, add a captions file next to the film,
// assets/video/elf-detective-school.en.vtt, and a <track kind="captions" srclang="en" label="English"
// src="/assets/video/elf-detective-school.en.vtt" default /> inside the video below, as the Get involved
// film has (assets/video/get-involved-film.en.vtt). The README says so too.

export const ELF_FILM_SRC = "/assets/video/elf-detective-school.mp4";
export const ELF_FILM_POSTER = "/assets/video/elf-detective-school-poster.jpg";
export const ELF_FILM_NAME = "Elf Detective School, a short film";
export const ELF_FILM_SOUND = "Turn the sound on";

/** The film in its paper frame. With no script it is a plain muted player: the browser plays it by
 *  itself and its own controls turn the sound on. */
export function elfFilm(): string {
  return (
    `<figure class="elf-frame elf-film" data-elf-film>` +
    `<span class="elf-tape" aria-hidden="true"></span>` +
    `<div class="elf-film__stage">` +
    `<video class="elf-film__video" id="elf-film-video" data-elf-film-video muted playsinline controls preload="metadata" width="1920" height="1080" ` +
    `poster="${ELF_FILM_POSTER}" aria-label="${ELF_FILM_NAME}">` +
    `<source src="${ELF_FILM_SRC}" type="video/mp4" />` +
    `</video>` +
    `<button class="elf-btn elf-btn--crimson" type="button" data-elf-film-sound hidden>${ELF_FILM_SOUND}</button>` +
    `</div>` +
    `</figure>`
  );
}
