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

  Scenario: A transfer paid and then cancelled cannot be brought back
    Given bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    And "ann.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    And "ed.transfer.admin.bdd@example.com" cancels it
    And "ann.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    Then the admin answer is 409

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
    And its reminder has gone
    And "ed.transfer.admin.bdd@example.com" gives it until 14 days from today
    Then the admin answer is 200
    And the booking's pay-by date is 14 days from today
    And it will be reminded again before the new date

  # TASK-485: deadlines.
  Scenario: After the last day for transfers, the page offers card only
    Given bank transfer is switched on with bank details
    And the last day for transfers was yesterday
    When I request the ball availability
    Then the ball availability should not offer bank transfer
    When a buyer books 1 table to pay by bank transfer
    Then the transfer booking answer is 409 saying "has closed"

  Scenario: A booking made close to the last day must be paid by that day
    Given bank transfer is switched on with bank details
    And the last day for transfers is 3 days from today
    When a buyer books 1 table to pay by bank transfer
    Then the booking must be paid by the last day for transfers

  Scenario: A transfer booking past its pay-by date is flagged for staff, not cancelled
    Given a bank transfer booking for 1 table was due to be paid 2 days ago
    When "ann.transfer.admin.bdd@example.com" lists the bookings awaiting a transfer
    Then that booking is listed as overdue
    And it is still holding its seats

  Scenario: A card checkout left pending for over an hour no longer holds seats
    Given a card checkout for 1 table was started 2 hours ago and never finished
    When I request the ball availability
    Then the ball availability should show 10 tables remaining

  # Its seats were released after an hour; the payment is real, so it is recorded, and flagged.
  Scenario: A card payment confirmed after its seats were released is recorded and flagged
    Given the ball is reset to 1 tables of 10 with 0 held back
    And a card checkout for 1 table was started 2 hours ago and never finished
    And bank transfer is switched on with bank details
    When a buyer books 1 table to pay by bank transfer
    Then the transfer booking answer is 201 with the bank details and a pay-by date 7 days away
    When Stripe confirms the old card checkout was paid
    Then the old card checkout is paid and flagged as paid after its seats were released, overbooking the room

  Scenario: A bank transfer booking keeps its seats however old it is
    Given a bank transfer booking for 1 table was made 3 days ago
    When I request the ball availability
    Then the ball availability should show 9 tables remaining

  Scenario: An inline checkout replaced by Stripe's own page leaves one booking holding seats
    When I start an inline ball checkout for 1 seat
    And the buyer falls back to Stripe's own page for the same order
    Then exactly one pending card booking should hold seats

  # TASK-486: invoices.
  Scenario: A company that needs an invoice gets 14 days and a private invoice page
    Given bank transfer is switched on with bank details
    When a company books 1 table to pay by bank transfer with an invoice
    Then the transfer booking answer is 201 with the bank details and a pay-by date 14 days away
    And the booking keeps the company's invoice details, without Gift Aid
    When I open the invoice link
    Then the invoice page shows the company, the reference and the bank details
    And the invoice page is private and kept out of search engines
    When "ann.transfer.admin.bdd@example.com" lists the bookings awaiting a transfer
    Then the booking is listed with its company and a link to its invoice
    When "ann.transfer.admin.bdd@example.com" marks it paid confirming the right amount
    And I open the invoice link
    Then the invoice page says it is paid

  Scenario: An invoice needs the company's name and address
    Given bank transfer is switched on with bank details
    When a company books 1 table to pay by bank transfer with an invoice but no address
    Then the transfer booking answer is 400

  Scenario: An altered invoice link opens nothing
    Given bank transfer is switched on with bank details
    When a company books 1 table to pay by bank transfer with an invoice
    And I open the invoice link with its signature altered
    Then the invoice page is not found

  # TASK-487: telling the team.
  Scenario: A new bank transfer booking puts the New pill on Festive Ball
    Given bank transfer is switched on with bank details
    And "ann.transfer.admin.bdd@example.com" has just opened Festive Ball
    Then Festive Ball is not new to "ann.transfer.admin.bdd@example.com"
    When a buyer books 1 table to pay by bank transfer
    Then Festive Ball is new to "ann.transfer.admin.bdd@example.com"

  # TASK-488: staff add a booking for a phone or email order.
  Scenario: Staff add a booking for a phone order before the ticket page offers bank transfer
    Given the bank details are entered but bank transfer is switched off
    When "ed.transfer.admin.bdd@example.com" adds a bank transfer booking for 1 table
    Then the admin answer is 201
    And the added booking holds its seats with no Gift Aid, recorded as added by "ed.transfer.admin.bdd@example.com"
    When I request the ball availability
    Then the ball availability should show 9 tables remaining
    And the ball availability should not offer bank transfer

  Scenario: Adding a booking by hand needs Festive Ball edit
    Given an admin user "vic.transfer.admin.bdd@example.com" with role "viewer" and password "transfer-pw-123"
    And the bank details are entered but bank transfer is switched off
    When "vic.transfer.admin.bdd@example.com" adds a bank transfer booking for 1 table
    Then the admin answer is 403
