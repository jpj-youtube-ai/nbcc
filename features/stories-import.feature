@admin @stories-import @db
Feature: Bringing the old website's My Story submissions into the admin (TASK-461)
  The old website's form collected stories before this site existed. An editor chooses its CSV
  export on the Stories view, sees what it would add and why anything would be left out, and only
  then adds them: with the dates they were sent, their consents, and never twice.

  Background:
    Given an admin user "editor.import.admin.bdd@example.com" with role "editor" and password "import-pw-123"
    And an admin user "viewer.import.admin.bdd@example.com" with role "viewer" and password "import-pw-123"

  Scenario: reading the file saves nothing, and says what it would add and why it would leave one out
    When "editor.import.admin.bdd@example.com" reads the old website's export
    Then the import status should be 200
    And it would add 2 stories and leave out 1, because "They sent it again 2 minutes later"
    And 0 stories from the old website's export are saved

  Scenario: adding saves them as sent, with their consents, and a second go adds nothing
    When "editor.import.admin.bdd@example.com" adds the old website's export
    Then the import status should be 200
    And 2 stories from the old website's export are saved
    And Morag's story is saved as sent at "2026-07-06T19:30:12.345Z", public with her first name and town, and new
    When "editor.import.admin.bdd@example.com" adds the old website's export
    Then the import status should be 200
    And 0 more stories are added
    And 2 stories from the old website's export are saved

  Scenario: bringing stories in needs a session, and edit rights over stories
    When I read the old website's export without a session
    Then the import status should be 401
    When "viewer.import.admin.bdd@example.com" reads the old website's export
    Then the import status should be 403

  Scenario: a file that is not the old form's export is refused, and says why
    When "editor.import.admin.bdd@example.com" reads a CSV with the columns "Name,Email"
    Then the import status should be 400
    And the refusal says it has no "Submission date" column
