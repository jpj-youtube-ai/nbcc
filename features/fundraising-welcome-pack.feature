@fundraising @db
Feature: Welcome packs: what goes in the post to each approved page, ticked off by staff
  Every approved fundraiser and event host gets a welcome pack: the welcome letter, what they asked
  for on the form, a sponsor form for someone raising money, and an NBCC T-shirt in their size for a
  sporting event. Staff tick each thing as it goes in, then mark the pack as sent. A page in memory
  of someone has no welcome pack: it has "Things to send", only what they asked for. Viewers can
  look and print, but not tick. Every name here is invented.

  Scenario: a sporting fundraiser's pack has the letter, their posters, the sponsor form and the T-shirt
    Given fundraising is switched on
    And a fundraising staff member "e1.pack.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Robin's Pack Walk (bdd-fr)" with the T-shirt size "adult_m" asking for 10 posters
    When "e1.pack.fr.bdd@example.com" reads the welcome packs
    Then the fundraising answer is 200
    And the pack for "Robin's Pack Walk (bdd-fr)" is called "Welcome pack" and is "To pack"
    And the pack for "Robin's Pack Walk (bdd-fr)" lists "Welcome letter"
    And the pack for "Robin's Pack Walk (bdd-fr)" lists "10 A4 posters"
    And the pack for "Robin's Pack Walk (bdd-fr)" lists "Sponsor form"
    And the pack for "Robin's Pack Walk (bdd-fr)" lists "NBCC T-shirt, Adult M"
    And the pack for "Robin's Pack Walk (bdd-fr)" is addressed to "Robin Example" at "1 Example Road" "Exampleton" "EX1 1EX"
    And "Robin's Pack Walk (bdd-fr)" has a pack to send

  Scenario: ticking everything lets staff mark the pack as sent, and Undo takes it back
    Given fundraising is switched on
    And a fundraising staff member "e2.pack.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Sam's Pack Dash (bdd-fr)" with the T-shirt size "kids_9_10" asking for 4 posters
    When "e2.pack.fr.bdd@example.com" marks the pack for "Sam's Pack Dash (bdd-fr)" as sent
    Then the fundraising answer is 409
    When "e2.pack.fr.bdd@example.com" ticks "letter" in the pack for "Sam's Pack Dash (bdd-fr)"
    Then the fundraising answer is 200
    And the pack answer is "Part packed"
    When "e2.pack.fr.bdd@example.com" ticks "posters_a4" in the pack for "Sam's Pack Dash (bdd-fr)"
    And "e2.pack.fr.bdd@example.com" leaves "sponsor_form" out of the pack for "Sam's Pack Dash (bdd-fr)" because "They have one (bdd)"
    And "e2.pack.fr.bdd@example.com" ticks "tshirt" in the pack for "Sam's Pack Dash (bdd-fr)"
    Then the fundraising answer is 200
    And the pack answer is "Ready to send"
    When "e2.pack.fr.bdd@example.com" marks the pack for "Sam's Pack Dash (bdd-fr)" as sent
    Then the fundraising answer is 200
    And the pack answer is "Sent"
    And the pack for "Sam's Pack Dash (bdd-fr)" is stored as sent by "admin:e2.pack.fr.bdd@example.com"
    And the history of "Sam's Pack Dash (bdd-fr)" says "Welcome pack sent" of its pack
    When "e2.pack.fr.bdd@example.com" reads the welcome packs
    Then "Sam's Pack Dash (bdd-fr)" has no pack to send
    When "e2.pack.fr.bdd@example.com" undoes the sent pack for "Sam's Pack Dash (bdd-fr)"
    Then the fundraising answer is 200
    And the pack answer is "Ready to send"

  Scenario: a sporting event with no size yet waits for the T-shirt size
    Given fundraising is switched on
    And a fundraising staff member "e3.pack.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Kim's Pack Run (bdd-fr)" with no T-shirt size
    When "e3.pack.fr.bdd@example.com" reads the welcome packs
    Then the pack for "Kim's Pack Run (bdd-fr)" lists "Waiting for T-shirt size"
    When "e3.pack.fr.bdd@example.com" ticks "tshirt" in the pack for "Kim's Pack Run (bdd-fr)"
    Then the fundraising answer is 409

  Scenario: an event host's pack has no sponsor form or T-shirt
    Given fundraising is switched on
    And a fundraising staff member "e4.pack.fr.bdd@example.com" with role "editor"
    And an approved event "Exampleton Pack Quiz (bdd-fr)" asking for 6 posters
    When "e4.pack.fr.bdd@example.com" reads the welcome packs
    Then the pack for "Exampleton Pack Quiz (bdd-fr)" is called "Welcome pack" and is "To pack"
    And the pack for "Exampleton Pack Quiz (bdd-fr)" lists "Welcome letter"
    And the pack for "Exampleton Pack Quiz (bdd-fr)" lists "6 A4 posters"
    And the pack for "Exampleton Pack Quiz (bdd-fr)" does not list "Sponsor form"
    And the pack for "Exampleton Pack Quiz (bdd-fr)" has no T-shirt

  Scenario: a page in memory of someone shows Things to send, with the envelopes they asked for
    Given fundraising is switched on
    And a fundraising staff member "e5.pack.fr.bdd@example.com" with role "editor"
    And an approved page in memory of "Margaret Packexample (bdd-fr)" asking for 30 collection envelopes
    When "e5.pack.fr.bdd@example.com" reads the welcome packs
    Then the pack for "In memory of Margaret Packexample (bdd-fr)" is called "Things to send" and is "To pack"
    And the pack for "In memory of Margaret Packexample (bdd-fr)" lists "Covering note"
    And the pack for "In memory of Margaret Packexample (bdd-fr)" lists "30 collection envelopes"
    And the pack for "In memory of Margaret Packexample (bdd-fr)" does not list "Welcome letter"
    And the pack for "In memory of Margaret Packexample (bdd-fr)" does not list "Sponsor form"
    And the pack for "In memory of Margaret Packexample (bdd-fr)" has no T-shirt

  Scenario: a viewer can read and print a pack, but cannot tick it
    Given fundraising is switched on
    And a fundraising staff member "v1.pack.fr.bdd@example.com" with role "viewer"
    And an approved sporting fundraiser "Ali's Pack Swim (bdd-fr)" with the T-shirt size "adult_l" asking for 2 posters
    When "v1.pack.fr.bdd@example.com" reads the welcome packs
    Then the fundraising answer is 200
    And the pack for "Ali's Pack Swim (bdd-fr)" lists "Welcome letter"
    When "v1.pack.fr.bdd@example.com" ticks "letter" in the pack for "Ali's Pack Swim (bdd-fr)"
    Then the fundraising answer is 403
    And nothing is ticked in the pack for "Ali's Pack Swim (bdd-fr)"
    When "v1.pack.fr.bdd@example.com" opens the print view of the pack for "Ali's Pack Swim (bdd-fr)"
    Then the fundraising answer is 200
    And the print view shows "Dear Ali,"
    And the print view shows "In this pack you'll find:"
    And the print view shows "The Elves' Workshop"
    And the print view has 2 copies of the A4 poster

  Scenario: the welcome packs need a session
    When the welcome packs are read without a session
    Then the fundraising answer is 401
