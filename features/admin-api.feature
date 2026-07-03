@admin @db
Feature: Role-gated admin actions on a donor's behalf (REQ-062)
  An authenticated staff user acts on a donor via /api/admin/donors/:id. Every route
  needs a valid admin session token (401 otherwise), and the role gates writes: a
  Viewer is read-only (403 on any write), an Editor or Admin may write.

  Background:
    Given a donor "Ada Behalf" with email "ada.behalf.admin.bdd@example.com"

  Scenario: no token is rejected with 401
    When I GET the admin donor without a token
    Then the admin response status should be 401

  Scenario: a Viewer can read but not write
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    When I GET the admin donor as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 200
    When I PATCH the admin donor full name to "Ada Renamed" as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 403

  Scenario: an Editor can update the donor
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    When I PATCH the admin donor full name to "Ada Edited" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the admin response field "fullName" should be "Ada Edited"
