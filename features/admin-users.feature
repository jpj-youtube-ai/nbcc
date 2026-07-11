@admin @db
Feature: Admin user management (admin-management Phase 1)
  An Admin manages who can sign in to /admin from the Team view: invite, change role,
  disable/enable, and remove staff, plus self-service and admin-initiated password
  resets. Only the admin role may reach /api/admin/users*; there must always be at
  least one enabled admin.

  Scenario: an admin invites a new staff user
    Given an admin user "inviter.admin.bdd@example.com" with password "invite-pw-123"
    When I POST an admin invite for "invitee.admin.bdd@example.com" named "Nina Invitee" with role "editor" as "inviter.admin.bdd@example.com" with password "invite-pw-123"
    Then the admin response status should be 201
    And the admin invite response has a new user id

  Scenario: an invited user accepts via set-password and then logs in
    Given an admin user "inviter2.admin.bdd@example.com" with password "invite-pw-456"
    When I POST an admin invite for "accept.admin.bdd@example.com" named "Ada Accept" with role "editor" as "inviter2.admin.bdd@example.com" with password "invite-pw-456"
    Then the admin response status should be 201
    When I set the invited user's password to "brand-new-pw-123" using their invite token
    Then the admin response status should be 200
    When I POST to admin login with email "accept.admin.bdd@example.com" and password "brand-new-pw-123"
    Then the admin response status should be 200
    And the admin response requires a one-time code
    When I POST to admin login 2fa with email "accept.admin.bdd@example.com" and the code from the login response
    Then the admin response status should be 200
    And the admin response has a session token

  Scenario: forgot-password returns 200 whether or not the email is known (no enumeration)
    Given an admin user "known.admin.bdd@example.com" with password "known-pw-123"
    When I POST an admin forgot-password request for "known.admin.bdd@example.com"
    Then the admin response status should be 200
    And the admin response field "ok" should be "true"
    When I POST an admin forgot-password request for "unknown.admin.bdd@example.com"
    Then the admin response status should be 200
    And the admin response field "ok" should be "true"

  Scenario: an admin disables a user and their login is blocked
    Given an admin user "disabler.admin.bdd@example.com" with password "disable-admin-pw"
    And an admin user "blocked.admin.bdd@example.com" with role "editor" and password "blocked-pw-123"
    When I PATCH the admin user "blocked.admin.bdd@example.com" status to "disabled" as "disabler.admin.bdd@example.com" with password "disable-admin-pw"
    Then the admin response status should be 200
    When I POST to admin login with email "blocked.admin.bdd@example.com" and password "blocked-pw-123"
    Then the admin response status should be 401
    And the admin response has no session token

  Scenario: a non-admin is forbidden from the user-management API
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "editor-pw-123"
    When I GET the admin path "/api/admin/users" as "editor.admin.bdd@example.com" with password "editor-pw-123"
    Then the admin response status should be 403

  @admin-last-guard
  Scenario: the last-admin guard blocks demoting the only enabled admin
    Given an admin user "lone.admin.bdd@example.com" with password "lone-pw-123"
    And every other enabled admin is temporarily disabled, leaving only "lone.admin.bdd@example.com"
    When I PATCH the admin user "lone.admin.bdd@example.com" role to "editor" as "lone.admin.bdd@example.com" with password "lone-pw-123"
    Then the admin response status should be 409
    And the admin response field "error" should be "last_admin"
