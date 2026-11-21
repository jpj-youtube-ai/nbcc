# Freddie's film at the top of the home page

Date: 21 November 2026. Asked for by Jaimie.

## Intent

Jaimie: put the new animated film (Freddie's story, about 1 minute 40, narrated) at the very top of
the home page, so it plays as soon as someone lands, framed as "watch our new animated film, based
on a true story". "We really want to pull on people's heartstrings right at the start." The film's
end slate, at present the Festive Ball's "Thank you for making it a night to remember", is replaced
by one in the same style that says **Fill a bag at nbcc.scot/fill**: what Jaimie wants people to do
next is fill a Red Bag.

## Goals

- The film is the first thing on the home page, big and framed, with Jaimie's line.
- It starts by itself on arrival.
- It ends on the new slate, and the page offers a real **Fill a bag** button at that moment.
- The film file still works on its own (to share on Facebook and elsewhere) with the new slate.

## Non goals

- No change to the rest of the home page: the Fill a Red Bag section and everything below stay as
  they are. The "Freddie's story" section further down stays too (it links to the written story).
- No change to the Get involved film.

## Anti goals (a failure even if it works)

- A page that is slow on a phone, or that eats someone's mobile data without a choice.
- Sound blaring at someone unasked (browsers forbid it anyway).
- Anything that makes it harder to reach Donate or Fill a Red Bag.

## Constraints

- No browser autoplays a film with sound. It starts silently, with captions on, and a large
  **Tap for sound** button.
- The master file is 250 MB at 1080p; the web copy must be about 10 to 20 MB.
- Video files are cached for a week (README), so the film ships under a new file name.
- Every page keeps the site's own banner and footer (TASK-615 guard).
- House style for words: no dashes between words; "Red Bag"; NBCC's own phrasing.

## Approaches

- **A. New slate in the film, plus a Fill a bag button on the page (chosen by Jaimie).** The film
  works anywhere it is shared; the website gets a one tap button over the last frame. Changing the
  slate wording later means re-making the film file.
- B. Cut the slate off and draw the ending on the page only. Easy to reword, but the shared film
  would have no ending.
- C. Only replace the slate in the film. Simplest, but nothing to tap on the website.

## The design

**The film file.** A new end slate is drawn in the same style as `NBCC_thank_you_slate_1080p.png`
(cream card, maroon rounded border, the elf logo, "NIGHT BEFORE CHRISTMAS CAMPAIGN" in spaced capitals,
the headline in Playfair Display, a maroon button shape): headline **Fill a bag**, button
**nbcc.scot/fill**. It replaces the Ball slate for the same length at the end of the film, with the
same fade in. The web copy is H.264 MP4 at 1080p (about 15 MB) with a still for before it loads.
The master stays untouched; a new 1080p master with the new slate is saved beside it in the same
OneDrive folder for sharing.

**Captions.** From the existing subtitles, corrected: "wee boy" (not "we boy"), "Night Before
Christmas Campaign" in capitals, "Red Bag Full of Joy", and the line read as "Big for you" which is
almost certainly "Big tyres" (Jaimie to confirm). Captions show while the film is silent and can be
turned off.

**The top of the home page.** The film takes the hero's place at the top: a small line "Our new
animated film", the heading **Watch Freddie's story**, and "Based on a true story." beside or above
a large framed player in the site's own look (the card style, a soft shadow, the gold ribbon touch
the page already uses). The current hero words and Donate button move just below the film.

```
 [ banner and menu as every page ]
 Our new animated film
 Watch Freddie's story          Based on a true story.
 +---------------------------------------------------+
 |                                                   |
 |        film playing, silent, captions on          |
 |                         [ Tap for sound ]  [ II ] |
 +---------------------------------------------------+
 You know us at Christmas. We're here all year.  [Donate now]
 [ Fill a Red Bag section, then the rest, as now ]
```

**How it behaves.** On arrival the film plays silently with captions. **Tap for sound** turns the
sound on and starts it again from the beginning, so the narration is heard from the start. There is
always a pause button. It plays once, not on a loop. When it ends, a **Fill a bag** button (to
`/fill`) and **Watch again** appear over the last frame. It does not start by itself for someone
whose phone or browser asks for less motion or to save data: they see the still with a big play
button. On later visits it still sits at the top, but waits for a tap rather than starting again
(as the Get involved film does).

## Left to the builder

The exact sizes and spacing at each width, the still frame chosen, the encoding settings within the
size target, and reusing the Get involved film's code (`src/fundraising/film.ts`) where it fits.
Pictures of the page on a phone and a computer, and the new slate, go to Jaimie before anything is
live.
