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

  Scenario: buying two seats starts a checkout and holds the seats
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I start a ball checkout for 2 seats
    Then the ball response status should be 201
    And the ball checkout should return a booking reference
    And the ball checkout total should be 20000 pence
    When I request the ball availability
    Then the ball availability should show 398 seats remaining

  Scenario: paying inline returns a client secret instead of a redirect
    # uiMode "embedded" keeps the buyer on nbcc.scot: the endpoint returns a clientSecret and the
    # PUBLIC publishable key the browser needs to build Stripe.js, rather than a URL to send them
    # to. The hosted redirect stays as the fallback for a blocked or broken Stripe.js, so a buyer
    # is never left with a button that does nothing.
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I start an inline ball checkout for 1 seat
    Then the ball response status should be 201
    And the ball checkout should return an inline client secret and publishable key

  Scenario: covering the card fee and adding a Gift Aided donation is charged correctly
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I start a ball checkout for 1 seat with a 2500 donation covering the fee
    Then the ball response status should be 201
    # £100 ticket + £25 donation + the fee on the TICKET only, at 1.2% + 20p: 120 + 20 = 140.
    # The donation carries no fee cover — NBCC absorbs Stripe's cut on a gift (TASK-317).
    And the ball checkout total should be 12640 pence

  Scenario: nine seats at once is allowed, ten is not
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I start a ball checkout for 10 seats
    Then the ball response status should be 400

  Scenario: a table is refused when no unbroken table is left, though seats remain
    Given the ball is reset to 1 tables of 10 with 1 held back
    When I start a ball checkout for 1 table
    Then the ball response status should be 409
    When I start a ball checkout for 2 seats
    Then the ball response status should be 201

  Scenario: no checkout starts once sales are closed
    Given the ball is reset to 40 tables of 10 with 0 held back
    And ball sales are closed by hand
    When I start a ball checkout for 1 seat
    Then the ball response status should be 409

  Scenario: Gift Aid cannot be claimed without a donation
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I start a ball checkout for 1 seat claiming Gift Aid with no donation
    Then the ball response status should be 400

  Scenario: the page Stripe returns a buyer to actually exists
    # The checkout's success_url pointed at /ball/thank-you from the start and nothing served
    # it, so a real payment ended on a 404. Assert the destination RESOLVES, not just that the
    # URL is built correctly.
    When I request "/ball/thank-you"
    Then the ball page status should be 200
    And the ball page should contain "You're coming to the Festive Ball"

  Scenario: the thank-you page is not behind the launch gate
    Given the ball gate is closed
    When I request "/ball/thank-you"
    Then the ball page status should be 200
