@fundraising @db
Feature: The fundraising private area, signed in with an emailed code (TASK-501)
  An organiser goes to /fundraise/manage, puts in the email they signed up with, and we email a
  6 digit code. The answer is the same whether or not the email is signed up. A right code starts a
  short signed in session (an http only cookie), and they see only their own fundraisers. Every
  change they ask for still waits for staff. The QR code is no longer on the public page, which
  ends with a quiet line pointing the organiser to their private area.

  Scenario: an organiser asks for a code, signs in, sees their fundraiser and asks for a change
    Given fundraising is switched on
    And an approved fundraiser "Robins Code Walk (bdd-fr)" raising 50000 pence, organised by "robin.code.fr.bdd@example.com"
    And an approved fundraiser "Someone Elses Swim (bdd-fr)" raising 50000 pence, organised by "other.code.fr.bdd@example.com"
    When the organiser asks for a sign in code for "robin.code.fr.bdd@example.com"
    Then the fundraising answer is 200
    And the organiser of "Robins Code Walk (bdd-fr)" is soon sent a "fundraiseCode" email
    And a sign in code for "robin.code.fr.bdd@example.com" is stored only as a hash
    When "robin.code.fr.bdd@example.com" signs in with the code from their email
    Then the fundraising answer is 200
    And the sign in set an http only session cookie
    When the signed in organiser opens their private area
    Then the fundraising answer is 200
    And the private area lists "Robins Code Walk (bdd-fr)" and not "Someone Elses Swim (bdd-fr)"
    When the signed in organiser asks to change the target of "Robins Code Walk (bdd-fr)" to 75000 pence
    Then the fundraising answer is 202
    And the page for "Robins Code Walk (bdd-fr)" shows 0 pence raised of 50000
    When the signed in organiser asks to change the target of "Someone Elses Swim (bdd-fr)" to 75000 pence
    Then the fundraising answer is 404
    When the signed in organiser signs out
    And the signed in organiser opens their private area
    Then the fundraising answer is 401

  Scenario: an email nobody signed up with gets exactly the same answer, and no email
    Given fundraising is switched on
    And an approved fundraiser "Known Organiser Run (bdd-fr)" raising 50000 pence, organised by "known.code.fr.bdd@example.com"
    When the organiser asks for a sign in code for "known.code.fr.bdd@example.com"
    And the answer is kept to compare
    And the organiser asks for a sign in code for "nobody.code.fr.bdd@example.com"
    Then the fundraising answer is 200
    And the answer is the same as the one kept
    And no sign in code is stored for "nobody.code.fr.bdd@example.com"
    And no "fundraiseCode" email went to "nobody.code.fr.bdd@example.com"

  Scenario: a wrong code lets nobody in
    Given fundraising is switched on
    And an approved fundraiser "Wrong Code Walk (bdd-fr)" raising 50000 pence, organised by "wrong.code.fr.bdd@example.com"
    When the organiser asks for a sign in code for "wrong.code.fr.bdd@example.com"
    And a sign in code for "wrong.code.fr.bdd@example.com" is stored only as a hash
    And "wrong.code.fr.bdd@example.com" signs in with the wrong code
    Then the fundraising answer is 401
    And the sign in set no cookie
