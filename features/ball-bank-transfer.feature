@admin @ball-transfer
Feature: Paying for the Festive Ball by bank transfer (TASK-484)
  A buyer can book to pay by bank transfer once an admin has entered the bank details and switched
  it on. The booking holds its seats until an admin marks the money arrived, or staff cancel it.
  Only an admin may set the bank details or mark money arrived; Festive Ball edit is enough to give
  more time or cancel.

  Background:
    Given the ball is reset to 10 tables of 10 with 0 held back
    And an admin user "ann.transfer.admin.bdd@example.com" with role "admin" and password "transfer-pw-123"
    And an admin user "ed.transfer.admin.bdd@example.com" with role "editor" and password "transfer-pw-123"
    And "ed.transfer.admin.bdd@example.com" has Festive Ball edit access

  Scenario: Switched off, the page offers card only
    When I request the ball availability
    Then the ball availability should not offer bank transfer
    When a buyer books 1 table to pay by bank transfer
    Then the transfer booking answer is 409

  Scenario: Only an admin sets the bank details
    When "ed.transfer.admin.bdd@example.com" sets the bank details and switches transfer on
    Then the admin answer is 403
    When "ann.transfer.admin.bdd@example.com" sets the bank details and switches transfer on
    Then the admin answer is 200
    When I request the ball availability
    Then the ball availability should offer bank transfer without giving the bank details

  Scenario: A transfer booking holds its seats and is marked paid by an admin
    Given bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    Then the transfer booking answer is 201 with the bank details and a pay-by date 7 days away
    When I request the ball availability
    Then the ball availability should show 9 tables remaining
    When "ed.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    Then the admin answer is 403
    When "ann.transfer.admin.bdd@example.com" marks it paid confirming the wrong amount
    Then the admin answer is 409
    When "ann.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    Then the admin answer is 200
    And the booking is paid with a guest link, marked paid by "ann.transfer.admin.bdd@example.com"

  Scenario: A buyer who wants more can book again before paying
    Given bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    And the same buyer books 1 table to pay by bank transfer
    Then the transfer booking answer is 201 with the bank details and a pay-by date 7 days away
    When I request the ball availability
    Then the ball availability should show 8 tables remaining

  Scenario: A cancelled transfer booking comes back when its money arrives, if its seats are free
    Given bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    And "ed.transfer.admin.bdd@example.com" cancels it
    Then the admin answer is 200
    When "ann.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    Then the admin answer is 200
    And the booking is paid with a guest link, marked paid by "ann.transfer.admin.bdd@example.com"

  Scenario: A cancelled transfer booking cannot come back once its seats are sold
    Given the ball is reset to 1 tables of 10 with 0 held back
    And bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    And "ed.transfer.admin.bdd@example.com" cancels it
    And a paid ball checkout completes for 1 table
    And "ann.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    Then the admin answer is 409

  Scenario: More time is given by someone with Festive Ball edit
    Given bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    And "ed.transfer.admin.bdd@example.com" gives it until 14 days from today
    Then the admin answer is 200
    And the booking's pay-by date is 14 days from today

  Scenario: A card checkout left pending for over an hour no longer holds seats
    Given a card checkout for 1 table was started 2 hours ago and never finished
    When I request the ball availability
    Then the ball availability should show 10 tables remaining

  Scenario: A bank transfer booking keeps its seats however old it is
    Given a bank transfer booking for 1 table was made 3 days ago
    When I request the ball availability
    Then the ball availability should show 9 tables remaining

  Scenario: An inline checkout replaced by Stripe's own page leaves one booking holding seats
    When I start an inline ball checkout for 1 seat
    And the buyer falls back to Stripe's own page for the same order
    Then exactly one pending card booking should hold seats
