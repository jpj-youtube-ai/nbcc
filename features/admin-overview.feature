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

  # Counted as the screens count them: a refund comes off, a page's gift is the page's and not a
  # donation, and the start of last month is last month. Measured as a change, so other money in the
  # test database cannot get in the way.
  Scenario: money in counts refunds, keeps page gifts apart, and compares with last month
    Given a new fundraising sign up "Overview sponsored walk" waiting for approval
    And "ann.overview.admin.bdd@example.com" has noted the overview's money
    And a £50 gift was made on its page today, with £20 of it refunded
    And a £40 donation was made at the very start of last month
    When "ann.overview.admin.bdd@example.com" reads the overview
    Then every number could be checked
    And this month's money from fundraising pages has gone up by £30
    And this month's donations have not changed
    And last month's money has gone up by £40

  # TASK-510: Coming up, the next 14 days. Every dated read runs against the real tables here.
  Scenario: an event in three days is coming up, for whoever can see Events
    Given an event "Overview test quiz" in 3 days at 19:30
    When "ann.overview.admin.bdd@example.com" reads the overview
    Then the overview answer is 200
    And every number could be checked
    And "Overview test quiz" is coming up at "7:30pm", with a button to "Events"
    When "cal.overview.admin.bdd@example.com" reads the overview
    Then nothing is coming up

  Scenario: someone who can see only the contact form sees none of the numbers
    When "cal.overview.admin.bdd@example.com" reads the overview
    Then the overview answer is 200
    And it shows no numbers

  # TASK-560: the Read tick on Stories sends the status Reviewed. A story that is Reviewed is no
  # longer waiting to be read, so the Overview stops counting it.
  @admin-stories
  Scenario: a story marked as read is no longer waiting to be read
    Given a submitted story with text "A story waiting to be read (bdd-admin-stories)."
    When "ann.overview.admin.bdd@example.com" reads the overview
    Then the overview answer is 200
    And it says new stories are waiting to be read, with a button to "Stories"
    When I PATCH the admin story status to "reviewed" as "ann.overview.admin.bdd@example.com" with password "overview-pw-123"
    Then the admin response status should be 200
    When "ann.overview.admin.bdd@example.com" reads the overview
    Then one fewer story is waiting to be read
