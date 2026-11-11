@elf-school @admin @elf-game
Feature: Elf Detective School in December: the doors, and a practice evening played end to end
  While December's doors are switched off every family route is wave 1. A real door is shut until its
  day: the hooks play every scenario in next year's December, so door 1 is always still to come. A head
  elf starts a practice evening at a pretend place, then plays it through the preview link as two
  families would: the clues, a guess, the word, "You're first!", a visit, a photo and the reveal. The
  practice door never counts towards anything, and clearing it leaves nothing behind. Design:
  docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md. Every family, person and place here
  is invented.

  Background:
    Given the Elf Detective School is switched "on"
    And an admin user "alex.game.admin.bdd@example.com" with role "admin" and password "Elf-Game-Admin-1"

  Scenario: Switched off means wave 1
    Given "alex.game.admin.bdd@example.com" with password "Elf-Game-Admin-1" has opened the doors list
    And "first.game.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "first.game.elf.bdd@example.com"
    When the family "first.game.elf.bdd@example.com" opens the poster page of door 1
    Then the game answers 404
    When the family "first.game.elf.bdd@example.com" opens "/elf"
    Then the game answers 200
    When the family "first.game.elf.bdd@example.com" opens "/elf/hq"
    Then the game answers 200
    And the game page holds 0 clues

  Scenario: A real door is shut until its day
    Given "alex.game.admin.bdd@example.com" with password "Elf-Game-Admin-1" has opened the doors list
    And "first.game.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "first.game.elf.bdd@example.com"
    And December's doors are switched on
    And door 1's tag word is "SNOWBALL 472"
    When the family "first.game.elf.bdd@example.com" types the word "SNOWBALL 472" at door 1
    Then the game answers 409 with the reason "too-early"
    When the family "first.game.elf.bdd@example.com" types the word "snowball 999" at door 1
    Then the game answers 400 with the reason "wrong-word"
    And the family has 5 tries left at that door
    When the family "first.game.elf.bdd@example.com" types 5 more wrong words at door 1
    Then each was refused as a wrong word, the last with no tries left
    When the family "first.game.elf.bdd@example.com" types the word "SNOWBALL 472" at door 1
    Then the game answers 400 with the reason "too-many-tries"
    When the family "first.game.elf.bdd@example.com" guesses "The Example Office" for door 1
    Then the game answers 400 with the reason "not-hunting"
    When someone signed out opens the poster page of door 1
    Then the game answers 200
    And the game page says "Join Elf Detective School"

  # The plan had the reveal and three clues checked together. Once the place is shown, Detective HQ
  # closes the case (the outcome, with no clues), as Task 6 pinned: so the three clues are checked while
  # the place is still hidden, and the reveal after.
  Scenario: A practice evening, end to end
    Given "alex.game.admin.bdd@example.com" with password "Elf-Game-Admin-1" makes a preview link
    And "alex.game.admin.bdd@example.com" with password "Elf-Game-Admin-1" starts a practice evening at "The Example Office" in "Snowford", 1 minute apart
    And "first.game.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "first.game.elf.bdd@example.com"
    And "second.game.elf.bdd@example.com" has already enrolled "Leo Frostwhistle" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "second.game.elf.bdd@example.com"
    And the family "first.game.elf.bdd@example.com" opens the preview link
    And the family "second.game.elf.bdd@example.com" opens the preview link
    When 65 seconds have passed since the practice evening started
    And the family "first.game.elf.bdd@example.com" opens "/elf/hq"
    Then the game answers 200
    And the game page holds 1 clue
    And the game page says "Practice clue 1"
    And the game page carries the chip "Practice"
    When the family "first.game.elf.bdd@example.com" guesses "the example office" for the practice door
    Then the guess is saved
    When the family "first.game.elf.bdd@example.com" types the practice door's word with one detective
    Then the word wins, and the card says "You're first!"
    When the family "second.game.elf.bdd@example.com" types the practice door's word with one detective
    Then the word is a visit, and the card says "It counts from"
    When the family "second.game.elf.bdd@example.com" sends a photo to the practice door, saying yes to showing it
    Then the photo is waiting, with a token
    When the family "second.game.elf.bdd@example.com" asks for that photo
    Then the game answers 404
    When clue 2 and clue 3 of the practice door are out
    And the family "first.game.elf.bdd@example.com" opens "/elf/hq"
    Then the game page holds 3 clues
    And the game page says "Tinsel has been found!"
    When the practice door's place is shown
    And the family "first.game.elf.bdd@example.com" opens "/elf/hq"
    Then the game page holds 0 clues
    And the game page says "Case closed"
    And the game page says "You cracked it!"
    When the family "first.game.elf.bdd@example.com" opens "/api/elf/me"
    Then the game answers 200
    And the family's marks are empty: the practice door never counts
    When "alex.game.admin.bdd@example.com" with password "Elf-Game-Admin-1" clears the practice
    Then nothing of the practice door is left
