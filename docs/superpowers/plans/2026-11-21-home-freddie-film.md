# Freddie's film on the home page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freddie's film, with a new "Fill a bag" end slate, plays at the top of the home page.

**Architecture:** The film is re-cut with ffmpeg (the Ball slate from 1:35.64 replaced by a new 8 second slate built from transparent layers drawn as HTML in the site's fonts). The home page gains a film section above the hero, served as part of `index.html`, driven by a small script of its own, with the Get involved film (`src/fundraising/film.ts`, `assets/js/…`) as the pattern.

**Tech Stack:** ffmpeg 9.1 (gyan.dev build, checksum checked), headless Edge for the layer drawings, the site's static HTML/CSS/JS, Vitest (jsdom) for the page script.

**Spec:** `docs/superpowers/specs/2026-11-21-home-freddie-film-design.md`

## Global Constraints

- The master `Freddie Sequence 1080p Ball.mp4` (1920x1080, 25 fps, 103.64 s, AAC 48 kHz stereo) is never changed. The cut is at 95.64 s (first slate frame); the slate runs 8.00 s to the end.
- New slate copy, exactly: "NIGHT BEFORE CHRISTMAS CAMPAIGN", headline "Fill a bag", button "nbcc.scot/fill". Colours: cream #F8F5EE, maroon #800000. Logo: `assets/img/nbcc-logo-full.svg`.
- Web copy under 20 MB, H.264 + AAC, `+faststart`, served under a new name in `assets/video/` (cached a week).
- Captions: the SRT corrected ("Big tyres", "wee boy", "Night Before Christmas Campaign", "Red Bag Full of Joy").
- Page copy: "Our new animated film", "Watch Freddie's story", "Based on a true story."; buttons "Tap for sound", "Fill a bag" (to `/fill`), "Watch again". No dashes between words.
- Starts muted with captions; never autoplays with `prefers-reduced-motion: reduce` or Save-Data; later visits wait for a tap. Plays once.
- The site's banner and footer stay (TASK-615 guard); the home page's first paint budget (`test/unit/perf-budget.test.ts`) still passes: the film is `preload="none"`/`metadata`, its still is the only image it adds to first paint.

## Review Focus

- A phone in low power mode refuses autoplay even when muted: the still and a big play button must show, never a blank box.
- "Tap for sound" pressed while the film is mid way: sound on from the beginning, captions stay available.
- The film fails to load (offline, blocked): the still stays, the page below works.
- A keyboard user: every control reachable and labelled; the end buttons take focus.
- Narrow phones (320px): the frame, the heading and the controls fit with no sideways scroll.

---

### Task 1: The new end slate and the re-cut film

**Files:**
- Create (scratchpad, not the repo): `slate/slate.html`, `slate/*.png`, `slate/slate.mp4`
- Create: `assets/video/freddie-film.mp4`, `assets/video/freddie-film-poster.jpg`, `assets/video/freddie-film.en.vtt`
- Create (OneDrive, beside the master): `Freddie Sequence 1080p Fill a bag.mp4`

- [ ] Draw the slate as HTML at 1920x1080 in the site's fonts, one layer per part (background and border, the capitals line, headline, button, logo), each captured on a transparent background; compare the full slate side by side with `NBCC_thank_you_slate_1080p.png`.
- [ ] Animate in the original's order (border, capitals line, headline, button, then the logo), 8.00 s at 25 fps.
- [ ] Join film 0 to 95.64 s with the slate, keeping the original sound throughout; write the high quality master to OneDrive and the web copy; check duration 103.64 s, the cut frame, and size under 20 MB.
- [ ] Write the corrected captions as WebVTT; a still from the film for before it plays.

### Task 2: The home page film

**Files:**
- Modify: `index.html` (a film section above the hero)
- Create: `assets/js/home-film.js`, styles in the head of `index.html` or `assets/css/home-film.css`
- Test: `test/unit/home-film.test.ts` (page markup), `test/unit/home-film-script.test.ts` (jsdom)

- [ ] Tests first: the section with the three lines of copy, a `<video muted playsinline preload>` with the poster, the captions track (`default`), Tap for sound, pause, the end panel with Fill a bag (`/fill`) and Watch again, all hidden or shown as the spec says; the script starts it only when allowed, Tap for sound unmutes and restarts at 0, ended shows the end panel and focuses Fill a bag, Watch again replays, a failed play shows the play button, later visits do not autoplay.
- [ ] Build the section and script to pass them; check every page test and the perf budget.
- [ ] Check in a browser at 320, 375, 768, 1280 px; pictures to Jaimie.

### Task 3: Ship

- [ ] README section; PR; CI; an independent review; Jaimie's yes on the pictures; merge on green; check the live page and the film file by GET.
