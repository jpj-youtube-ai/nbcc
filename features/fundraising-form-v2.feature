@fundraising @events @db
Feature: The fundraising sign up form, round two, and short page links (TASK-511)
  The sign up asks for the first name and the surname apart, Instagram and Facebook in boxes of
  their own, every yes or no on purpose, and printed QR codes. A new sign up's page link is short:
  the initials of its name, with a number on a clash. When staff change a page's link, the old one
  keeps working and sends people on to the new one, so a QR code printed with it never breaks, and
  no other page can ever take it. Every name and address here is invented.

  Scenario: a sign up with the new answers gets a short page link from its initials
    Given fundraising is switched on
    And a fundraising staff member "a1.v2.fr.bdd@example.com" with role "admin"
    When someone signs up "Sam's Santa Dash (bdd-fr)" with the round two answers
    Then the fundraising answer is 200
    And the fundraiser "Sam's Santa Dash (bdd-fr)" has the short page link "ssdbf"
    And the fundraiser "Sam's Santa Dash (bdd-fr)" is stored with the round two answers
    When "a1.v2.fr.bdd@example.com" approves "Sam's Santa Dash (bdd-fr)"
    And a visitor opens the page for "Sam's Santa Dash (bdd-fr)"
    Then the visitor gets status 200
    And the page shows "Sam&#39;s Santa Dash (bdd-fr)"

  Scenario: a second sign up with the same initials takes the next number
    Given fundraising is switched on
    When someone signs up "Sam's Santa Dash (bdd-fr)" with the round two answers
    And someone signs up "Sue's Snowy Dip (bdd-fr)" with the round two answers
    Then the fundraiser "Sue's Snowy Dip (bdd-fr)" has the short page link "ssdbf2"

  Scenario: an old page link sends people on to the new one, and is never given to another page
    Given fundraising is switched on
    And a fundraising staff member "a2.v2.fr.bdd@example.com" with role "admin"
    And an approved fundraiser "Kim's Coastal Walk (bdd-fr)" raising 50000 pence
    And an approved fundraiser "Lee's Long Swim (bdd-fr)" raising 50000 pence
    When "a2.v2.fr.bdd@example.com" gives "Kim's Coastal Walk (bdd-fr)" a new page link
    Then the fundraising answer is 200
    When a visitor opens the old page link of "Kim's Coastal Walk (bdd-fr)" with "?utm_source=poster"
    Then the visitor gets status 301
    And the visitor is sent to the new page link of "Kim's Coastal Walk (bdd-fr)" with "?utm_source=poster"
    When "a2.v2.fr.bdd@example.com" gives "Lee's Long Swim (bdd-fr)" the old page link of "Kim's Coastal Walk (bdd-fr)"
    Then the fundraising answer is 409
