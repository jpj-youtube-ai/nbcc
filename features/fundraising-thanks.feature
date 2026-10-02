@fundraising @fundraising-thanks @db
Feature: Thank your supporters (TASK-507)
  In their private area, an organiser picks gifts on their fundraiser and writes a short thank you.
  Staff check every one first. Once approved, NBCC emails it to each chosen giver, from the events
  inbox, so a reply comes to us: to every giver picked (the give form promises "your receipt and a
  thank you"), except anyone who has opted out ("Stop all emails") or is on the suppression list.
  The organiser never sees a giver's email address: only how many their thank you reached.

  Scenario: an organiser thanks their givers, staff approve it, and every giver who has not opted out is emailed
    Given fundraising is switched on
    And a fundraising staff member "kim.thanks.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Robins Thank You Walk (bdd-fr)" raising 50000 pence, organised by "robin.thanks.fr.bdd@example.com"
    When "ticked.thanks.fr.bdd@example.com", who ticked the newsletter box, gives 2500 pence on the page for "Robins Thank You Walk (bdd-fr)", paid as "pi_fr_bdd_thanks_1"
    And "unticked.thanks.fr.bdd@example.com", who left the newsletter box unticked, gives 1000 pence on the page for "Robins Thank You Walk (bdd-fr)", paid as "pi_fr_bdd_thanks_3"
    And "stopped.thanks.fr.bdd@example.com", who ticked the newsletter box, gives 500 pence on the page for "Robins Thank You Walk (bdd-fr)", paid as "pi_fr_bdd_thanks_4"
    And "stopped.thanks.fr.bdd@example.com" presses Stop all emails in the preference centre
    Then "stopped.thanks.fr.bdd@example.com" is on the opt out list
    And the organiser of "Robins Thank You Walk (bdd-fr)" is signed in to their private area
    And the signed in organiser thanks every gift on "Robins Thank You Walk (bdd-fr)" with "Thank you so much for your gift!"
    Then the fundraising answer is 202
    And the private area shows the thank you on "Robins Thank You Walk (bdd-fr)" as "Waiting for us to check"
    And no thank you email has gone to "ticked.thanks.fr.bdd@example.com"
    When "kim.thanks.fr.bdd@example.com" approves the thank you waiting on "Robins Thank You Walk (bdd-fr)"
    Then the fundraising answer is 200
    And a thank you email soon goes to "ticked.thanks.fr.bdd@example.com"
    And a thank you email soon goes to "unticked.thanks.fr.bdd@example.com"
    And the private area soon shows the thank you on "Robins Thank You Walk (bdd-fr)" as "Sent to 2 supporters"
    And no thank you email has gone to "stopped.thanks.fr.bdd@example.com"
    And the organiser's private area never shows "ticked.thanks.fr.bdd@example.com"
    And the organiser's private area never shows "unticked.thanks.fr.bdd@example.com"
    And the organiser's private area never shows "stopped.thanks.fr.bdd@example.com"

  Scenario: an organiser cannot pick a gift on someone else's fundraiser
    Given fundraising is switched on
    And an approved fundraiser "Mine To Thank (bdd-fr)" raising 50000 pence, organised by "mine.thanks.fr.bdd@example.com"
    And an approved fundraiser "Not Mine To Thank (bdd-fr)" raising 50000 pence, organised by "notmine.thanks.fr.bdd@example.com"
    When a supporter gives 1500 pence on the page for "Not Mine To Thank (bdd-fr)", paid as "pi_fr_bdd_thanks_2"
    And the organiser of "Mine To Thank (bdd-fr)" is signed in to their private area
    And the signed in organiser thanks the gift paid as "pi_fr_bdd_thanks_2" on "Mine To Thank (bdd-fr)" with "Thanks!"
    Then the fundraising answer is 400
    And no thank you is stored for "Mine To Thank (bdd-fr)"
