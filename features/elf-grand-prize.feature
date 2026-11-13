@elf-school @admin @elf-game
Feature: Elf Detective School on Christmas Eve: the grand prize
  Every detective who has done all 24 doors can send in one picture for the grand prize from Detective HQ until
  the entries close: a drawing, or a photo of the family's naughtiest elf at home. The picture is made again so
  nothing from the camera is kept, and a second one takes the place of the first. A family with no mobile gives
  one with its picture. Head elves see every picture in Head Elf HQ and, once the entries have closed, mark one
  winner; they set when the entries close and the graduates' video in Settings. Design:
  docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md, part 2.
  Every family, person and place here is invented.

  Background:
    Given the Elf Detective School is switched "on"
    And an admin user "alex.prize.admin.bdd@example.com" with role "admin" and password "Elf-Prize-Admin-1"

  # Played in last year's December, whose 24 doors and Christmas are always over: every door but door 7 was not
  # ready at its first clue, so the elf worker's tick snows it in, and a family that has been to door 7 has done
  # all 24 doors. The entries' closing moment is set by SQL from the
  # database's own clock, an hour from now and then a minute ago, so every answer holds whenever this runs, and no
  # step compares the real clock with a date written here. The hooks put the closing, the graduates' video and the
  # year back, and take last year's rows away (the entries with them).
  Scenario: A graduate sends in a picture for the grand prize, and a head elf marks one winner
    Given the school's year is last year, whose December is over
    And "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" has opened the doors list
    And door 7 is ready to run at "The Example Bakehouse" in "Snowford", with the prize "A pretend sledge"
    And door 7's tag word is "SNOWBALL 472"
    And December's doors are switched on
    And "first.prize.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "first.prize.elf.bdd@example.com"
    And "second.prize.elf.bdd@example.com" has already enrolled "Leo Frostwhistle" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "second.prize.elf.bdd@example.com"
    # The worker's tick snows in every door that cannot run, at once. A calendar read can be handed the build of
    # the scenario before (one build is shared for 15 seconds), and then snows in nothing here.
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" runs the elf worker at midday on 1 February this year
    Then every door but door 7 is snowed in
    When the family "first.prize.elf.bdd@example.com" types the word "SNOWBALL 472" at door 7
    Then the word wins, and the card says "You're first!"
    When the family "second.prize.elf.bdd@example.com" types the word "snowball 472" at door 7
    Then the word is a visit, and the card says "Door 7 done!"
    Given the grand prize entries close an hour from now
    When the family "first.prize.elf.bdd@example.com" opens its detective's entry page
    Then the game answers 200
    And the game page says "Send in your picture"
    When the family "first.prize.elf.bdd@example.com" sends its detective's picture for the grand prize
    Then the game answers 201
    When the family "first.prize.elf.bdd@example.com" sends its detective's picture for the grand prize
    Then the game answers 200
    And the family "first.prize.elf.bdd@example.com" has one grand prize entry, with its picture
    # The picture's own route, as the entry page shows it: to its own family only.
    When the family "first.prize.elf.bdd@example.com" asks for the grand prize picture of the detective of "first.prize.elf.bdd@example.com"
    Then the game answers 200 with a picture of type "image/jpeg"
    When the family "second.prize.elf.bdd@example.com" asks for the grand prize picture of the detective of "first.prize.elf.bdd@example.com"
    Then the game answers 404
    # A graduate's certificate, a sheet to print, and their share card, a picture drawn on the server.
    When the family "first.prize.elf.bdd@example.com" opens its detective's graduate certificate
    Then the game answers 200 with a sheet to print saying "Graduate Elf Detective"
    When the family "first.prize.elf.bdd@example.com" asks for its detective's share card
    Then the game answers 200 with a picture of type "image/png"
    Given the family "second.prize.elf.bdd@example.com" has no mobile number
    When the family "second.prize.elf.bdd@example.com" sends its detective's picture for the grand prize
    Then the game answers 400
    When the family "second.prize.elf.bdd@example.com" sends its detective's picture for the grand prize, with the mobile "07700 900 123"
    Then the game answers 201
    And the family of "second.prize.elf.bdd@example.com" keeps the mobile number "+447700900123"
    # Head Elf HQ's Grand prize part: every picture in the order it came in, and no winner while the entries are open.
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" reads the grand prize entries
    Then there are 2 entries, the first from "first.prize.elf.bdd@example.com"
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" marks the entry from "first.prize.elf.bdd@example.com" as the winner
    Then the head elf's answer is 409, saying "The entries are still open, so the winner can be marked once they close."
    # Settings > The grand prize. Door 24's place closes at 4pm, so 4:30pm is refused. A time typed goes on Christmas
    # Eve of Elf Detective School's year, last year's here, which is over, so every time typed has already passed:
    # 5pm is refused for that, and the closing stays the moment a step set by SQL an hour from now. (So no scenario can
    # save a closing time; test/unit/elf-db-settings.test.ts reads the write, and the graduates' video below proves
    # the same UPDATE against Postgres.)
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" saves the grand prize closing time "16:30"
    Then the head elf's answer is 409, saying "Door 24's hiding place closes at 4pm, so grand prize entries can close at 5pm at the earliest."
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" saves the grand prize closing time "17:00"
    Then the head elf's answer is 409, saying "That time has already passed, so the entries would close straight away. Please choose a later time."
    And the grand prize entries still close at the moment a step set an hour from now
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" saves the graduates' video "https://example.org/graduates"
    Then the head elf's answer is 200
    And the graduates' video is "https://example.org/graduates"
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" clears the graduates' video
    Then the head elf's answer is 200
    And there is no graduates' video
    # Once the entries have closed: one winner, and marking another moves the mark.
    Given the grand prize entries closed a minute ago
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" marks the entry from "first.prize.elf.bdd@example.com" as the winner
    Then the entry from "first.prize.elf.bdd@example.com" is the winner
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" marks the entry from "second.prize.elf.bdd@example.com" as the winner
    Then the entry from "second.prize.elf.bdd@example.com" is the winner, and only that one
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" reads the picture of the entry from "first.prize.elf.bdd@example.com"
    Then the head elf's answer is a picture of type "image/jpeg", kept by no cache
    When the family "first.prize.elf.bdd@example.com" sends its detective's picture for the grand prize
    Then the game answers 409

  # Stop these emails (ruling F16). The small link at the foot of each email that is not essential opens the
  # family's own page, which asks: following the link changes nothing, and only its button stops the emails. Detective
  # HQ then says so, and its own button starts them again. Played in next year's December with December's doors on,
  # so nothing here reads a date.
  Scenario: A family stops the emails from the link in one, and starts them again from Detective HQ
    Given December's doors are switched on
    And "emails.prize.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "emails.prize.elf.bdd@example.com"
    When someone opens the link to stop the emails in an email to "emails.prize.elf.bdd@example.com"
    Then the game answers 200
    And the game page says "Stop the emails from Elf Detective School?"
    And the family "emails.prize.elf.bdd@example.com" gets the emails
    When someone presses the button on that page
    Then the game answers 200
    And the game page says "Done. We will not send you these emails any more."
    And the family "emails.prize.elf.bdd@example.com" has stopped the emails, and the audit log says so
    When the family "emails.prize.elf.bdd@example.com" opens "/elf/hq"
    Then the game answers 200
    And the game page says "You have stopped these emails."
    When the family "emails.prize.elf.bdd@example.com" presses the button in Detective HQ's Your emails
    Then the game answers 303
    And the family "emails.prize.elf.bdd@example.com" gets the emails again, and the audit log says so

  # Who gets each door's clue email is worked out by one query, run here against Postgres: the clue email goes, built
  # and logged, to a family that never stopped the emails, and not to one that did. Played in last year's December,
  # whose doors are over. The elf worker is run once, a minute after door 7's first clue, worked out from Elf
  # Detective School's year and door 7's own evening, never written here. The worker ticking on the real clock never
  # sends last year's door 7 clue, whose six hours ended long ago, and its claim stops a second send, so this holds
  # whenever it runs. Only the clue emails are counted: the sweep on the real clock may send a promotion at any moment.
  Scenario: Door 7's clue email goes to a family, and not to a family that has stopped the emails
    Given the school's year is last year, whose December is over
    And "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" has opened the doors list
    And door 7 is ready to run at "The Example Bakehouse" in "Snowford", with the prize "A pretend sledge"
    And December's doors are switched on
    And "clue.prize.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    And "quiet.prize.elf.bdd@example.com" has already enrolled "Leo Frostwhistle" and paid
    When someone opens the link to stop the emails in an email to "quiet.prize.elf.bdd@example.com"
    And someone presses the button on that page
    Then the game answers 200
    And the family "quiet.prize.elf.bdd@example.com" has stopped the emails, and the audit log says so
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" runs the elf worker a minute after door 7's first clue
    Then once the request has finished, 1 "elfClue" email went to "clue.prize.elf.bdd@example.com"
    And once the request has finished, 0 "elfClue" emails went to "quiet.prize.elf.bdd@example.com"

  # The end of January clear out, as the entry page promises: from 31 January after the December its picture came in
  # for, the elf worker's tick deletes an entry, and its picture with it. Played in last year's December, whose doors
  # are over. A picture sent today belongs to the coming December, so it is kept whenever this runs, and the worker
  # ticking on the real clock never deletes it mid scenario; one a step moves to two years ago, by SQL from the
  # database's own clock, is always past its clear out. The worker is then run at midday today, so no step compares
  # the real clock with a date written here.
  Scenario: The elf worker deletes a grand prize entry and its picture from the end of January after its December
    Given the school's year is last year, whose December is over
    And "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" has opened the doors list
    And door 7 is ready to run at "The Example Bakehouse" in "Snowford", with the prize "A pretend sledge"
    And door 7's tag word is "SNOWBALL 472"
    And December's doors are switched on
    And "old.prize.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "old.prize.elf.bdd@example.com"
    And "new.prize.elf.bdd@example.com" has already enrolled "Leo Frostwhistle" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "new.prize.elf.bdd@example.com"
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" runs the elf worker at midday on 1 February this year
    Then every door but door 7 is snowed in
    When the family "old.prize.elf.bdd@example.com" types the word "SNOWBALL 472" at door 7
    Then the word wins, and the card says "You're first!"
    When the family "new.prize.elf.bdd@example.com" types the word "snowball 472" at door 7
    Then the word is a visit, and the card says "Door 7 done!"
    Given the grand prize entries close an hour from now
    When the family "old.prize.elf.bdd@example.com" sends its detective's picture for the grand prize
    Then the game answers 201
    When the family "new.prize.elf.bdd@example.com" sends its detective's picture for the grand prize
    Then the game answers 201
    Given the grand prize picture of the family "old.prize.elf.bdd@example.com" came in two years ago
    When "alex.prize.admin.bdd@example.com" with password "Elf-Prize-Admin-1" runs the elf worker at "12:00" today, London time
    Then the family "old.prize.elf.bdd@example.com" has no grand prize entry, and its picture has gone too
    And the family "new.prize.elf.bdd@example.com" has one grand prize entry, with its picture
