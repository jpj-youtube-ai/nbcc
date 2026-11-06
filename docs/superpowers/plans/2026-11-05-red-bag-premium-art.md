# Fill a Red Bag: premium paintings (plan, 5 November 2026)

Jaimie asked for Fill a Red Bag to look "way more premium" with exactly the same functionality, in
NBCC's brand: flat, bold maroon-brown outlines like the logo elf (look A; not the Elf Detective paper
look). Every picture, the bag, the effects and the buttons were approved one at a time on
5 November 2026 (mock-ups and paintings in the session scratchpad; the paintings were made with the
OpenAI pipeline in scripts/elf-paint/ on a separate ledger, $3.90 of a £20 cap).

**Ships from Sunday 8 November 2026 only.** Stage 2 (the home stage and the night look on /fill)
switches on at 2026-11-07T20:00Z and the Ball's table QR codes send guests to /fill that night.

## What changes

1. **The pictures** (`assets/img/red-bag/<key>.webp`, one per key of `ART`). `art(key, cls, size)`
   keeps its contract (an `<svg class="rb-art ...">` 40 x 40 view, width and height, hidden from
   assistive tech, "" for no drawing) but draws `<image href="/assets/img/red-bag/<key>.webp">`
   instead of shapes. `ART` stays an object keyed the same (staff choose from its keys in the admin).
   Every caller (the page, peeks, drops, "Also in your bag", the home stage, the Ball bags page, the
   admin picker, the server render) is unchanged.
2. **The list** gets a 44px painting beside each item (Jaimie chose B): render.ts draws
   `art(key, "rb-item__pic", 44)` in each row; red-bag.css gives the row a picture column.
3. **The bag** (`BAG_SVG`, same 120 x 132 view so every layout that sizes it is unchanged): back
   cord, the whole painted bag (pale, and red once full), the tissue, the peeks (the script still
   puts them just before `.rb-bag__paper`), `.rb-bag__paper` = the FRONT of the bag cut out above
   its front edge (so the toys sit inside it and its edge line always shows), `.rb-bag__fill` = the
   red front, revealed from the bottom by `--rb-fill` (clip-path inset, a transition), then the front
   cord, its twist and eyelets. The handles are drawn (one on the back fixed to the back rim, one on
   the front, the same span, never crossing, both red). Peek places move to the new opening.
4. **The tie**: a painted bow and blank tag (images) with the tag's words still real text.
5. **The effects**: the snow and star flurry draw the painted snowflake and star.
6. **The buttons** restyled in red-bag.css: the logo's outline colour (#5C2626) at 2.6px, a hard
   "sticker" edge that sinks on press, the plus filled crimson, example cards with the painting at
   44px. Same elements, same states, same 44px targets.

## Checks

- Unit tests updated first for the new contract (art() draws an image of its own key's file, every
  ART key has its file, the bag's layers are in order, peeks before the front), then the code.
- Look at /fill, the thank-you page, the home stage and the night look in the stand-in server, on a
  phone width and desktop, before Jaimie's yes. No inner scrollbars.
