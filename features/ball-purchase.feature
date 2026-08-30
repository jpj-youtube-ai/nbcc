@ball @db
Feature: Festive Ball purchases through the shared Stripe webhook (TASK-313)
  Ball tickets and donations share ONE Stripe webhook endpoint, so the two must never be
  confused: a ticket is payment for a dinner and a show, not a gift, and recording one as a
  donation would push un-Gift-Aidable money into the Gift Aid claim pipeline.

  Scenario: a paid table is recorded and takes ten seats out of the room
    Given the ball is reset to 40 tables of 10 with 0 held back
    When a paid ball checkout completes for 1 table
    Then the ball response status should be 200
    And a ball booking should exist with status "paid"
    When I request the ball availability
    Then the ball availability should show 390 seats remaining
    And the ball availability should show 39 tables remaining

  Scenario: Stripe redelivering the same event does not sell the room twice
    Given the ball is reset to 40 tables of 10 with 0 held back
    When a paid ball checkout completes for 1 table
    And that same ball event is delivered again
    When I request the ball availability
    Then the ball availability should show 390 seats remaining

  Scenario: an abandoned checkout gives its seats back
    Given the ball is reset to 40 tables of 10 with 0 held back
    And a pending ball booking exists for 1 table
    When I request the ball availability
    Then the ball availability should show 390 seats remaining
    When that ball checkout session expires
    Then the ball response status should be 200
    And I request the ball availability
    And the ball availability should show 400 seats remaining

  Scenario: a donation checkout is never recorded as a ball booking
    Given the ball is reset to 40 tables of 10 with 0 held back
    When a donation checkout completes
    Then no ball booking should have been created
    When I request the ball availability
    Then the ball availability should show 400 seats remaining
