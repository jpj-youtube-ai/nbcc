@admin @ball-report @db
Feature: The Festive Ball ticket report, set up from the Events page (TASK-464)
  Twice a week the people running the Ball get one email with its ticket numbers: counts only, no
  one's details and no money. Staff who can edit Events choose who gets it and switch it on; it
  ships switched off, and a test goes only to the person who asked for it.

  Background:
    Given an admin user "editor.report.admin.bdd@example.com" with role "editor" and password "report-pw-123"
    And an admin user "viewer.report.admin.bdd@example.com" with role "viewer" and password "report-pw-123"

  Scenario: the report's settings need a session
    When I read the ticket report settings without a session
    Then the report status should be 401

  Scenario: a viewer can see the settings but not change them
    When "viewer.report.admin.bdd@example.com" reads the ticket report settings
    Then the report status should be 200
    And the report is switched off
    When "viewer.report.admin.bdd@example.com" saves the ticket report for "Alex <alex.report.bdd@example.com>"
    Then the report status should be 403

  Scenario: an editor saves who it goes to, tidied and in alphabetical order, and it is recorded
    When "editor.report.admin.bdd@example.com" saves the ticket report for "Cal <Cal.Report.BDD@example.com>, Alex <alex.report.bdd@example.com>" switched on
    Then the report status should be 200
    And the report goes to "alex.report.bdd@example.com, cal.report.bdd@example.com" in that order
    And the report is switched on
    And the audit log records the report saved by "editor.report.admin.bdd@example.com", adding 2 people

  Scenario: a bad address or a repeat is refused, and so is switching on with nobody to send to
    When "editor.report.admin.bdd@example.com" saves the ticket report for "Alex <not an address>"
    Then the report status should be 400
    And the refusal points at the "email" of person 1
    When "editor.report.admin.bdd@example.com" saves the ticket report for "Alex <a.report.bdd@example.com>, Al <A.Report.BDD@example.com>"
    Then the report status should be 400
    And the refusal points at the "email" of person 2
    When "editor.report.admin.bdd@example.com" saves the ticket report for "" switched on
    Then the report status should be 400

  Scenario: a test goes only to the person who asked for it, and is recorded as a test
    When "editor.report.admin.bdd@example.com" saves the ticket report for "Alex <alex.report.bdd@example.com>"
    And "editor.report.admin.bdd@example.com" sends a test ticket report
    Then the report status should be 200
    And the test went only to "editor.report.admin.bdd@example.com"
    And the email log shows a ticket report to "editor.report.admin.bdd@example.com" and not to "alex.report.bdd@example.com"
    And the report records a test sent by "editor.report.admin.bdd@example.com"
    And the audit log records a test sent by "editor.report.admin.bdd@example.com"

  Scenario: the settings carry a preview of the email, with no one's details and no money in it
    When "editor.report.admin.bdd@example.com" reads the ticket report settings
    Then the preview is the Festive Ball ticket report, with no money and no one's details in it

  # The numbers are what the organiser and the sponsor read, so they are checked against real
  # bookings: sold means paid, and "since the last update" counts on from where that one counted to.
  Scenario: the numbers count paid bookings only, and what sold since the last update
    Given the ball is reset to 40 tables of 10 with 0 held back
    And these Festive Ball bookings exist:
      | kind  | quantity | seats | status    | paid days ago |
      | table | 2        | 20    | paid      | 20            |
      | seat  | 3        | 3     | paid      | 10            |
      | table | 1        | 10    | paid      | 3             |
      | seat  | 2        | 2     | paid      | 1             |
      | table | 1        | 10    | pending   |               |
      | seat  | 4        | 4     | refunded  | 2             |
      | seat  | 1        | 1     | cancelled | 2             |
    And the last ticket report counted up to 2 days ago
    And 2 people want 6 seats on the Ball's waiting list, and 1 more has been offered a place
    When "editor.report.admin.bdd@example.com" reads the ticket report settings
    Then the report status should be 200
    And the preview says "35 of 400 seats (8%)"
    And the preview says "3 whole tables and 5 single seats"
    And the preview says "2 seats since the last update"
    And the preview says "12 seats in the last 7 days (the 7 days before: 3)"
    And the preview says "2 people on the waiting list, wanting 6 seats"

  # The numbers are the Ball's: access that leaves the Ball out cannot reach them through Events.
  Scenario: access that leaves out the Festive Ball cannot see or send the Ball's numbers
    Given a staff user "noball.report.admin.bdd@example.com" with password "report-pw-123" and only "events:edit" permission
    When "noball.report.admin.bdd@example.com" reads the ticket report settings
    Then the report status should be 403
    When "noball.report.admin.bdd@example.com" sends a test ticket report
    Then the report status should be 403
