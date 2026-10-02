@fundraising @events @db
Feature: Giving on a fundraiser's page (TASK-502)
  A gift with Gift Aid shows it on the supporter wall ("£20 + £5 Gift Aid") and under the meter,
  but Gift Aid never counts towards the raised figure or the target. The message and the show my
  name choice moved from the give form to an optional step on the thank you after paying, tied to
  the paid Stripe checkout session, once. A finished fundraiser keeps its page at the same address,
  saying so, and still takes gifts; it is no longer listed on Get involved.

  Scenario: a gift with Gift Aid shows its Gift Aid on the wall and under the meter, never in the total
    Given fundraising is switched on
    And an approved fundraiser "Gwens Gift Aid Walk (bdd-fr)" raising 50000 pence
    When a supporter gives 2000 pence with Gift Aid on the page for "Gwens Gift Aid Walk (bdd-fr)", paid as "pi_fr_bdd_giftaid_1"
    Then the fundraising answer is 200
    And the page for "Gwens Gift Aid Walk (bdd-fr)" shows 2000 pence raised of 50000
    When a visitor opens the page for "Gwens Gift Aid Walk (bdd-fr)"
    Then the visitor gets status 200
    And the page shows '£20 <span class="fr-wall__giftaid">+ £5 Gift Aid</span>'
    And the page shows '<p class="fr-meter__giftaid">+ £5 Gift Aid</p>'

  Scenario: a message added after paying appears on the wall, and only once
    Given fundraising is switched on
    And an approved fundraiser "Mos Message Run (bdd-fr)" raising 50000 pence
    When a supporter gives 2500 pence on the page for "Mos Message Run (bdd-fr)", paid as "pi_fr_bdd_after_1"
    Then the fundraising answer is 200
    And the wall for "Mos Message Run (bdd-fr)" shows "Anonymous" with no message
    When the giver adds the message "Go Mo (bdd-fr)" to the wall of "Mos Message Run (bdd-fr)", showing their name
    Then the fundraising answer is 200
    And the wall for "Mos Message Run (bdd-fr)" shows "Alex E." saying "Go Mo (bdd-fr)"
    When the giver adds the message "Again (bdd-fr)" to the wall of "Mos Message Run (bdd-fr)", showing their name
    Then the fundraising answer is 409
    And the wall for "Mos Message Run (bdd-fr)" shows "Alex E." saying "Go Mo (bdd-fr)"

  Scenario: a finished fundraiser's page still shows, and still takes a gift
    Given fundraising is switched on
    And a finished fundraiser "Fis Finished Swim (bdd-fr)" raising 50000 pence, organised by "fi.fr.bdd@example.com"
    When a visitor opens the page for "Fis Finished Swim (bdd-fr)"
    Then the visitor gets status 200
    And the page shows "Finished, thank you"
    And the page shows "You can still give"
    And the page shows "data-fundraiser-id"
    When a supporter gives 2500 pence on the page for "Fis Finished Swim (bdd-fr)", paid as "pi_fr_bdd_finished_1"
    Then the fundraising answer is 200
    And the page for "Fis Finished Swim (bdd-fr)" shows 2500 pence raised of 50000
    And Get involved does not list "Fis Finished Swim (bdd-fr)"
