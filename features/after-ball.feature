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

  Scenario: ?at=after-ball shows /fill at night, with everything that takes a gift still there
    When I request "/fill?at=after-ball"
    Then the ball page status should be 200
    And the ball page should contain "id=\"fnNight\""
    And the ball page should contain "/assets/css/fill-night.css"
    And the ball page should contain "/assets/js/fill-night.js"
    And the ball page should contain "data-rb-donate"
    And the ball page should contain "data-rb-bar"
    And the ball page should contain "id=\"rbDetailsForm\""

  Scenario: the thank you page is never dressed for the night
    When I request "/fill/thank-you?at=after-ball"
    Then the ball page status should be 200
    And the ball page should not contain "fnNight"
    And the ball page should not contain "fill-night"

  @until-the-ball
  Scenario: an ordinary view of /fill is the page as it was
    When I request "/fill"
    Then the ball page status should be 200
    And the ball page should not contain "fnNight"
    And the ball page should not contain "fill-night"

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
