@ball @db
Feature: Festive Ball guest details (TASK-313)
  After paying, the booker gets an emailed link to name their guests and tell us about food and
  access needs, so the venue can look after everyone. No login: the token is the authorisation.

  Scenario: the link opens a form with one row per seat booked
    Given a paid ball booking for 1 table with guest token "guest-tok-1"
    When I open the guest link "guest-tok-1"
    Then the guest page status should be 200
    And the guest page should have 10 guest name fields
    And the guest page should work without JavaScript

  Scenario: an unknown link says so without revealing whether the booking exists
    When I open the guest link "no-such-token"
    Then the guest page status should be 404
    And the guest page should not reveal any booking

  Scenario: a pending booking is not addressable
    Given a pending ball booking with guest token "guest-tok-pending"
    When I open the guest link "guest-tok-pending"
    Then the guest page status should be 404

  Scenario: saving some guests works, and the rest can follow later
    Given a paid ball booking for 1 table with guest token "guest-tok-2"
    When I save guests "Jo Smith,Pat Brown" on "guest-tok-2"
    Then the guest page status should be 200
    And the guest page should list the guest "Jo Smith"
    And the guest page should list the guest "Pat Brown"
    And the guest page should show "2 of 10 added so far."

  Scenario: dietary and access notes are kept against the right guest
    Given a paid ball booking for 1 table with guest token "guest-tok-3"
    When I save a guest "Ayesha Khan" with dietary "Coeliac" on "guest-tok-3"
    Then the guest page should list the guest "Ayesha Khan"
    And the guest page should show "Coeliac"

  Scenario: saving again replaces the table rather than doubling it
    Given a paid ball booking for 1 table with guest token "guest-tok-4"
    When I save guests "Jo Smith,Pat Brown" on "guest-tok-4"
    And I save guests "Jo Smith" on "guest-tok-4"
    Then the guest page should show "1 of 10 added so far."

  Scenario: the form stays usable while the ticket page is still private
    Given the ball gate is closed
    And a paid ball booking for 1 table with guest token "guest-tok-5"
    When I open the guest link "guest-tok-5"
    Then the guest page status should be 200

  Scenario: the catering list for the venue carries nothing beyond what they need
    Given a ball admin "ball8.admin.bdd@example.com" with role "admin" and password "pw-ball8"
    And a paid ball booking for 1 table with guest token "guest-tok-6"
    When I save a guest "Ayesha Khan" with dietary "Coeliac" on "guest-tok-6"
    And I download the ball "catering" list as "ball8.admin.bdd@example.com" with password "pw-ball8"
    Then the ball export status should be 200
    And the ball export should contain "Coeliac"
    And the ball export should not contain an email address
    And the ball export should not contain a booking reference

  Scenario: the door list names everyone and keeps contact details off it
    Given a ball admin "ball9.admin.bdd@example.com" with role "admin" and password "pw-ball9"
    And a paid ball booking for 1 table with guest token "guest-tok-7"
    When I save guests "Jo Smith,Pat Brown" on "guest-tok-7"
    And I download the ball "door-list" list as "ball9.admin.bdd@example.com" with password "pw-ball9"
    Then the ball export status should be 200
    And the ball export should contain "Jo Smith"
    And the ball export should contain "Pat Brown"
    And the ball export should not contain an email address

  Scenario: the menu shows a fixed course without asking anyone to choose it
    Given the ball menu is set
    And a paid ball booking for 1 table with guest token "guest-menu-1"
    When I open the guest link "guest-menu-1"
    Then the guest page status should be 200
    And the guest page should show "Soup"
    And the guest page should show "Served to everyone."
    And the guest page should not show a picker for "To start"
    And the guest page should show "V = Vegetarian"

  Scenario: a guest who is vegetarian is remembered as one
    Given the ball menu is set
    And a paid ball booking for 1 table with guest token "guest-menu-2"
    When I save a vegetarian guest "Sam Bryce" choosing "Vegetarian wellington" on "guest-menu-2"
    Then the guest page status should be 200
    And the guest page should list the guest "Sam Bryce"
    And the guest page should have the vegetarian tick set

  Scenario: nothing about the menu appears before the venue confirms one
    Given the ball menu is cleared
    And a paid ball booking for 1 table with guest token "guest-menu-3"
    When I open the guest link "guest-menu-3"
    Then the guest page status should be 200
    And the guest page should not show a picker for "Main course"

  Scenario: exports need a login
    When I download the ball "door-list" list without a token
    Then the ball export status should be 401

  Scenario: the reminder goes out once, and pressing send again reaches nobody
    Given a ball admin "ball10.admin.bdd@example.com" with role "admin" and password "pw-ball10"
    And the ball is reset to 40 tables of 10 with 0 held back
    And a paid ball booking for 1 table with guest token "guest-tok-8"
    When I send the ball reminders as "ball10.admin.bdd@example.com" with password "pw-ball10"
    Then the ball reminder status should be 200
    And the ball reminder should report 1 sent
    When I send the ball reminders as "ball10.admin.bdd@example.com" with password "pw-ball10"
    Then the ball reminder should report 0 sent

  Scenario: an unpaid booking is never reminded
    Given a ball admin "ball11.admin.bdd@example.com" with role "admin" and password "pw-ball11"
    And the ball is reset to 40 tables of 10 with 0 held back
    And a pending ball booking with guest token "guest-tok-9"
    When I send the ball reminders as "ball11.admin.bdd@example.com" with password "pw-ball11"
    Then the ball reminder should report 0 sent

  Scenario: the menu email refuses to go out with no menu in it
    Given a ball admin "ball13.admin.bdd@example.com" with role "admin" and password "pw-ball13"
    And the ball is reset to 40 tables of 10 with 0 held back
    And the ball menu is cleared
    And a paid ball booking for 1 table with guest token "guest-menu-4"
    When I send the ball menu email as "ball13.admin.bdd@example.com" with password "pw-ball13"
    Then the ball menu email status should be 409

  Scenario: the menu email goes out once, and pressing send again reaches nobody
    Given a ball admin "ball14.admin.bdd@example.com" with role "admin" and password "pw-ball14"
    And the ball is reset to 40 tables of 10 with 0 held back
    And the ball menu is set
    And a paid ball booking for 1 table with guest token "guest-menu-5"
    When I send the ball menu email as "ball14.admin.bdd@example.com" with password "pw-ball14"
    Then the ball menu email status should be 200
    And the ball menu email should report 1 sent
    When I send the ball menu email as "ball14.admin.bdd@example.com" with password "pw-ball14"
    Then the ball menu email should report 0 sent

  # Jaimie, 20 October 2026: "skip the ones who have already chosen", but a table with seats nobody
  # has named yet still gets it. Left out only when every seat is named and every guest has chosen,
  # and not stamped as sent, so a booking left out comes back once someone in it has not chosen.
  Scenario: the menu email leaves out a booking whose seats are all named and chosen, until one is not
    Given a ball admin "ball28.admin.bdd@example.com" with role "admin" and password "pw-ball28"
    And the ball is reset to 40 tables of 10 with 0 held back
    And the ball menu is set
    And a paid ball booking for 1 ticket with guest token "guest-menu-7"
    When I save a guest "Sam Bryce" choosing "Turkey" and "Mousse" on "guest-menu-7"
    And I send the ball menu email as "ball28.admin.bdd@example.com" with password "pw-ball28"
    Then the ball menu email status should be 200
    And the ball menu email should report 0 sent
    And the ball menu email should report 1 already chosen
    When I save guests "Pat Brown" on "guest-menu-7"
    And I send the ball menu email as "ball28.admin.bdd@example.com" with password "pw-ball28"
    Then the ball menu email should report 1 sent
    And the ball menu email should report 0 already chosen

  Scenario: a table with seats still to name gets the menu email, even when everyone named has chosen
    Given a ball admin "ball29.admin.bdd@example.com" with role "admin" and password "pw-ball29"
    And the ball is reset to 40 tables of 10 with 0 held back
    And the ball menu is set
    And a paid ball booking for 1 table with guest token "guest-menu-8"
    When I save a guest "Sam Bryce" choosing "Turkey" and "Mousse" on "guest-menu-8"
    And I send the ball menu email as "ball29.admin.bdd@example.com" with password "pw-ball29"
    Then the ball menu email status should be 200
    And the ball menu email should report 1 sent
    And the ball menu email should report 0 already chosen

  Scenario: a booking with a guest still to choose still gets the menu email
    Given a ball admin "ball30.admin.bdd@example.com" with role "admin" and password "pw-ball30"
    And the ball is reset to 40 tables of 10 with 0 held back
    And the ball menu is set
    And a paid ball booking for 1 ticket with guest token "guest-menu-9"
    When I save a vegetarian guest "Sam Bryce" choosing "Vegetarian wellington" on "guest-menu-9"
    And I send the ball menu email as "ball30.admin.bdd@example.com" with password "pw-ball30"
    Then the ball menu email status should be 200
    And the ball menu email should report 1 sent
    And the ball menu email should report 0 already chosen

  Scenario: an editor cannot email four hundred people about the menu either
    Given a ball admin "ball15.admin.bdd@example.com" with role "editor" and password "pw-ball15"
    When I send the ball menu email as "ball15.admin.bdd@example.com" with password "pw-ball15"
    Then the ball menu email status should be 403

  Scenario: staff can see who has chosen and who has not
    Given a ball admin "ball16.admin.bdd@example.com" with role "admin" and password "pw-ball16"
    And the ball is reset to 40 tables of 10 with 0 held back
    And the ball menu is set
    And a paid ball booking for 1 table with guest token "guest-menu-6"
    When I save a vegetarian guest "Sam Bryce" choosing "Vegetarian wellington" on "guest-menu-6"
    And I read the ball menu progress as "ball16.admin.bdd@example.com" with password "pw-ball16"
    Then the ball menu progress should say it is asking
    And the ball menu progress should report 0 chosen

  Scenario: nothing is outstanding before the venue confirms a menu
    Given a ball admin "ball17.admin.bdd@example.com" with role "admin" and password "pw-ball17"
    And the ball menu is cleared
    When I read the ball menu progress as "ball17.admin.bdd@example.com" with password "pw-ball17"
    Then the ball menu progress should say it is not asking

  Scenario: an editor cannot email four hundred people
    Given a ball admin "ball12.admin.bdd@example.com" with role "editor" and password "pw-ball12"
    When I send the ball reminders as "ball12.admin.bdd@example.com" with password "pw-ball12"
    Then the ball reminder status should be 403
