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

  Scenario: the old guest chase and last call are retired
    Given the guest details close at "2026-10-25T10:00:00Z"
    And a paid ball booking for 1 ticket with guest token "chase-open-1"
    And the booker of "chase-open-1" is "open.chase.bdd@example.com"
    And the chase emails logged so far are cleared
    When the old run-up pass runs at "2026-10-15T08:00:00Z"
    And the old run-up pass runs at "2026-10-25T08:00:00Z"
    Then no chase email should have been logged
