@ball @db
Feature: The Festive Ball password gate (TASK-313)
  The magazine advert lands on 4 September. Until staff open the gate, /ball must not be
  visible to anyone who has not been given the password — and it must not be reachable by
  going round the route either.

  Scenario: a stranger sees a password screen, not the ball page
    Given the ball gate is closed
    When I request the ball page
    Then the ball page status should be 401
    And the ball page should ask for a password
    And the ball page should not reveal the event

  Scenario: the wrong password is refused
    Given the ball gate is closed
    When I unlock the ball page with "not-the-password"
    Then the ball page status should be 401
    And the ball page should ask for a password

  Scenario: the right password lets you in, and the page stays out of search
    Given the ball gate is closed
    When I unlock the ball page with the real password
    Then the ball page status should be 200
    And the ball page should show the event
    And the ball page should be hidden from search engines

  Scenario: opening the gate makes it public with no password at all
    Given the ball gate is open
    When I request the ball page
    Then the ball page status should be 200
    And the ball page should show the event
    And the ball page should be visible to search engines

  Scenario: a scheduled unlock opens the gate on its own
    Given the ball gate is closed but scheduled to open in the past
    When I request the ball page
    Then the ball page status should be 200
    And the ball page should show the event

  Scenario: a schedule in the future keeps it shut
    Given the ball gate is closed but scheduled to open in the future
    When I request the ball page
    Then the ball page status should be 401

  Scenario: the gate cannot be stepped around by asking for the file
    Given the ball gate is closed
    When I request "/ball.html"
    Then the ball page should not reveal the event

  Scenario: the ticket terms are gated too
    Given the ball gate is closed
    When I request "/ball/terms"
    Then the ball page status should be 401

  Scenario: a confirmed arrival time is published on the page
    Given the ball gate is open
    And the ball arrival time is set to "7pm for 7.30pm"
    When I request the ball page
    Then the ball page should contain "7pm for 7.30pm"
    And the ball page should not contain "Start time to be confirmed"

  Scenario: the home page says nothing about the ball while the gate is shut
    Given the ball gate is closed
    When I request "/"
    Then the ball page status should be 200
    And the ball page should not contain "Festive Ball"
    And the ball page should not contain "ball-banner"

  Scenario: opening the gate puts the ball on the home page too
    Given the ball gate is open
    When I request "/"
    Then the ball page status should be 200
    And the ball page should contain "ball-banner"
    And the ball page should contain "Tickets now on sale"
    And the ball page should contain "Festive Ball"

  Scenario: the home page keeps its own donate call to action
    Given the ball gate is open
    When I request "/"
    Then the ball page should contain "Donate now"

  Scenario: staff change the preview password from the admin area
    Given a ball admin "ball14.admin.bdd@example.com" with role "admin" and password "pw-ball14"
    And the ball gate is closed
    When I PATCH the ball admin as "ball14.admin.bdd@example.com" with password "pw-ball14":
      """
      {"previewPassword": "sleigh-bells-2026"}
      """
    Then the ball admin status should be 200
    When I unlock the ball page with "sleigh-bells-2026"
    Then the ball page status should be 200
    And the ball page should show the event

  Scenario: the old password stops working once it is changed
    Given a ball admin "ball15.admin.bdd@example.com" with role "admin" and password "pw-ball15"
    And the ball gate is closed
    When I PATCH the ball admin as "ball15.admin.bdd@example.com" with password "pw-ball15":
      """
      {"previewPassword": "first-password-2026"}
      """
    And I PATCH the ball admin as "ball15.admin.bdd@example.com" with password "pw-ball15":
      """
      {"previewPassword": "second-password-2026"}
      """
    When I unlock the ball page with "first-password-2026"
    Then the ball page status should be 401

  Scenario: the password is never handed back to the browser
    Given a ball admin "ball16.admin.bdd@example.com" with role "admin" and password "pw-ball16"
    When I PATCH the ball admin as "ball16.admin.bdd@example.com" with password "pw-ball16":
      """
      {"previewPassword": "never-echo-this-2026"}
      """
    Then the ball admin status should be 200
    And the ball admin response should not contain "never-echo-this-2026"
    When I GET the ball admin as "ball16.admin.bdd@example.com" with password "pw-ball16"
    Then the ball admin response should not contain "never-echo-this-2026"
    And the ball admin response should not contain a password hash
