@admin @admin-overview
Feature: The admin Overview says what needs us (TASK-508)
  "Needs you" lists what is waiting on a person, most urgent first, each with the screen that deals
  with it. Each person sees only what their access lets them open.

  Background:
    Given an admin user "ann.overview.admin.bdd@example.com" with role "admin" and password "overview-pw-123"
    And an admin user "cal.overview.admin.bdd@example.com" with role "editor" and password "overview-pw-123"
    And "cal.overview.admin.bdd@example.com" can see only the contact form

  Scenario: the overview needs a session
    When I read the overview without a session
    Then the overview answer is 401

  Scenario: a new fundraising sign up waits for approval, for whoever can see Fundraising
    Given a new fundraising sign up "Overview bake sale" waiting for approval
    When "ann.overview.admin.bdd@example.com" reads the overview
    Then the overview answer is 200
    And it says fundraising sign ups are waiting, with a button to "Fundraising"
    When "cal.overview.admin.bdd@example.com" reads the overview
    Then the overview answer is 200
    And it says nothing about Fundraising

  # TASK-509: how we are doing. Every number read runs against the real tables here; none may fail.
  Scenario: cash paid in for a fundraiser today counts in this month's money
    Given a new fundraising sign up "Overview coffee morning" waiting for approval
    And £123.45 in cash was paid in for it today
    When "ann.overview.admin.bdd@example.com" reads the overview
    Then the overview answer is 200
    And every number could be checked
    And this month's money from fundraising pages is at least £123
    And it says how the Festive Ball and the monthly givers are doing

  Scenario: someone who can see only the contact form sees none of the numbers
    When "cal.overview.admin.bdd@example.com" reads the overview
    Then the overview answer is 200
    And it shows no numbers
