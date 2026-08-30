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
    And the guest page should show "Jo Smith"
    And the guest page should show "2 of 10 added so far."

  Scenario: dietary and access notes are kept against the right guest
    Given a paid ball booking for 1 table with guest token "guest-tok-3"
    When I save a guest "Ayesha Khan" with dietary "Coeliac" on "guest-tok-3"
    Then the guest page should show "Ayesha Khan"
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
