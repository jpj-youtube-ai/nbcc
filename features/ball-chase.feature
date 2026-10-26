@ball @db @ball-chase
Feature: Festive Ball chase reminders (TASK-575)
  In the last week before the guest details close, every other day, the people who booked and are
  still missing guest names or meal choices get one reminder, and the volunteers get a list of
  everyone to phone. It rides the 8am daily task, so each scenario runs the pass with a chosen
  time. The guest details close at 10am on Wednesday 4 November 2026 in these scenarios. All names
  and addresses are invented.

  Background:
    Given the ball is reset to 10 tables of 10 with 0 held back
    And the ball menu is set

  Scenario: seven days out, the booker who is missing something is reminded, once
    Given the guest details close at "2026-11-04T10:00:00Z"
    And a paid ball booking for 1 ticket with guest token "chase-open-1"
    And the booker of "chase-open-1" is "open.chase.bdd@example.com"
    And a paid ball booking for 1 ticket with guest token "chase-done-1"
    And the booker of "chase-done-1" is "done.chase.bdd@example.com"
    And I save a guest "Pat Brown" choosing "Turkey" and "Mousse" on "chase-done-1"
    And the chase emails logged so far are cleared
    When the daily chase pass runs at "2026-10-28T08:00:00Z"
    Then the email log should hold 1 "ballRunUp" email to "open.chase.bdd@example.com"
    And the email log should hold 0 "ballRunUp" emails to "done.chase.bdd@example.com"
    When the daily chase pass runs at "2026-10-28T08:00:00Z"
    Then the email log should hold 1 "ballRunUp" email to "open.chase.bdd@example.com"

  Scenario: a day that is not a round one sends nothing
    Given the guest details close at "2026-11-04T10:00:00Z"
    And the volunteers' chase list goes to "first.volunteer.chase.bdd@nbcc.scot" and "second.volunteer.chase.bdd@nbcc.scot"
    And a paid ball booking for 1 ticket with guest token "chase-open-1"
    And the booker of "chase-open-1" is "open.chase.bdd@example.com"
    And the chase emails logged so far are cleared
    When the daily chase pass runs at "2026-10-29T08:00:00Z"
    Then the chase pass should say it is not a chase day
    And no chase email should have been logged

  Scenario: the volunteers get the list on a round day, and again on the deadline morning with no reminder
    Given the guest details close at "2026-11-04T10:00:00Z"
    And the volunteers' chase list goes to "first.volunteer.chase.bdd@nbcc.scot" and "second.volunteer.chase.bdd@nbcc.scot"
    And a paid ball booking for 1 ticket with guest token "chase-open-1"
    And the booker of "chase-open-1" is "open.chase.bdd@example.com"
    And the chase emails logged so far are cleared
    When the daily chase pass runs at "2026-10-28T08:00:00Z"
    Then the email log should hold 1 "ballChaseList" email to "first.volunteer.chase.bdd@nbcc.scot"
    And the email log should hold 1 "ballChaseList" email to "second.volunteer.chase.bdd@nbcc.scot"
    And the email log should hold 1 "ballRunUp" email to "open.chase.bdd@example.com"
    When the daily chase pass runs at "2026-11-04T08:00:00Z"
    Then the email log should hold 2 "ballChaseList" emails to "first.volunteer.chase.bdd@nbcc.scot"
    And the email log should hold 2 "ballChaseList" emails to "second.volunteer.chase.bdd@nbcc.scot"
    And the email log should hold 1 "ballRunUp" email to "open.chase.bdd@example.com"

  Scenario: with no deadline set, nothing is sent
    Given the guest details deadline is not set
    And the volunteers' chase list goes to "first.volunteer.chase.bdd@nbcc.scot" and "second.volunteer.chase.bdd@nbcc.scot"
    And a paid ball booking for 1 ticket with guest token "chase-open-1"
    And the booker of "chase-open-1" is "open.chase.bdd@example.com"
    And the chase emails logged so far are cleared
    When the daily chase pass runs at "2026-10-28T08:00:00Z"
    Then the chase pass should say it is not a chase day
    And no chase email should have been logged

  # The week-to-go email goes a week before the Ball (Saturday 31 October). When that is also a round
  # day, a booker sent it that morning must not get a chase reminder too: one Ball email a morning.
  Scenario: a booker sent the week-to-go email this morning is not chased the same morning
    Given the guest details close at "2026-11-05T10:00:00Z"
    And a paid ball booking for 1 ticket with guest token "chase-open-1"
    And the booker of "chase-open-1" is "open.chase.bdd@example.com"
    And the chase emails logged so far are cleared
    When the old run-up pass runs at "2026-10-31T08:00:00Z"
    And the week-to-go stamps are moved to "2026-10-31T08:00:00Z"
    And the daily chase pass runs at "2026-10-31T08:00:00Z"
    Then the email log should hold 1 "ballRunUp" email to "open.chase.bdd@example.com"

  # The admin card in Festive Ball > Emails: who the volunteers' list goes to, and a test of each email.
  @admin
  Scenario: an editor saves the volunteers' list, tidied and in order, and it is recorded
    Given an admin user "editor.chase.admin.bdd@example.com" with role "editor" and password "chase-pw-123"
    When "editor.chase.admin.bdd@example.com" saves the chase list for "Zed Example <Zed.Chase.BDD@nbcc.scot>, Amy Example <amy.chase.bdd@nbcc.scot>"
    Then the chase card status should be 200
    And the chase list goes to "amy.chase.bdd@nbcc.scot, zed.chase.bdd@nbcc.scot" in that order
    And the volunteers' list is stored as "amy.chase.bdd@nbcc.scot, zed.chase.bdd@nbcc.scot"
    And the audit log records the chase list saved by "editor.chase.admin.bdd@example.com", adding 2 people
    When "editor.chase.admin.bdd@example.com" reads the chase card
    Then the chase card status should be 200
    And the chase list goes to "amy.chase.bdd@nbcc.scot, zed.chase.bdd@nbcc.scot" in that order

  @admin
  Scenario: an address that is not nbcc.scot is refused, and nothing is saved
    Given an admin user "editor.chase.admin.bdd@example.com" with role "editor" and password "chase-pw-123"
    When "editor.chase.admin.bdd@example.com" saves the chase list for "Sam Example <sam.chase.bdd@example.com>"
    Then the chase card status should be 400
    And the chase card refusal says "Only nbcc.scot addresses: this list carries people's phone numbers."
    And the volunteers' list is stored as ""

  @admin
  Scenario: a viewer can read the card but not change it, and needs a session to read it
    Given an admin user "viewer.chase.admin.bdd@example.com" with role "viewer" and password "chase-pw-123"
    When the chase card is read without a session
    Then the chase card status should be 401
    When "viewer.chase.admin.bdd@example.com" reads the chase card
    Then the chase card status should be 200
    When "viewer.chase.admin.bdd@example.com" saves the chase list for "Amy Example <amy.chase.bdd@nbcc.scot>"
    Then the chase card status should be 403
    And the volunteers' list is stored as ""
    When "viewer.chase.admin.bdd@example.com" sends a test "list" from the chase card
    Then the chase card status should be 403

  @admin
  Scenario: with no deadline the card says there is no next round
    Given the guest details deadline is not set
    And an admin user "editor.chase.admin.bdd@example.com" with role "editor" and password "chase-pw-123"
    When "editor.chase.admin.bdd@example.com" reads the chase card
    Then the chase card status should be 200
    And the chase card has no deadline and no next round

  @admin
  Scenario: a test goes only to the person who asked, with made up bookings, and is never recorded as a send
    Given the guest details close at "2026-11-04T10:00:00Z"
    And the volunteers' chase list goes to "first.volunteer.chase.bdd@nbcc.scot" and "second.volunteer.chase.bdd@nbcc.scot"
    And a paid ball booking for 1 ticket with guest token "chase-open-1"
    And the booker of "chase-open-1" is "open.chase.bdd@example.com"
    And an admin user "editor.chase.admin.bdd@example.com" with role "editor" and password "chase-pw-123"
    And the chase emails logged so far are cleared
    When "editor.chase.admin.bdd@example.com" sends a test "reminder" from the chase card
    Then the chase card status should be 200
    And the chase test went only to "editor.chase.admin.bdd@example.com"
    And the email log should hold 1 "ballRunUp" email to "editor.chase.admin.bdd@example.com"
    When "editor.chase.admin.bdd@example.com" sends a test "list" from the chase card
    Then the chase card status should be 200
    And the email log should hold 1 "ballChaseList" email to "editor.chase.admin.bdd@example.com"
    And the email log should hold 0 "ballChaseList" emails to "first.volunteer.chase.bdd@nbcc.scot"
    And the email log should hold 0 "ballRunUp" emails to "open.chase.bdd@example.com"
    And no chase send should have been recorded

  @admin
  Scenario: a test that is neither a reminder nor a list is refused
    Given an admin user "editor.chase.admin.bdd@example.com" with role "editor" and password "chase-pw-123"
    When "editor.chase.admin.bdd@example.com" sends a test "newsletter" from the chase card
    Then the chase card status should be 400

  Scenario: the old guest chase and last call are retired
    Given the guest details close at "2026-10-25T10:00:00Z"
    And a paid ball booking for 1 ticket with guest token "chase-open-1"
    And the booker of "chase-open-1" is "open.chase.bdd@example.com"
    And the chase emails logged so far are cleared
    When the old run-up pass runs at "2026-10-15T08:00:00Z"
    And the old run-up pass runs at "2026-10-25T08:00:00Z"
    Then no chase email should have been logged
