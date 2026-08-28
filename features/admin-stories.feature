@admin @admin-stories @db
Feature: Admin manages My Story submissions (Task C)
  An authenticated staff user lists, opens and manages story submissions from the SEPARATE
  stories database via /api/admin/stories. Every route needs a valid admin session token
  (401 otherwise); browsing is Viewer+, changing status/tags/notes is Editor+ (mirrors the
  donor admin actions in admin-api.feature).

  Background:
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    And a submitted story with text "The Red Bag changed our Christmas (bdd-admin-stories)."

  Scenario: no token is rejected with 401
    When I GET the admin stories list without a token
    Then the admin response status should be 401

  Scenario: a Viewer can list stories and see the seeded one
    When I GET the admin stories list as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 200
    And the admin stories list contains the seeded story

  Scenario: a Viewer can open a story's detail
    When I GET the admin story detail as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 200
    And the admin response field "story_text" should be "The Red Bag changed our Christmas (bdd-admin-stories)."

  Scenario: a Viewer cannot change a story's status (403)
    When I PATCH the admin story status to "reviewed" as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 403

  Scenario: an Editor withdraws a story, and it reads back as withdrawn
    When I PATCH the admin story status to "withdrawn" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the admin response field "status" should be "withdrawn"
    When I GET the admin story detail as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response field "status" should be "withdrawn"
    And the story is withdrawn in the stories database

  Scenario: an Editor rejects an invalid status value (400)
    When I PATCH the admin story status to "not_a_real_status" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 400

  Scenario: a Viewer cannot permanently delete a story (403)
    When I DELETE the admin story as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 403
    And the story still exists in the stories database

  # TASK-311: erasure now requires the story to be archived first - the everyday tidy-up action
  # cannot reach the irreversible one by accident.
  Scenario: an Editor archives then permanently erases a story, and it is gone for good
    When I archive the admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    And I DELETE the admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the story no longer exists in the stories database
    When I GET the admin story detail as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 404

  Scenario: deleting a story that does not exist returns 404
    When I DELETE a non existent admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 404

  # TASK-308: the Stories tab showed "No stories yet" - the EMPTY state, not an error - which means
  # the query reached a database and found a stories table with nothing in it. That is what a
  # freshly-bootstrapped database looks like, so the question is whether another database on the same
  # server still holds the submissions. This reports names and sizes, never story content.
  Scenario: an Editor can see where the stories data actually lives
    When I GET the stories diagnostics as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the diagnostics name the connected database
    And the diagnostics list the databases on the server
    And the diagnostics never include story text

  Scenario: a Viewer cannot see the server's databases
    When I GET the stories diagnostics as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 403

  # TASK-311: three stories were permanently deleted from production and nothing could say what had
  # gone, when or why. Archiving is now the everyday action - reversible, and it hides the story from
  # the working list without destroying it.
  Scenario: archiving hides a story from the list but keeps it
    When I archive the admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    When I GET the admin stories list as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin stories list does not contain the seeded story
    When I GET the archived admin stories as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin stories list contains the seeded story
    And the story still exists in the stories database

  Scenario: restoring brings it back to the working list
    When I archive the admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    And I restore the admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    When I GET the admin stories list as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin stories list contains the seeded story

  # Erasure stays possible - a charity must be able to honour a GDPR erasure request - but it is no
  # longer reachable by accident, and it can never be silent again.
  Scenario: erasing refuses unless the story was archived first
    When I erase the admin story with reason "no longer needed" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 409
    And the story still exists in the stories database

  Scenario: erasing refuses without a reason
    When I archive the admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    And I erase the admin story with reason "" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 400
    And the story still exists in the stories database

  Scenario: an archived story can be erased, and the erasure is recorded
    When I archive the admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    And I erase the admin story with reason "duplicate submission" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the story no longer exists in the stories database
    When I GET the erasure log as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the erasure log records that story with reason "duplicate submission"
    And the erasure log carries no personal details
