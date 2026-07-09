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

  Scenario: an Editor permanently deletes a story, and it is gone for good
    When I DELETE the admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the story no longer exists in the stories database
    When I GET the admin story detail as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 404

  Scenario: deleting a story that does not exist returns 404
    When I DELETE a non existent admin story as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 404
