@admin @db
Feature: Admin per-section permission matrix (admin-management Phase 2)
  A DB-backed authorizeSection gate checks a staff member's EFFECTIVE per-section permissions
  (their stored `permissions` matrix if set, else their role's defaults via roleToPermissions) on
  every admin request, replacing the flat viewer/editor/admin role gate. An admin can fine-tune a
  person's access section by section, and there must always be at least one enabled user with
  edit access to the "team" section (the new "last admin").

  Background:
    Given an admin user "root.admin.bdd@example.com" with password "root-pw-123"

  Scenario: a user with only stories:view can read stories, but not write stories or read donations
    Given a staff user "limited.admin.bdd@example.com" with password "limited-pw-123" and only "stories:view" permission
    And a submitted story with text "The Red Bag changed our Christmas (bdd-admin-permissions)."
    When I GET the admin path "/api/admin/stories" as "limited.admin.bdd@example.com" with password "limited-pw-123"
    Then the admin response status should be 200
    When I PATCH the admin story status to "reviewed" as "limited.admin.bdd@example.com" with password "limited-pw-123"
    Then the admin response status should be 403
    When I GET the admin path "/api/admin/donations" as "limited.admin.bdd@example.com" with password "limited-pw-123"
    Then the admin response status should be 403

  Scenario: granting donations:edit lets the user act on donations
    Given a staff user "grantee.admin.bdd@example.com" with password "grantee-pw-123" and only "stories:view" permission
    And a donor "Dana Donor" with email "dana.donor.admin.bdd@example.com"
    When I PATCH the admin donor full name to "Dana D. Updated" as "grantee.admin.bdd@example.com" with password "grantee-pw-123"
    Then the admin response status should be 403
    When I PATCH the admin user "grantee.admin.bdd@example.com" permissions to add "donations:edit" as "root.admin.bdd@example.com" with password "root-pw-123"
    Then the admin response status should be 200
    When I PATCH the admin donor full name to "Dana D. Updated" as "grantee.admin.bdd@example.com" with password "grantee-pw-123"
    Then the admin response status should be 200

  Scenario: a user without team:edit is forbidden from changing another user's permissions
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "editor-pw-123"
    And a staff user "target.admin.bdd@example.com" with password "target-pw-123" and only "stories:view" permission
    When I PATCH the admin user "target.admin.bdd@example.com" permissions to add "donations:edit" as "editor.admin.bdd@example.com" with password "editor-pw-123"
    Then the admin response status should be 403

  @admin-last-guard
  Scenario: removing the last effective team:edit holder is blocked with 409 last_admin
    Given an admin user "lone.admin.bdd@example.com" with password "lone-pw-123"
    And every other enabled admin is temporarily disabled, leaving only "lone.admin.bdd@example.com"
    When I PATCH the admin user "lone.admin.bdd@example.com" permissions to remove team edit as "lone.admin.bdd@example.com" with password "lone-pw-123"
    Then the admin response status should be 409
    And the admin response field "error" should be "last_admin"

  Scenario: GET /api/admin/me returns the caller's effective permissions
    Given a staff user "me.admin.bdd@example.com" with password "me-pw-123" and only "stories:view" permission
    When I GET the admin path "/api/admin/me" as "me.admin.bdd@example.com" with password "me-pw-123"
    Then the admin response status should be 200
    And the admin response field "email" should be "me.admin.bdd@example.com"
    And the admin response permissions field "stories" should be "view"
    And the admin response permissions field "donations" should be "none"
