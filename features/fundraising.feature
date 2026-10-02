@fundraising @db
Feature: Community fundraising, the core (TASK-493)
  People sign up at /fundraise to raise money or hold an event for NBCC. Staff approve every one
  before anything about it is public, and nothing shows at all while fundraising is switched off.
  A fundraiser's page has a meter (paid online gifts plus cash paid in) and a supporter wall staff
  can tidy. Organisers change their page by an emailed link, and every change waits for staff.

  Scenario: a sign up shows only once it is approved, and only while fundraising is on
    Given fundraising is switched on
    And a fundraising staff member "a1.fr.bdd@example.com" with role "admin"
    When someone signs up "Robin's Santa Dash (bdd-fr)" to raise 50000 pence, to be shown on the website
    Then the fundraising answer is 200
    And the fundraiser "Robin's Santa Dash (bdd-fr)" is stored with status "new"
    And the organiser of "Robin's Santa Dash (bdd-fr)" was sent a "fundraiseThanks" email
    And a "fundraiseStaff" email went to the events inbox about "Robin's Santa Dash (bdd-fr)"
    And Get involved does not list "Robin's Santa Dash (bdd-fr)"
    And the page for "Robin's Santa Dash (bdd-fr)" is not found
    And "robin.fr.bdd@example.com" is not on the newsletter list
    When "a1.fr.bdd@example.com" approves "Robin's Santa Dash (bdd-fr)"
    Then the fundraising answer is 200
    And the organiser of "Robin's Santa Dash (bdd-fr)" was sent a "fundraiseApproved" email
    And Get involved lists "Robin's Santa Dash (bdd-fr)"
    And the page for "Robin's Santa Dash (bdd-fr)" shows 0 pence raised of 50000
    When fundraising is switched off
    Then Get involved lists no fundraisers and says fundraising is off
    And the page for "Robin's Santa Dash (bdd-fr)" is not found

  Scenario: ticking the newsletter box on the sign up subscribes the organiser like the footer form
    Given fundraising is switched on
    When someone signs up "Jo's Coffee Morning (bdd-fr)" to raise 20000 pence, ticking the newsletter box
    Then the fundraising answer is 200
    And "jo.fr.bdd@example.com" is on the newsletter list as a self signup from the fundraising form

  Scenario: a gift on the page raises the meter and joins the wall; cash adds; a hidden message goes, the gift stays
    Given fundraising is switched on
    And a fundraising staff member "e2.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Sam's Walk (bdd-fr)" raising 50000 pence
    When a supporter gives 2500 pence on the page for "Sam's Walk (bdd-fr)" with the message "Go Sam (bdd-fr)", showing their name, paid as "pi_fr_bdd_gift_1"
    Then the fundraising answer is 200
    And the page for "Sam's Walk (bdd-fr)" shows 2500 pence raised of 50000
    And the wall for "Sam's Walk (bdd-fr)" shows "Alex E." saying "Go Sam (bdd-fr)"
    When "e2.fr.bdd@example.com" adds 1000 pence of cash paid in to "Sam's Walk (bdd-fr)"
    Then the fundraising answer is 201
    And the page for "Sam's Walk (bdd-fr)" shows 3500 pence raised of 50000
    When "e2.fr.bdd@example.com" hides the message paid as "pi_fr_bdd_gift_1" on "Sam's Walk (bdd-fr)"
    Then the fundraising answer is 200
    And the wall for "Sam's Walk (bdd-fr)" shows "Alex E." with no message
    And the page for "Sam's Walk (bdd-fr)" shows 3500 pence raised of 50000
    And the history of "Sam's Walk (bdd-fr)" records "fundraiser.cash_added" and "fundraiser.message_hidden" by "e2.fr.bdd@example.com"

  Scenario: a gift naming a fundraiser that is not approved is an ordinary donation
    Given fundraising is switched on
    And a fundraiser "Not Yet (bdd-fr)" that is still new
    When a supporter gives 2500 pence on the page for "Not Yet (bdd-fr)" with the message "Hello (bdd-fr)", showing their name, paid as "pi_fr_bdd_gift_2"
    Then the fundraising answer is 200
    And the donation paid as "pi_fr_bdd_gift_2" belongs to no fundraiser and carries no message

  Scenario: an organiser's change waits until staff approve it
    Given fundraising is switched on
    And a fundraising staff member "e3.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Kim's Quiz (bdd-fr)" raising 50000 pence, organised by "kim.fr.bdd@example.com"
    When the organiser asks for a manage link for "kim.fr.bdd@example.com"
    Then the fundraising answer is 200
    And the organiser of "Kim's Quiz (bdd-fr)" was sent a "fundraiseManage" email
    And "Kim's Quiz (bdd-fr)" has a manage link stored only as a hash
    Given the organiser of "Kim's Quiz (bdd-fr)" holds a manage link
    When the organiser changes the target of "Kim's Quiz (bdd-fr)" to 75000 pence by their link
    Then the fundraising answer is 202
    And the page for "Kim's Quiz (bdd-fr)" shows 0 pence raised of 50000
    When "e3.fr.bdd@example.com" approves the waiting change to "Kim's Quiz (bdd-fr)"
    Then the fundraising answer is 200
    And the page for "Kim's Quiz (bdd-fr)" shows 0 pence raised of 75000
    And the organiser of "Kim's Quiz (bdd-fr)" was sent a "fundraiseEditApproved" email

  Scenario: who may do what in Admin > Fundraising
    Given fundraising is switched off
    And a fundraising staff member "v4.fr.bdd@example.com" with role "viewer"
    And a fundraising staff member "e4.fr.bdd@example.com" with role "editor"
    And a fundraising staff member "a4.fr.bdd@example.com" with role "admin"
    And a fundraiser "Bake Sale (bdd-fr)" that is still new
    When the fundraising list is read without a session
    Then the fundraising answer is 401
    When "v4.fr.bdd@example.com" reads the fundraising list
    Then the fundraising answer is 200
    When "v4.fr.bdd@example.com" approves "Bake Sale (bdd-fr)"
    Then the fundraising answer is 403
    When "e4.fr.bdd@example.com" switches fundraising on
    Then the fundraising answer is 403
    When "a4.fr.bdd@example.com" switches fundraising on
    Then the fundraising answer is 200
    And fundraising is on

  # TASK-497: the "you're approved, your page will appear" email is retired. A page holder approved
  # while fundraising is off waits, and hears their page is live when an admin switches it on.
  Scenario: a page approved while fundraising is off hears it is live when fundraising is switched on
    Given fundraising is switched off
    And a fundraising staff member "a5.fr.bdd@example.com" with role "admin"
    And a fundraiser "Lee's Bake Off (bdd-fr)" that is still new, organised by "lee.fr.bdd@example.com"
    When "a5.fr.bdd@example.com" approves "Lee's Bake Off (bdd-fr)"
    Then the fundraising answer is 200
    And the organiser of "Lee's Bake Off (bdd-fr)" was not sent a "fundraiseApproved" email
    And "Lee's Bake Off (bdd-fr)" is waiting for its live email
    When "a5.fr.bdd@example.com" switches fundraising on
    Then the fundraising answer is 200
    And the organiser of "Lee's Bake Off (bdd-fr)" is soon sent a "fundraiseApproved" email
    And "Lee's Bake Off (bdd-fr)" is not waiting for its live email

  # TASK-497: a change staff hold back is not applied, and the organiser is told we will ring.
  Scenario: an organiser hears when staff reject their change
    Given fundraising is switched on
    And a fundraising staff member "e6.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Pat's Swim (bdd-fr)" raising 50000 pence, organised by "pat.fr.bdd@example.com"
    And the organiser of "Pat's Swim (bdd-fr)" holds a manage link
    When the organiser changes the target of "Pat's Swim (bdd-fr)" to 75000 pence by their link
    Then the fundraising answer is 202
    When "e6.fr.bdd@example.com" rejects the waiting change to "Pat's Swim (bdd-fr)"
    Then the fundraising answer is 200
    And the organiser of "Pat's Swim (bdd-fr)" was sent a "fundraiseEditRejected" email
    And the page for "Pat's Swim (bdd-fr)" shows 0 pence raised of 50000
