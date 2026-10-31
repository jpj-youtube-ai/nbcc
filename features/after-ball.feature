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

  Scenario: ?at=after-ball brings Fill a Red Bag's stage to the home page
    When I request "/?at=after-ball"
    Then the ball page status should be 200
    And the ball page should contain "id=\"fillBand\""
    And the ball page should contain "/assets/js/red-bag-stage.js"
    And the ball page should contain "/assets/css/red-bag-stage.css"
    And the ball page should contain "<a href=\"/fill\">Fill a Red Bag</a>"

  Scenario: ?at=after-ball offers Fill a Red Bag on the drop-off page
    When I request "/get-involved/drop-off-points?at=after-ball"
    Then the ball page status should be 200
    And the ball page should contain "You can still fill a Red Bag online, or make a donation."

  @until-the-ball
  Scenario: nothing of the stage reaches an ordinary view
    When I request "/"
    Then the ball page status should be 200
    And the ball page should not contain "fillBand"
    And the ball page should not contain "red-bag-stage"

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
