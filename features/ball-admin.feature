@ball @db
Feature: Festive Ball admin controls (TASK-313)
  Staff need to launch and run the ball without a developer: flip the gate, set capacity,
  hold seats back, close sales, and publish details the venue confirms late.

  Scenario: an admin sees the settings, live availability and the money so far
    Given a ball admin "ball.admin@example.com" with role "admin" and password "pw-ball-admin"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I GET the ball admin as "ball.admin@example.com" with password "pw-ball-admin"
    Then the ball admin status should be 200
    And the ball admin should report 400 seats remaining

  Scenario: an admin flips the gate and the public page opens
    Given a ball admin "ball.admin2@example.com" with role "admin" and password "pw-ball-admin2"
    And the ball gate is closed
    When I PATCH the ball admin with {"gateOpen":true} as "ball.admin2@example.com" with password "pw-ball-admin2"
    Then the ball admin status should be 200
    When I request the ball page
    Then the ball page status should be 200
    And the ball page should show the event

  Scenario: holding seats back reduces what the public can buy
    Given a ball admin "ball.admin3@example.com" with role "admin" and password "pw-ball-admin3"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I PATCH the ball admin with {"heldSeats":40} as "ball.admin3@example.com" with password "pw-ball-admin3"
    Then the ball admin status should be 200
    When I request the ball availability
    Then the ball availability should show 360 seats remaining
    And the ball availability should show 36 tables remaining

  Scenario: publishing a confirmed arrival time reaches the page
    Given a ball admin "ball.admin4@example.com" with role "admin" and password "pw-ball-admin4"
    And the ball gate is open
    When I PATCH the ball admin with {"arrivalTime":"7pm for 7.30pm"} as "ball.admin4@example.com" with password "pw-ball-admin4"
    Then the ball admin status should be 200
    When I request the ball page
    Then the ball page should contain "7pm for 7.30pm"

  Scenario: an editor can look but not touch, because the gate publishes a page
    Given a ball admin "ball.editor@example.com" with role "editor" and password "pw-ball-editor"
    When I GET the ball admin as "ball.editor@example.com" with password "pw-ball-editor"
    Then the ball admin status should be 200
    When I PATCH the ball admin with {"gateOpen":true} as "ball.editor@example.com" with password "pw-ball-editor"
    Then the ball admin status should be 403

  Scenario: there is no way to change the ticket price
    Given a ball admin "ball.admin5@example.com" with role "admin" and password "pw-ball-admin5"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I PATCH the ball admin with {"seatPricePence":1} as "ball.admin5@example.com" with password "pw-ball-admin5"
    Then the ball admin status should be 400
    When I start a ball checkout for 1 seat
    Then the ball checkout total should be 10000 pence

  Scenario: nonsense capacity is refused
    Given a ball admin "ball.admin6@example.com" with role "admin" and password "pw-ball-admin6"
    When I PATCH the ball admin with {"totalTables":-5} as "ball.admin6@example.com" with password "pw-ball-admin6"
    Then the ball admin status should be 400

  Scenario: no token, no access
    When I GET the ball admin without a token
    Then the ball admin status should be 401
