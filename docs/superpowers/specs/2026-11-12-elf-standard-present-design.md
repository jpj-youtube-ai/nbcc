# A standard present on every door

Date: 12 November 2026. Decided by Jaimie in chat: "we are not going to do individual style gifts on the
doors. just make a standard present on them".

## Intent

Every door of the Elf Detective School calendar carries the same present, cut out of card in the paper look,
instead of a picture made for each door's prize. Nobody has to make or send door pictures, and a door no longer
waits on one before it can be ready.

## What changes

1. The shape carved on every door is a present (a wrapped box with a bow). It is drawn as a one-colour vector,
   like the mystery star and the snow day's snowflake, and takes the same paper treatment from `.elf-carve`:
   card, a darker cut edge and a soft shadow, gold on today's door. It replaces the mystery star wherever the
   star was the default. Snow days keep the snowflake.
2. A door is ready without a door picture. "The door picture" leaves the ready list everywhere it is checked:
   Head Elf HQ > Doors, the worker's checks, and the December's doors switch's check on door 1.
3. Head Elf HQ > Doors stops saying a picture is "made from the prize list", or to "send it to Claude for the
   door pictures". The door sheet shows the present. The Copy the prize list button stays, as a list of the
   prizes.
4. The 8am email's posts carry no door picture, as today, and nothing in them promises one.

## Not changing

- Each door's prize words, Show it off, finding, and the scrapbook.
- The per-door picture lookup (`DOOR_PICTURES`, `doorPicture`) stays in the code, empty, so the catch-up work in
  flight on another branch is untouched.
- With December's doors switched off, the family pages change only in one line on a shut door's detail, and the
  shape is CSS. The line was "Look at the shape cut out of the door. Can you guess the prize?", and is now "Every
  door has a prize for the first detective to find its elf. Can you guess what it is?", because the same present
  on every door no longer hints at a door's prize. It shows with the doors off too, as the present does.

## Look

The paper cut look is locked. The present must sit well in the carving at 58px (a door) and at 40px (a found
door whose place is still hidden), on the doors' maroon, in card colour and in gold. It must read as a present
at a glance on a phone at 360px. It is checked side by side with the star, the snowflake and the paper sample
before it is shown to Jaimie.

## Approaches considered

- **A one-colour vector through the existing carving (chosen).** It matches the paper look by construction, is
  crisp at every size, costs nothing, and needs no new picture files.
- **A painting from OpenAI** (Jaimie allowed the spend). A painting would not take the cut-card treatment the
  doors already use, so it would drift from the locked paper look. It would also need picture files and a spend.
- **One picture file for all 24 doors through `DOOR_PICTURES`.** It looks the same as the vector, but it touches
  the views and the catch-up branch's change fingerprints, for no gain.
