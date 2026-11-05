# Elf Detective School: the painted dress-up elf

Date: 3 November 2026. Decided with Jaimie Wakefield (NBCC) in conversation. Builds on
`2026-10-04-elf-detective-school-design.md` (the wardrobe, what unlocks when) and sits inside wave 1
(`docs/superpowers/plans/2026-11-03-elf-detective-wave1-sign-up.md`), which is on branch
`elf-detective-school` (draft PR jpj-youtube-ai/nbcc#711).

## Why

Every detective dresses an elf, and the elf is shown everywhere: the wardrobe, Detective HQ, emails,
the certificate and the share card. Today it is drawn in code from simple shapes. Next to the
school's logo (the painted elf in the deerstalker), it looks cheap. Jaimie's words for the failure
to avoid: **"if it looks cheap or clip art, not like our logo"**.

A restyle of the code drawing (thicker outlines, shading; local commit `993dfa00`, never pushed)
was shown and rejected: start from scratch. Shapes drawn in code cannot reach the painted look, so
the elf and every piece are now **painted by OpenAI** and layered.

## What Jaimie decided

1. **The elf is a brother or sister of the logo elf**, not the logo elf himself and not a new
   character: the same family look, full length and standing, so the whole outfit shows.
2. **Start from scratch.** Keep the wardrobe's ideas (the seven slots, every style, every outfit
   such as the reindeer, what each door unlocks), but every piece is designed and painted fresh.
3. **The face is chosen** ("Yes, this is her"). Plain round eyes with **no shine**, eyebrows sitting
   **just above** the eyes, a small smile, rosy cheeks, long pointed ears, a big round head. Every
   outline, and the eyes, eyebrows and smile, are the logo's **browny red** (sampled from the logo
   as `#52201E`; the chosen painting came out near `#6B191A`, which is what was approved).
4. **Painted in layers**, tried in a test first (done, see below), then a plan before painting the
   lot. Jaimie approves before anything is painted in bulk.
5. **Everything is painted and approved by Friday 13 November**, when sign ups open: every elf,
   every piece in every colour and every outfit, because the wardrobe shows locked pieces faintly
   from day one. (Offered instead: elves and starter kit first, the rest through November. Jaimie
   chose everything.) Nothing merges before Sunday 8 November (the Ball shares the Stripe webhook),
   so painting runs in parallel with that, and the merge carries the finished set.
6. **On the two darkest skin tones (s4 and s5), the eyes, eyebrows, smile and outline are a deeper
   shade of the same browny red**, so the face shows: the approved colour is only about 1.4 to 1
   against s5 and 2.5 to 1 against s4. Every other skin tone keeps the approved colour.
7. **Every elf wears red mittens, like the logo elf.** Hands are never bare skin, so a gadget held in
   the hand (torch, magnifying glass, notebook, lantern) and an outfit's props (mallet, bagpipes,
   scroll) are painted once and fit every elf. The master is repainted with mittens before anything
   else, and Jaimie sees it first.
8. **A brother or a sister, chosen separately** (Jaimie, 3 November 2026, after seeing that short hair
   alone reads as a brother: "Add brother or sister"). The wardrobe gains a new choice, `sibling`,
   `sister` or `brother`, and every hairstyle is open to both. The brother is painted from the
   sister (only his face and hair changed; Jaimie chose "Brother B", whose body differs from hers by
   under 1%), so every piece painted on her fits him. That makes **150 elves**: 2 by 5 skin tones by
   3 hairstyles by 5 hair colours. A new detective starts as a sister (my call: she is the master).
   The words on the page are "Boy or girl", "Girl" and "Boy" (Jaimie: "use boy and girl not brother and sister"); the ids stay sister and brother.

The approved base picture is the red haired sister in a cream top, red and cream striped tights and
cream socks, on flat magenta. It is kept, with the test pictures, in
`docs/superpowers/specs/assets/2026-11-03-elf-painted/` (to be copied there from the session
scratchpad when the build starts; file names in the "Test" section).

## How it works

### The canvas

Every painting is made on **one canvas** from **one master picture** (the approved sister), so every
layer lines up with every other. The test showed that asking OpenAI to change only the skin and
hair of the master keeps the body where it is (122 pixels changed below the waist out of about
600,000), while painting a new elf from words alone does not (the brother came out bigger).

