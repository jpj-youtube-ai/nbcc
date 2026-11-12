# Elf Detective School photos in the admin phone app

Date: 12 November 2026. Jaimie in chat said yes to adding Elf Detective School's photo alerts to the NBCC Admin
app's notifications, "but do that on top of the texts leave texts where they are".

## Intent

Head elves get a free phone notification from the NBCC Admin app when a family sends a photo to be checked, as
well as the text and email they get today. A text costs about 4p; an app notification costs nothing.

## What changes

1. Elf Detective School becomes an area in the admin's "what's new" system (`src/admin/whats-new.ts`,
   `src/db/whats-new.ts`), for the `elf` section at view level, so it reaches whoever can open Head Elf HQ.
2. Something arrives in it when a family sends a photo for a door, that is, a photo waiting to be checked. Photos
   from the practice door count too, so the practice evening shows it working.
3. The notification's title is "Elf Detective School" and its line is "A photo is waiting to be checked". It never
   carries the photo, a family's or a detective's name, or anything about the door's place.
4. Tapping it opens Head Elf HQ at the photos to check (Content > Elf Detective School > Finds).
5. A New mark shows beside Elf Detective School in the admin menu, as it does for the other sections, until the
   person opens it.
6. The app's own settings apply: each person can switch Elf Detective School off, bundle, or set quiet hours
   (Monitor > Notifications). By default it is on, with a buzz every time, as Jaimie chose for the app. The cap of
   20 at once still turns a flood into one summary.
7. The elf texts and emails do not change.

## Not changing

- The elf text and email alerts (`src/elf/alerts.ts`, the elf worker), their timing and who gets them.
- Who can open Head Elf HQ.

## Privacy

Nothing in a notification identifies a family, a child or a place: no photo, no names, no place. The New mark
shows nothing either.

## Approaches considered

- **A new area in the what's new system (chosen).** It follows every rule Jaimie set for the app (a buzz each
  time, per-person switches, quiet hours, the cap of 20), adds the New mark, and works for whoever can open Head
  Elf HQ.
- **A push from the elf alert itself, at the same moments as the texts** (once when photos start waiting, at most
  every 30 minutes, none from 9pm to 8am). It would bypass the app's own switches and add no New mark, and a head
  elf with texts on would get two buzzes at once.
