@fundraising @events @db
Feature: 18 or over, and sharing what is raised with another cause
  The sign up asks everyone, on both paths, whether they are 18 or over, and refuses a sign up
  without a Yes. It asks whether what they raise is shared with another cause; if it is, NBCC's
  percentage and the other cause's name make the statement the Charities and Benevolent Fundraising
  (Scotland) Regulations 2009 ask for, on the page and on every material. Organisers can never
  change the split; an admin may correct it, but only before the first gift. Every name here, the
  other cause's included, is invented.

  Scenario: someone under 18 cannot sign up, and nothing is stored
    Given fundraising is switched on
    When someone under 18 signs up "Ella's Birthday Bake (bdd-fr)"
    Then the fundraising answer is 400
    And the fundraising answer names the field "over18"
    And no fundraiser called "Ella's Birthday Bake (bdd-fr)" is stored

  Scenario: a shared fundraiser says so on its page and its poster
    Given fundraising is switched on
    And a fundraising staff member "a1.split.fr.bdd@example.com" with role "admin"
    When someone signs up "Sam's Shared Walk (bdd-fr)" sharing 60 percent with "Kilmarnock Food Larder"
    Then the fundraising answer is 200
    And "Sam's Shared Walk (bdd-fr)" is stored as 18 or over, sharing 60 percent with "Kilmarnock Food Larder"
    When "a1.split.fr.bdd@example.com" approves "Sam's Shared Walk (bdd-fr)"
    And a visitor opens the page for "Sam's Shared Walk (bdd-fr)"
    Then the page shows "60% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Kilmarnock Food Larder."
    And the page shows "Everything you give on this page goes to NBCC."
    When "a1.split.fr.bdd@example.com" opens the "poster" of "Sam's Shared Walk (bdd-fr)"
    Then the page shows "60% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Kilmarnock Food Larder."

  Scenario: an admin may correct the split before the first gift, and never after
    Given fundraising is switched on
    And a fundraising staff member "a2.split.fr.bdd@example.com" with role "admin"
    And a fundraising staff member "e2.split.fr.bdd@example.com" with role "editor"
    When someone signs up "Kim's Shared Swim (bdd-fr)" sharing 50 percent with "Kilmarnock Food Larder"
    And "a2.split.fr.bdd@example.com" approves "Kim's Shared Swim (bdd-fr)"
    And "e2.split.fr.bdd@example.com" corrects the split of "Kim's Shared Swim (bdd-fr)" to 70 percent
    Then the fundraising answer is 403
    When "a2.split.fr.bdd@example.com" corrects the split of "Kim's Shared Swim (bdd-fr)" to 70 percent
    Then the fundraising answer is 200
    And "Kim's Shared Swim (bdd-fr)" is stored as 18 or over, sharing 70 percent with "Kilmarnock Food Larder"
    When a supporter gives 2500 pence on the page for "Kim's Shared Swim (bdd-fr)", paid as "pi_fr_bdd_split_1"
    And "a2.split.fr.bdd@example.com" corrects the split of "Kim's Shared Swim (bdd-fr)" to 80 percent
    Then the fundraising answer is 409
    And "Kim's Shared Swim (bdd-fr)" is stored as 18 or over, sharing 70 percent with "Kilmarnock Food Larder"

  Scenario: an event shared with another cause says so on its card on Get involved
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a3.split.fr.bdd@example.com" with role "admin"
    When someone signs up the event "Shared Quiz Night (bdd-fr)" sharing 60 percent with "Kilmarnock Food Larder"
    Then the fundraising answer is 200
    When "a3.split.fr.bdd@example.com" keeps the short name of "Shared Quiz Night (bdd-fr)"
    And "a3.split.fr.bdd@example.com" approves "Shared Quiz Night (bdd-fr)"
    And a visitor opens "/get-involved"
    Then the visitor gets status 200
    And the card for "Shared Quiz Night (bdd-fr)" shows "60% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Kilmarnock Food Larder."
