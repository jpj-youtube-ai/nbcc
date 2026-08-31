@ball @db
Feature: Festive Ball availability (TASK-313)
  The public ticket page reads live availability so it can show what is left and stop
  selling when the room is full.

  Scenario: a fresh ball offers every seat and every table
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I request the ball availability
    Then the ball response status should be 200
    And the ball availability should show 400 seats remaining
    And the ball availability should show 40 tables remaining
    And the ball availability should say sales are open

  Scenario: held-back seats reduce what the public can buy
    Given the ball is reset to 40 tables of 10 with 10 held back
    When I request the ball availability
    Then the ball availability should show 390 seats remaining
    And the ball availability should show 39 tables remaining

  Scenario: one loose seat breaks a table, so seats and tables run out differently
    Given the ball is reset to 40 tables of 10 with 1 held back
    When I request the ball availability
    Then the ball availability should show 399 seats remaining
    And the ball availability should show 39 tables remaining

  Scenario: closing sales by hand stops the page selling
    Given the ball is reset to 40 tables of 10 with 0 held back
    And ball sales are closed by hand
    When I request the ball availability
    Then the ball availability should say sales are closed

  Scenario: the page is told the live card rate, so it quotes what NBCC is really charged
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I request the ball availability
    Then the ball response status should be 200
    And the ball availability should show a card fee of 120 basis points plus 20p

  Scenario: the endpoint never exposes buyer details
    Given the ball is reset to 40 tables of 10 with 0 held back
    When I request the ball availability
    Then the ball availability should not contain buyer details
