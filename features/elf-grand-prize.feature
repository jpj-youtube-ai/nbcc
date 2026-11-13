@elf-school @admin @elf-game
Feature: Elf Detective School on Christmas Eve: the grand prize
  Every detective who has done all 24 doors can send in one picture for the grand prize from Detective HQ until
  the entries close: a drawing, or a photo of the family's naughtiest elf at home. The picture is made again so
  nothing from the camera is kept, and a second one takes the place of the first. A family with no mobile gives
  one with its picture. Design: docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md, part 2.
  Every family, person and place here is invented.

  Background:
    Given the Elf Detective School is switched "on"
    And an admin user "alex.prize.admin.bdd@example.com" with role "admin" and password "Elf-Prize-Admin-1"

  # Played in last year's December, whose 24 doors and Christmas are always over: every door but door 7 was not
  # ready at its first clue, so the first calendar read (or the elf worker, which ticks in CI too) snows it in,
  # and a family that has been to door 7 has done all 24 doors. The entries' closing moment is set by SQL from the
  # database's own clock, an hour from now and then a minute ago, so every answer holds whenever this runs, and no
  # step compares the real clock with a date written here. The hooks put the closing and the year back, and take
  # last year's rows away (the entries with them).
  Scenario: A graduate sends in a picture for the grand prize
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
    When someone signed out reads door 2 on the calendar until it says "got snowed in"
    And the family "first.prize.elf.bdd@example.com" types the word "SNOWBALL 472" at door 7
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
    Given the family "second.prize.elf.bdd@example.com" has no mobile number
    When the family "second.prize.elf.bdd@example.com" sends its detective's picture for the grand prize
    Then the game answers 400
    When the family "second.prize.elf.bdd@example.com" sends its detective's picture for the grand prize, with the mobile "07700 900 123"
    Then the game answers 201
    And the family of "second.prize.elf.bdd@example.com" keeps the mobile number "+447700900123"
    Given the grand prize entries closed a minute ago
    When the family "first.prize.elf.bdd@example.com" sends its detective's picture for the grand prize
    Then the game answers 409
