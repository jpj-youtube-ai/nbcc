@ball @db
Feature: The Ball's moment
  At 20:00 on Saturday 7 November 2026 the Festive Ball's promotion comes down by itself. Until then
  the pages are as they are. Adding ?at=after-ball to the address of a page the spec names shows that
  one view as it will be after the moment, so it can be checked before the night.

  Scenario: ?at=after-ball shows the home page without the Ball's promotion
    Given the ball gate is open
    When I request "/?at=after-ball"
    Then the ball page status should be 200
    And the ball page should not contain "ball-banner"
    And the ball page should not contain "ball-home-feature"
    And the nav should not mention the Festive Ball
    And the ball page should contain "Where would you like to start?"

  @until-the-ball
  Scenario: the view that follows is the ordinary home page
    Given the ball gate is open
    When I request "/?at=after-ball"
    And I request "/"
    Then the ball page should contain "ball-banner"
    And the nav should offer the Festive Ball

  Scenario: the Ball's own page does not change
    Given the ball gate is open
    When I request "/ball?at=after-ball"
    Then the ball page status should be 200
    And the nav should offer the Festive Ball
