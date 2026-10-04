@fundraising @db
Feature: Welcome packs: what goes in the post to each approved page, ticked off by staff
  Every approved fundraiser and event host gets a welcome pack: the welcome letter, what they asked
  for on the form, a sponsor form for a sponsorship fundraiser, and an NBCC T-shirt in their size for
  a sporting event. Staff tick each thing as it goes in, then mark the pack as sent. Ticking something
  they asked for also marks its request as done, and never undoes what staff did by hand in Requests.
  A page in memory of someone has no welcome pack: it
  has "Things to send", only what they asked for. Viewers can look and print, but not tick. Every
  name here is invented.

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

  Scenario: something left out can be put back
    Given fundraising is switched on
    And a fundraising staff member "e6.pack.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Fern's Pack Hike (bdd-fr)" with the T-shirt size "adult_s" asking for 3 posters
    When "e6.pack.fr.bdd@example.com" leaves "sponsor_form" out of the pack for "Fern's Pack Hike (bdd-fr)" because ""
    Then the fundraising answer is 400
    And the fundraising answer names the field "reason"
    When "e6.pack.fr.bdd@example.com" leaves "sponsor_form" out of the pack for "Fern's Pack Hike (bdd-fr)" because "They have one (bdd)"
    Then the fundraising answer is 200
    And the pack answer is "Part packed"
    And "sponsor_form" is left out of the pack answer because "They have one (bdd)"
    When "e6.pack.fr.bdd@example.com" puts "sponsor_form" back in the pack for "Fern's Pack Hike (bdd-fr)"
    Then the fundraising answer is 200
    And the pack answer is "To pack"
    And nothing is ticked in the pack for "Fern's Pack Hike (bdd-fr)"

  Scenario: a tick no longer counts once they ask for a different number, and is ticked again
    Given fundraising is switched on
    And a fundraising staff member "e7.pack.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Ash's Pack Jog (bdd-fr)" with the T-shirt size "adult_m" asking for 10 posters
    When "e7.pack.fr.bdd@example.com" ticks "posters_a4" in the pack for "Ash's Pack Jog (bdd-fr)"
    Then the fundraising answer is 200
    When "e7.pack.fr.bdd@example.com" ticks "posters_a4" in the pack for "Ash's Pack Jog (bdd-fr)"
    Then the fundraising answer is 200
    And the history of "Ash's Pack Jog (bdd-fr)" has 1 pack line
    Given "Ash's Pack Jog (bdd-fr)" now asks for 12 posters
    When "e7.pack.fr.bdd@example.com" reads the welcome packs
    Then the pack for "Ash's Pack Jog (bdd-fr)" lists "12 A4 posters"
    And "posters_a4" in the pack for "Ash's Pack Jog (bdd-fr)" says "It was ticked for 10 A4 posters. They now want 12 A4 posters, so it needs ticking again."
    When "e7.pack.fr.bdd@example.com" ticks "posters_a4" in the pack for "Ash's Pack Jog (bdd-fr)"
    Then the fundraising answer is 200
    And the pack answer is "Part packed"
    And the history of "Ash's Pack Jog (bdd-fr)" has 2 pack lines

  Scenario: ticking the posters marks their request as sent, and unticking opens it again
    Given fundraising is switched on
    And a fundraising staff member "e8.pack.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Jo's Pack Climb (bdd-fr)" with the T-shirt size "adult_m" asking for 10 posters
    When "e8.pack.fr.bdd@example.com" ticks "posters_a4" in the pack for "Jo's Pack Climb (bdd-fr)"
    Then the fundraising answer is 200
    And the pack answer also marked "Posters: sent (by post)" in Requests
    And the posters request for "Jo's Pack Climb (bdd-fr)" is stored as "sent" with 10
    When "e8.pack.fr.bdd@example.com" unticks "posters_a4" in the pack for "Jo's Pack Climb (bdd-fr)"
    Then the fundraising answer is 200
    And the posters request for "Jo's Pack Climb (bdd-fr)" is stored as "to_send" with none

  Scenario: a tick from a page left open is refused once the list has changed
    Given fundraising is switched on
    And a fundraising staff member "e10.pack.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Lee's Pack Row (bdd-fr)" with the T-shirt size "adult_m" asking for 10 posters
    And "Lee's Pack Row (bdd-fr)" now asks for 12 posters
    When "e10.pack.fr.bdd@example.com" ticks "posters_a4" in the pack for "Lee's Pack Row (bdd-fr)" as "10 A4 posters", 10 of them
    Then the fundraising answer is 409
    And nothing is ticked in the pack for "Lee's Pack Row (bdd-fr)"
    When "e10.pack.fr.bdd@example.com" ticks "posters_a4" in the pack for "Lee's Pack Row (bdd-fr)"
    Then the fundraising answer is 200

  Scenario: the pack never puts back a count staff corrected in Requests
    Given fundraising is switched on
    And a fundraising staff member "e11.pack.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Pat's Pack Swim (bdd-fr)" with the T-shirt size "adult_m" asking for 10 posters
    When "e11.pack.fr.bdd@example.com" ticks "posters_a4" in the pack for "Pat's Pack Swim (bdd-fr)"
    Then the posters request for "Pat's Pack Swim (bdd-fr)" is stored as "sent" with 10
    When "e11.pack.fr.bdd@example.com" corrects the posters sent to "Pat's Pack Swim (bdd-fr)" to 8 in Requests
    Then the fundraising answer is 200
    When "e11.pack.fr.bdd@example.com" ticks "letter" in the pack for "Pat's Pack Swim (bdd-fr)"
    And "e11.pack.fr.bdd@example.com" ticks "sponsor_form" in the pack for "Pat's Pack Swim (bdd-fr)"
    And "e11.pack.fr.bdd@example.com" ticks "tshirt" in the pack for "Pat's Pack Swim (bdd-fr)"
    And "e11.pack.fr.bdd@example.com" marks the pack for "Pat's Pack Swim (bdd-fr)" as sent
    Then the fundraising answer is 200
    And the pack answer is "Sent"
    And the posters request for "Pat's Pack Swim (bdd-fr)" is stored as "sent" with 8

  Scenario: a T-shirt left out while it waited is asked for again once their size comes in
    Given fundraising is switched on
    And a fundraising staff member "e12.pack.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Kit's Pack Ride (bdd-fr)" with no T-shirt size
    When "e12.pack.fr.bdd@example.com" ticks "letter" in the pack for "Kit's Pack Ride (bdd-fr)"
    And "e12.pack.fr.bdd@example.com" ticks "sponsor_form" in the pack for "Kit's Pack Ride (bdd-fr)"
    And "e12.pack.fr.bdd@example.com" leaves "tshirt" out of the pack for "Kit's Pack Ride (bdd-fr)" because "Sending it later (bdd)"
    Then the fundraising answer is 200
    And the pack answer is "Ready to send"
    Given "Kit's Pack Ride (bdd-fr)" has now chosen the T-shirt size "adult_m"
    When "e12.pack.fr.bdd@example.com" reads the welcome packs
    Then the pack for "Kit's Pack Ride (bdd-fr)" is called "Welcome pack" and is "Part packed"
    And "tshirt" in the pack for "Kit's Pack Ride (bdd-fr)" says "Their size has come in: Adult M. Tick it when the T-shirt goes in."
    When "e12.pack.fr.bdd@example.com" marks the pack for "Kit's Pack Ride (bdd-fr)" as sent
    Then the fundraising answer is 409

  Scenario: a bake sale has no sponsor form or T-shirt in its pack
    Given fundraising is switched on
    And a fundraising staff member "e9.pack.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Mo's Pack Bake Sale (bdd-fr)" that is not a sporting event
    When "e9.pack.fr.bdd@example.com" reads the welcome packs
    Then the pack for "Mo's Pack Bake Sale (bdd-fr)" lists "Welcome letter"
    And the pack for "Mo's Pack Bake Sale (bdd-fr)" does not list "Sponsor form"
    And the pack for "Mo's Pack Bake Sale (bdd-fr)" has no T-shirt
    When "e9.pack.fr.bdd@example.com" chooses "Nobody Madeup (bdd)" to sign the letter for "Mo's Pack Bake Sale (bdd-fr)"
    Then the fundraising answer is 400
    And the fundraising answer names the field "name"

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
