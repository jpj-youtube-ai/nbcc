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

  # TASK-336: guest names and dietary needs come back from BUYERS, so staff needed a list of who
  # has not replied. With no paid bookings the honest answer is an empty list and zero seats -
  # not a divide-by-zero, and not a percentage that claims a catering list is ready.
  Scenario: the guest chase list is empty, not broken, before anyone has booked
    Given a ball admin "ball9.admin.bdd@example.com" with role "admin" and password "pw-ball9"
    When I GET the ball guest progress as "ball9.admin.bdd@example.com" with password "pw-ball9"
    Then the ball admin status should be 200
    And the guest progress should report 0 seats booked
    And the guest progress should list 0 bookings to chase

  # TASK-338: the chase runs the same pass the daily task runs, so pressing it twice is safe.
  # With no lock date agreed it must send NOTHING rather than chase people towards a deadline
  # nobody has set.
  Scenario: the chase sends nothing while no lock date has been agreed
    Given a ball admin "ball10.admin.bdd@example.com" with role "admin" and password "pw-ball10"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I press the ball chase button as "ball10.admin.bdd@example.com" with password "pw-ball10"
    Then the ball admin status should be 200
    And nothing should have been sent

  Scenario: the chase button is not open to the public
    When I press the ball chase button without a token
    Then the ball admin status should be 401

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

  Scenario: cancelling a booking puts its seats straight back on sale
    # The seats come back on their own: availability counts only pending and paid, so the
    # status change is the whole mechanism. There is no separate "give the seats back" step.
    Given a ball admin "ball19.admin.bdd@example.com" with role "admin" and password "pw-ball19"
    And the ball is reset to 40 tables of 10 with 0 held back
    And a paid ball booking "BALL-CANCEL1" for 4 seats
    When I request the ball availability
    Then the ball availability should show 396 seats remaining
    When I cancel ball booking "BALL-CANCEL1" as "ball19.admin.bdd@example.com" with password "pw-ball19"
    Then the ball admin status should be 200
    And the cancellation should report 4 seats returned
    When I request the ball availability
    Then the ball availability should show 400 seats remaining

  Scenario: a booking cannot be cancelled twice
    Given a ball admin "ball20.admin.bdd@example.com" with role "admin" and password "pw-ball20"
    And the ball is reset to 40 tables of 10 with 0 held back
    And a paid ball booking "BALL-CANCEL2" for 2 seats
    When I cancel ball booking "BALL-CANCEL2" as "ball20.admin.bdd@example.com" with password "pw-ball20"
    Then the ball admin status should be 200
    When I cancel ball booking "BALL-CANCEL2" as "ball20.admin.bdd@example.com" with password "pw-ball20"
    Then the ball admin status should be 409

  Scenario: cancelling an unknown reference is refused, not silently ignored
    Given a ball admin "ball21.admin.bdd@example.com" with role "admin" and password "pw-ball21"
    When I cancel ball booking "BALL-NOSUCH" as "ball21.admin.bdd@example.com" with password "pw-ball21"
    Then the ball admin status should be 404

  Scenario: a viewer cannot release someone's seats
    # Same bar as changing capacity: near a sell-out this decides who gets the last table.
    Given a ball admin "ball22.admin.bdd@example.com" with role "viewer" and password "pw-ball22"
    And the ball is reset to 40 tables of 10 with 0 held back
    And a paid ball booking "BALL-CANCEL3" for 2 seats
    When I cancel ball booking "BALL-CANCEL3" as "ball22.admin.bdd@example.com" with password "pw-ball22"
    Then the ball admin status should be 403
    When I request the ball availability
    Then the ball availability should show 398 seats remaining

  Scenario: holding tables for a company takes them off sale, by name
    # The whole point of TASK-324: the seats are reserved AND the reason is written down, so in
    # November somebody can tell what the held-back number is actually covering.
    Given a ball admin "ball23.admin.bdd@example.com" with role "admin" and password "pw-ball23"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I hold 2 "table" for "Ayrshire Bakery (invoice 1042)" as "ball23.admin.bdd@example.com" with password "pw-ball23"
    Then the ball admin status should be 201
    And the hold list should name "Ayrshire Bakery (invoice 1042)"
    When I request the ball availability
    Then the ball availability should show 380 seats remaining
    And the ball availability should show 38 tables remaining

  Scenario: releasing a hold puts the seats straight back on sale
    Given a ball admin "ball24.admin.bdd@example.com" with role "admin" and password "pw-ball24"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I hold 3 "seat" for "Sponsor guests" as "ball24.admin.bdd@example.com" with password "pw-ball24"
    Then the ball admin status should be 201
    When I request the ball availability
    Then the ball availability should show 397 seats remaining
    When I release that hold as "ball24.admin.bdd@example.com" with password "pw-ball24"
    Then the ball admin status should be 200
    When I request the ball availability
    Then the ball availability should show 400 seats remaining

  Scenario: a hold cannot be released twice
    Given a ball admin "ball25.admin.bdd@example.com" with role "admin" and password "pw-ball25"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I hold 1 "seat" for "Top table" as "ball25.admin.bdd@example.com" with password "pw-ball25"
    And I release that hold as "ball25.admin.bdd@example.com" with password "pw-ball25"
    Then the ball admin status should be 200
    When I release that hold as "ball25.admin.bdd@example.com" with password "pw-ball25"
    Then the ball admin status should be 409

  Scenario: a hold bigger than the room left is refused
    # Judged on SEATS whichever kind is asked for, and inside the same lock the checkout uses,
    # so a hold and a purchase can never both be granted the last table.
    Given a ball admin "ball26.admin.bdd@example.com" with role "admin" and password "pw-ball26"
    And the ball is reset to 2 tables of 10 with 0 held back
    When I hold 3 "table" for "Too big" as "ball26.admin.bdd@example.com" with password "pw-ball26"
    Then the ball admin status should be 409
    When I request the ball availability
    Then the ball availability should show 20 seats remaining

  Scenario: a viewer cannot take seats off sale
    Given a ball admin "ball27.admin.bdd@example.com" with role "viewer" and password "pw-ball27"
    And the ball is reset to 40 tables of 10 with 0 held back
    When I hold 1 "table" for "Sneaky" as "ball27.admin.bdd@example.com" with password "pw-ball27"
    Then the ball admin status should be 403
    When I request the ball availability
    Then the ball availability should show 400 seats remaining

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