Paintings are 1024 by 1536 on a flat magenta (`#FF00FF`) background, which is cut out to
transparent with soft edges and the pink spill removed (the test's `cut_out` does this). OpenAI's
current model (`gpt-image-2`) cannot paint on a transparent background itself.

### The layers

Drawn bottom to top, in the order the code uses today: the elf, shoes, top, extra, glasses, neck,
hat, gadget. An outfit replaces all of the clothes.

- **The elf: one painting for each sibling, skin tone, hairstyle and hair colour**: 2 by 5 by 3 by
  5, 150 paintings, each made from the sister or the brother master by changing only skin and hair. Builder's call whether hair is instead a layer of its own (fewer paintings), as long as it
  passes the same eye test as the rest.
- **Every piece, in every colour, painted by OpenAI.** The test showed that recolouring a painting
  in code comes out muddy. Each piece is painted onto the master elf, then painted again **on its own**
  in exactly the same place (everything else turned magenta), so it lifts off cleanly. The test
  showed that cutting a piece out by comparing pictures drags the elf's hair along with it. The
  second and third colours are painted from the first, so the design matches.
- **Hats must sit right on all three hairstyles.** A hat painted on short hair must not float above
  curly hair. Paint hats on the biggest hair, or check each hat on all three.
- **Every outfit is a layer over the elf**, with the face (and anything else meant to show, like
  the bunches poking out of the reindeer hood) left open, so one painting of an outfit works for
  every skin tone and hairstyle.

25 styles in 3 colours (75 pieces, each painted about twice) plus 11 outfits plus 150 elves comes to
roughly 250 to 300 paintings, including retries.

### On the site

- The picture is the same size and shape everywhere as now (1.3 times as tall as it is wide), with
  the canvas scaled and cropped to fit.
- Layers are stored as small cropped WebP files with where they sit on the canvas. **Two sets**
  (my call, after the reviewer pointed out print and share are bigger than the screen): a small set
  for the browser, at twice the wardrobe mirror's 260 pixels, and a large set used only by the
  server for emails (up to 800 pixels), the certificate (about 62mm printed, roughly 730 pixels) and
  the share card. Phones never load the large set. Only the layers an elf wears are loaded;
  wardrobe tiles load as they come into view.
- **Detective HQ** shows the elf through an `<img>` of an SVG today, which cannot load linked
  pictures, so the server builds a PNG for it, as for emails.
- `drawElf`, `drawPiece` and `drawOutfit` keep their names and what they take, so the pages, HQ,
  the certificate and the share card change as little as possible. Everything about what is
  unlocked, `normaliseLook`, and the rule that nothing typed reaches the drawing stay exactly as
  they are.
- **Emails** cannot load linked pictures inside an SVG, so the server builds the PNG by stacking the
  layer files itself (sharp can do this), instead of drawing an SVG.
- The old drawing code and commit `993dfa00` go once the painted elf is in.

### Making the paintings

- A script in the repo (run on Jaimie's computer, where the key is) does the painting, the cutting
  out and the cropping. The finished image files are committed. **Nothing on the website ever
  calls OpenAI**, and the key is never in the repo, CI or the site. The script reads it from
  `OPENAI_API_KEY` and never prints it.
- Prompts are kept in the repo next to the script, so any piece can be painted again the same way.
- The repo is public. The pictures are the charity's own artwork, with no children's names or other
  real data.

## Jaimie checks the pictures

Pictures go to Jaimie in batches, one slot at a time on a single sheet, with every colour shown on
two or three different elves (always including a dark skin tone and curly hair, the hardest
fits). Nothing goes in without her yes, and any piece can be repainted. Order: the master with
mittens, then the elves, then the starter kit and Workshop outfit, then the rest by slot. To make
13 November, batches go out daily from 4 November and need her answer within a day.

## Cost

Jaimie asked for it to be done cheaply ("I don't want to be paying a fortune for this"). Tested on
3 November by painting the mittens onto the master four ways, priced from OpenAI's published
rates (image input $8, image output $30 per million tokens for `gpt-image-2`; $2.50 and $8 for
`gpt-image-1-mini`) and the tokens each call reported:

| Setting | Cost of one painting | Result |
|---|---|---|
| `gpt-image-2`, high | about $0.18 | the look Jaimie approved |
| `gpt-image-2`, medium | about $0.05 | same look |
| **`gpt-image-2`, low** | **about $0.017** | **same look, as sharp close up** |
| `gpt-image-1-mini`, medium | about $0.017 | colours drift (brighter hair, yellower skin): no |

So **everything is painted on `gpt-image-2` at low quality**: 250 to 300 paintings with retries
comes to roughly **$5 (about £4)**. High quality only for a single painting that comes out wrong
at low and right at high, and never in bulk. Stop and ask Jaimie before the total passes £23 (raised
from £15 on 4 November 2026, for repainting the wardrobe in paper).
(OpenAI's Batch API halves the price again but answers within a day, too slow for daily batches.)
Low and medium paint the magenta slightly off pure (nearer `#E000E0`), so the cut out samples the
background colour from the picture's corners rather than assuming `#FF00FF`. Jaimie can watch the
spend on OpenAI's Usage page. About $2.50 was spent on the test.

## Goals, non-goals, anti-goals

- **Goal:** an elf a child is proud of, that looks like it belongs next to the logo, in every
  combination of skin, hair and clothes.
- **Not changing (except the new brother or sister choice):** what there is to wear, what unlocks at which door, the slots, the outfit list,
  the words for each piece, how a look is saved and checked.
- **Not doing:** no AI on the live site, no animated elf, no new pieces or outfits.
- **Anti-goals:** looking cheap or clip art; anything that does not look like the logo's family;
  pieces that float or do not line up; muddy colours; red hair or other leftovers showing on an elf
  that should not have them; a wardrobe page that is slow on a phone.

## Test (done, 3 November 2026)

In the session scratchpad `gen/` folder: `t-sister.png`, `t-brother.png` (first paintings),
`t-skin.png` (skin and hair changed, body still), `t-hat.png` and `t-layered.png` (hat lifted off,
recoloured, put on another elf: lines up, but muddy and with hair caught in it), `t-reindeer.png`
(the outfit), `t-eyes*.png` (eye tries), `t-brows.png` (**the approved face**), `paint.mjs` and
`layers.py` (throwaway scripts), and `t-m-high.png` (**the master with red mittens**, painted at
high quality during the price test; `t-m-medium.png`, `t-m-low.png`, `t-m-mini.png` are the same
painting at the cheaper settings).

## Left to the builder

File layout, the manifest format, how layers are cropped and named, the exact prompts, retries, the
quality setting, how tests hold the pictures (the current pixel tests check that the hair colour
shows, that every piece draws something, that two tartans can be told apart, and that every outfit
is plainly different: they should hold the paintings to the same standard), and whether hair is a
separate layer.
