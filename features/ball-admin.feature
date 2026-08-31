@ball @db
Feature: Festive Ball admin controls (TASK-313)
  Staff need to launch and run the ball without a developer: flip the gate, set capacity,
  hold seats back, close sales, and publish details the venue confirms late.

  Scenario: an admin sees the settings, live availability and the money so far
    Given a ball admin "ball1.admin.bdd@example.com" with role "admin" and password "pw-ball1"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I GET the ball admin as "ball1.admin.bdd@example.com" with password "pw-ball1"
    Then the ball admin status should be 200
    And the ball admin should report 400 seats remaining

  Scenario: an admin flips the gate and the public page opens
    Given a ball admin "ball2.admin.bdd@example.com" with role "admin" and password "pw-ball2"
    And the ball gate is closed
    When I PATCH the ball admin as "ball2.admin.bdd@example.com" with password "pw-ball2":
      """
      {"gateOpen": true}
      """
    Then the ball admin status should be 200
    When I request the ball page
    Then the ball page status should be 200
    And the ball page should show the event

  Scenario: holding seats back reduces what the public can buy
    Given a ball admin "ball3.admin.bdd@example.com" with role "admin" and password "pw-ball3"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I PATCH the ball admin as "ball3.admin.bdd@example.com" with password "pw-ball3":
      """
      {"heldSeats": 40}
      """
    Then the ball admin status should be 200
    When I request the ball availability
    Then the ball availability should show 360 seats remaining
    And the ball availability should show 36 tables remaining

  Scenario: a change to the card fee rate reaches the public page
    Given a ball admin "ball17.admin.bdd@example.com" with role "admin" and password "pw-ball17"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I PATCH the ball admin as "ball17.admin.bdd@example.com" with password "pw-ball17":
      """
      {"cardFeePercentBp": 150, "cardFeeFixedPence": 25}
      """
    Then the ball admin status should be 200
    When I request the ball availability
    Then the ball availability should show a card fee of 150 basis points plus 25p

  Scenario: an impossible card fee is refused rather than passed on to buyers
    Given a ball admin "ball18.admin.bdd@example.com" with role "admin" and password "pw-ball18"
    When I PATCH the ball admin as "ball18.admin.bdd@example.com" with password "pw-ball18":
      """
      {"cardFeePercentBp": 5000}
      """
    Then the ball admin status should be 400

  Scenario: publishing a confirmed arrival time reaches the page
    Given a ball admin "ball4.admin.bdd@example.com" with role "admin" and password "pw-ball4"
    And the ball gate is open
    When I PATCH the ball admin as "ball4.admin.bdd@example.com" with password "pw-ball4":
      """
      {"arrivalTime": "7pm for 7.30pm"}
      """
    Then the ball admin status should be 200
    When I request the ball page
    Then the ball page should contain "7pm for 7.30pm"

  Scenario: an editor can look but not touch, because the gate publishes a page
    Given a ball admin "ball5.admin.bdd@example.com" with role "editor" and password "pw-ball5"
    When I GET the ball admin as "ball5.admin.bdd@example.com" with password "pw-ball5"
    Then the ball admin status should be 200
    When I PATCH the ball admin as "ball5.admin.bdd@example.com" with password "pw-ball5":
      """
      {"gateOpen": true}
      """
    Then the ball admin status should be 403

  Scenario: there is no way to change the ticket price
    Given a ball admin "ball6.admin.bdd@example.com" with role "admin" and password "pw-ball6"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I PATCH the ball admin as "ball6.admin.bdd@example.com" with password "pw-ball6":
      """
      {"seatPricePence": 1}
      """
    Then the ball admin status should be 400
    When I start a ball checkout for 1 seat
    Then the ball checkout total should be 10000 pence

  Scenario: nonsense capacity is refused
    Given a ball admin "ball7.admin.bdd@example.com" with role "admin" and password "pw-ball7"
    When I PATCH the ball admin as "ball7.admin.bdd@example.com" with password "pw-ball7":
      """
      {"totalTables": -5}
      """
    Then the ball admin status should be 400

  Scenario: no token, no access
    When I GET the ball admin without a token
    Then the ball admin status should be 401
