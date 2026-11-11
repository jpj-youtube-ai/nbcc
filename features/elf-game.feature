@elf-school @admin @elf-game
Feature: Elf Detective School in December: the doors, and a practice evening played end to end
  While December's doors are switched off every family route is wave 1. A real door is shut until its
  day: the hooks play every scenario in next year's December, so door 1 is always still to come. A head
  elf starts a practice evening at a pretend place, then plays it through the preview link as two
  families would: the clues, a guess, the word, "You're first!", a visit, a photo and the reveal. The
  practice door never counts towards anything, and clearing it leaves nothing behind. A real door is
  played too, in a December that is over, so its own rows are read and written: the find, a visit, its
  scrapbook, a photo, an elf on the door, wrong tries cleared, and an unready door snowed in. Design:
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

  # A real door keeps clock times on its own day, December n of the school's year, where the practice door
  # keeps instants. So no SQL on a door can bring next year's evening into the past, and a real door can
  # never be hunted in CI without a date bomb. This plays in last year's December instead, which is
  # always over: the door was shown with nobody found (revealed) until its word is typed, so the guess saved
  # before its evening is put in by SQL. Every other door was not ready at its first clue, so the first
  # calendar read snows it in. The hooks put the year back and take last year's rows away.
  Scenario: A real door played after its evening, with its scrapbook and a photo, and an unready door snowed in
    Given the school's year is last year, whose December is over
    And December's doors are switched on
    And "alex.game.admin.bdd@example.com" with password "Elf-Game-Admin-1" has opened the doors list
    And door 7 is ready to run at "The Example Bakehouse" in "Snowford", with the prize "A pretend sledge"
    And door 7's tag word is "SNOWBALL 472"
    And "first.game.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "first.game.elf.bdd@example.com"
    And "second.game.elf.bdd@example.com" has already enrolled "Leo Frostwhistle" and paid
    And the paying browser comes back from Stripe
    And it is sent to Detective HQ, signed in
    And that browser is the family "second.game.elf.bdd@example.com"
    And the family "first.game.elf.bdd@example.com" guessed "The Example Bakehouse" for door 7 before its evening
    When the family "first.game.elf.bdd@example.com" guesses "The Example Bakehouse" for door 7
    Then the game answers 400 with the reason "not-hunting"
    When the family "first.game.elf.bdd@example.com" types the word "snowball 999" at door 7
    Then the game answers 400 with the reason "wrong-word"
    And the family has 5 tries left at that door
    When "alex.game.admin.bdd@example.com" with password "Elf-Game-Admin-1" clears the wrong words of "first.game.elf.bdd@example.com" at door 7
    Then the family "first.game.elf.bdd@example.com" has no wrong words left at door 7
    When the family "first.game.elf.bdd@example.com" types the word "SNOWBALL 472" at door 7
    Then the word wins, and the card says "You're first!"
    And door 7 was found by the family "first.game.elf.bdd@example.com"
    When the family "second.game.elf.bdd@example.com" types the word "snowball 472" at door 7
    Then the word is a visit, and the card says "Door 7 done!"
    When the family "second.game.elf.bdd@example.com" sends a photo to door 7, saying yes to showing it
    Then the photo for door 7 is waiting, with a token
    When a head elf approves that photo, by SQL
    And someone signed out asks for that photo at door 7
    Then the game answers 200 with a picture of type "image/jpeg"
    When someone signed out asks for the elf of the visit of "second.game.elf.bdd@example.com" to door 7
    Then the game answers 200 with a picture of type "image/png"
    When that visit is moved to count from an hour from now
    And someone signed out asks for the elf of that visit
    Then the game answers 404
    When that visit is moved back to count from a minute ago
    And someone signed out asks for the elf of that visit
    Then the game answers 200 with a picture of type "image/png"
    When someone signed out reads door 7 on the calendar until it says "FOUND FIRST!"
    Then door 7's scrapbook shows "Detective R. Tinselfoot" first, then "Detective L. Frostwhistle"
    And door 7 on the calendar says "Detective R. Tinselfoot won the prize cut into this door: A pretend sledge."
    And door 7 on the calendar says "1 family cracked this case"
    And door 7 on the calendar says "2 have been there since"
    And door 7 on the calendar shows that photo in its row of photos
    And door 2 on the calendar says "got snowed in"
    And door 2 was snowed in automatically
    When the family "second.game.elf.bdd@example.com" takes that photo down from the poster page of door 7
    Then the game answers 200
    And that photo is taken down, with its bytes gone
    When someone signed out asks for that photo at door 7
    Then the game answers 404
    When the family "first.game.elf.bdd@example.com" opens "/api/elf/me"
    Then the family's marks say door 7 is cracked and visited, and door 2 is snowed in
    When the family "first.game.elf.bdd@example.com" opens "/elf/hq"
    Then the game page says "Door 7: cracked and visited"
    And the game page says "Door 2: snowed in, so it counts as done."
