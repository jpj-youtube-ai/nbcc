@fundraising @db
Feature: Small fixes to community fundraising
  A team organiser can tick "This person is under 18" beside someone they add, and the invite then
  speaks to their parent or guardian. An event's QR code prints on one clean A4 page. A Do it again
  link that ever opens a page in memory of someone fills in the gentle in memory path. And a welcome
  pack never changes a request staff sent again by hand in Requests. Every name, team and address
  here is invented.

  Scenario: a team member ticked as under 18 is invited through their parent or guardian
    Given fundraising is switched on
    And a fundraising staff member "a1.smallfix.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Smallfix Juniors (bdd-fr)" adding "Jack" as under 18 at "parent.smallfix.fr.bdd@example.com" and "Ava" at "ava.smallfix.fr.bdd@example.com"
    Then the fundraising answer is 200
    And the person held at "parent.smallfix.fr.bdd@example.com" on "Smallfix Juniors (bdd-fr)" is marked under 18
    And the person held at "ava.smallfix.fr.bdd@example.com" on "Smallfix Juniors (bdd-fr)" is not marked under 18
    When "a1.smallfix.fr.bdd@example.com" approves "Smallfix Juniors (bdd-fr)"
    Then the team invite sent to "parent.smallfix.fr.bdd@example.com" has the subject "Robin has invited Jack to join Smallfix Juniors (bdd-fr)"
    And the team invite sent to "ava.smallfix.fr.bdd@example.com" has the subject "Robin has invited you to join Smallfix Juniors (bdd-fr)"
    When the invite to "parent.smallfix.fr.bdd@example.com" on "Smallfix Juniors (bdd-fr)" is opened
    Then the join form is told the person joining is under 18
    When the invite to "ava.smallfix.fr.bdd@example.com" on "Smallfix Juniors (bdd-fr)" is opened
    Then the join form is not told the person joining is under 18

  Scenario: staff print an event's QR code on one A4 page
    Given fundraising is switched on
    And a fundraising staff member "v1.smallfix.fr.bdd@example.com" with role "viewer"
    And an approved event "Smallfix Quiz Night (bdd-fr)" asking for 2 posters
    When "v1.smallfix.fr.bdd@example.com" opens the QR code to print for "Smallfix Quiz Night (bdd-fr)"
    Then the fundraising answer is 200
    And the QR code page is one A4 page
    And the QR code page shows "Smallfix Quiz Night (bdd-fr)"
    And the QR code page shows the event's own web address
    And the QR code page shows "Scottish Charitable Incorporated Organisation"

  Scenario: the QR code to print needs a session
    Given fundraising is switched on
    And an approved event "Smallfix Coffee Morning (bdd-fr)" asking for 2 posters
    When the QR code to print for "Smallfix Coffee Morning (bdd-fr)" is opened without a session
    Then the fundraising answer is 401

  Scenario: a Do it again link for a page in memory of someone opens the gentle in memory path
    Given fundraising is switched on
    And an approved page in memory of "Jean Smallfixexample (bdd-fr)" asking for 5 collection envelopes
    And a Do it again link for "In memory of Jean Smallfixexample (bdd-fr)" whose token we know
    When the sign up form asks for that Do it again link
    Then the fundraising answer is 200
    And the form is given the in memory path, remembering "Jean Smallfixexample (bdd-fr)"

  Scenario: the pack never changes a request staff sent again by hand
    Given fundraising is switched on
    And a fundraising staff member "e1.smallfix.fr.bdd@example.com" with role "editor"
    And an approved sporting fundraiser "Robin's Smallfix Walk (bdd-fr)" with the T-shirt size "adult_m" asking for 10 posters
    When "e1.smallfix.fr.bdd@example.com" ticks "posters_a4" in the pack for "Robin's Smallfix Walk (bdd-fr)"
    Then the posters request for "Robin's Smallfix Walk (bdd-fr)" is stored as "sent" with 10
    When "e1.smallfix.fr.bdd@example.com" undoes the posters sent to "Robin's Smallfix Walk (bdd-fr)" by hand in Requests
    And "e1.smallfix.fr.bdd@example.com" unticks "posters_a4" in the pack for "Robin's Smallfix Walk (bdd-fr)"
    And "e1.smallfix.fr.bdd@example.com" marks 7 posters as sent to "Robin's Smallfix Walk (bdd-fr)" by hand in Requests
    Then the fundraising answer is 200
    When "e1.smallfix.fr.bdd@example.com" ticks "posters_a4" in the pack for "Robin's Smallfix Walk (bdd-fr)"
    Then the fundraising answer is 200
    And the posters request for "Robin's Smallfix Walk (bdd-fr)" stands as staff left it: "sent" with 7
    When "e1.smallfix.fr.bdd@example.com" unticks "posters_a4" in the pack for "Robin's Smallfix Walk (bdd-fr)"
    Then the posters request for "Robin's Smallfix Walk (bdd-fr)" stands as staff left it: "sent" with 7
