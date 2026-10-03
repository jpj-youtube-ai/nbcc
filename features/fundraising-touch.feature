@fundraising @fundraising-touch @db
Feature: Keeping in touch with fundraisers (TASK-515)
  Friendly automatic emails go to an organiser at the right moments, but only once an admin has
  read them all in Admin > Fundraising and switched them on: they ship switched off. Each goes once
  at most, never to anyone who has asked us to stop, and the thank you goes when staff mark a
  fundraiser finished. Staff see smart call prompts and record the calls they make. Every name and
  address here is invented.

  Scenario: the automatic emails ship switched off, and only an admin switches them on
    Given a fundraising staff member "a1.touch.fr.bdd@example.com" with role "admin"
    And a fundraising staff member "e1.touch.fr.bdd@example.com" with role "editor"
    When "e1.touch.fr.bdd@example.com" reads the automatic emails
    Then the fundraising answer is 200
    And the automatic emails are said to be off
    When "e1.touch.fr.bdd@example.com" switches the automatic emails on
    Then the fundraising answer is 403
    When "a1.touch.fr.bdd@example.com" switches the automatic emails on
    Then the fundraising answer is 200
    And the automatic emails are switched on in the database

  Scenario: every automatic email can be read before any is sent
    Given a fundraising staff member "v2.touch.fr.bdd@example.com" with role "viewer"
    When "v2.touch.fr.bdd@example.com" reads the "target" automatic email
    Then the fundraising answer is 200
    And the automatic email's subject is "You did it! Target reached"

  Scenario: nothing is sent while the automatic emails are switched off
    Given fundraising is switched on
    And the automatic emails are switched off
    And an approved fundraiser "Kit's Walk (bdd-fr)" a week from today, organised by "kit.touch.fr.bdd@example.com"
    When the daily automatic emails run
    Then no "fundraiseWeekBefore" email went to "kit.touch.fr.bdd@example.com"

  Scenario: a week before the date, once and only once
    Given fundraising is switched on
    And the automatic emails are switched on
    And an approved fundraiser "Lee's Walk (bdd-fr)" a week from today, organised by "lee.touch.fr.bdd@example.com"
    When the daily automatic emails run
    Then a "fundraiseWeekBefore" email went to "lee.touch.fr.bdd@example.com"
    And the history of "Lee's Walk (bdd-fr)" records "fundraiser.touch_sent"
    When the daily automatic emails run
    Then exactly 1 "fundraiseWeekBefore" email went to "lee.touch.fr.bdd@example.com"

  Scenario: nothing goes to an address that asked us to stop
    Given fundraising is switched on
    And the automatic emails are switched on
    And an approved fundraiser "Mo's Walk (bdd-fr)" a week from today, organised by "mo.touch.fr.bdd@example.com"
    And "mo.touch.fr.bdd@example.com" has asked us to stop all emails
    When the daily automatic emails run
    Then no "fundraiseWeekBefore" email went to "mo.touch.fr.bdd@example.com"

  Scenario: marking a fundraiser finished sends the thank you with the certificate
    Given fundraising is switched on
    And the automatic emails are switched on
    And a fundraising staff member "e3.touch.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Nat's Dash (bdd-fr)" raising 50000 pence, organised by "nat.touch.fr.bdd@example.com"
    When "e3.touch.fr.bdd@example.com" marks "Nat's Dash (bdd-fr)" finished
    Then the fundraising answer is 200
    And a "fundraiseFinished" email went to "nat.touch.fr.bdd@example.com"

  Scenario: a call about a prompt is recorded by an editor, never by a viewer
    Given a fundraising staff member "e4.touch.fr.bdd@example.com" with role "editor"
    And a fundraising staff member "v4.touch.fr.bdd@example.com" with role "viewer"
    And an approved fundraiser "Oz's Run (bdd-fr)" raising 50000 pence
    When "v4.touch.fr.bdd@example.com" records a call about "sponsor_form" for "Oz's Run (bdd-fr)"
    Then the fundraising answer is 403
    When "e4.touch.fr.bdd@example.com" records a call about "sponsor_form" for "Oz's Run (bdd-fr)"
    Then the fundraising answer is 200
    And the history of "Oz's Run (bdd-fr)" records "fundraiser.prompt_called"

  Scenario: Do it again fills in the form from last year, once
    Given fundraising is switched on
    And a finished fundraiser "Pat's Dash 2025 (bdd-fr)" raising 40000 pence, organised by "pat.touch.fr.bdd@example.com"
    And a Do it again link for "Pat's Dash 2025 (bdd-fr)" whose token we know
    When the sign up form asks for that Do it again link
    Then the fundraising answer is 200
    And the form is given last year's details for "pat.touch.fr.bdd@example.com", and nothing about givers
    When someone signs up "Pat's Dash Again (bdd-fr)" from that Do it again link
    Then the fundraising answer is 200
    And the Do it again link is used by "Pat's Dash Again (bdd-fr)"
    And "Pat's Dash Again (bdd-fr)" is waiting for staff to approve it
    When the sign up form asks for that Do it again link
    Then the fundraising answer is 404
