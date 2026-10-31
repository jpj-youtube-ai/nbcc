@ball @db
Feature: The top of the home page
  The big logo and "Where would you like to start?" with its four gift tags. The printed advert's QR
  code lands here, so the Festive Ball's banner and feature have to carry on landing around them.

  @until-the-ball
  Scenario: with the gate open the Ball's promotion lands around the new top
    Given the ball gate is open
    When I request "/"
    Then the ball page status should be 200
    And the ball page should contain "ball-banner"
    And the ball page should contain "ball-home-feature"
    And the ball page should contain "Book tickets"
    And the ball page should contain "Where would you like to start?"
    And the ball page should contain "Donate now"
    And the ball page should contain "What we do all year"

  Scenario: with the gate shut the tags are there and the Ball is not
    Given the ball gate is closed
    When I request "/"
    Then the ball page status should be 200
    And the ball page should contain "Where would you like to start?"
    And the ball page should contain "/assets/img/nbcc-logo-full.svg"
    And the ball page should not contain "ball-banner"

  Scenario: the tags lead to the live sign up sites and to the pages that explain them
    Given the ball gate is closed
    When I request "/"
    Then the ball page should contain "https://drop.nbcc.scot/sign-up"
    And the ball page should contain "https://referrals.nbcc.scot/sign-in"
    And the ball page should contain "https://vol.nbcc.scot/sign-up"
    And the ball page should contain "/get-involved/drop-off-points"
    And the ball page should contain "/get-involved/referrals"
    And the ball page should contain "/get-involved/volunteer"
