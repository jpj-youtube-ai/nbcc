@ball @db
Feature: Festive Ball waiting list (TASK-313)
  There will be drop-outs before November. A place released in October is only worth something
  if somebody is waiting for it.

  Scenario: someone joins the list
    Given the ball waiting list is empty
    When I join the ball waiting list as "Jo Smith" with email "jo.waiting@example.com"
    Then the waiting list response status should be 201
    And the waiting list should say I am on it

  Scenario: joining twice updates rather than duplicating
    Given the ball waiting list is empty
    When I join the ball waiting list as "Jo Smith" with email "jo.waiting@example.com"
    And I join the ball waiting list as "Jo Smith" with email "JO.WAITING@example.com"
    Then the waiting list response status should be 200
    And the waiting list should say I am already on it
    And the ball waiting list should hold 1 person

  Scenario: a bad email is refused with a plain message
    Given the ball waiting list is empty
    When I join the ball waiting list as "Jo Smith" with email "not-an-email"
    Then the waiting list response status should be 400

  Scenario: staff can see who is waiting, oldest first
    Given a ball admin "ball13.admin.bdd@example.com" with role "admin" and password "pw-ball13"
    And the ball waiting list is empty
    When I join the ball waiting list as "First Person" with email "first.waiting@example.com"
    And I join the ball waiting list as "Second Person" with email "second.waiting@example.com"
    And I read the ball waiting list as "ball13.admin.bdd@example.com" with password "pw-ball13"
    Then the ball waiting list should hold 2 people
    And the first person waiting should be "First Person"

  Scenario: the waiting list is not public
    When I read the ball waiting list without a token
    Then the waiting list response status should be 401
