@admin @db
Feature: Role-based admin login (REQ-062)
  A staff user signs in at POST /api/admin/login with their email and password.
  Valid credentials are accepted but, as of admin-management Phase 3 (TASK-188), no
  longer issue a session directly — mandatory email 2FA (features/admin-2fa.feature)
  requires a one-time code from an untrusted device before a session is issued.
  Invalid credentials are rejected with 401 either way.

  Scenario: an admin signs in with valid credentials and is prompted for a one-time code
    Given an admin user "kenny.admin.bdd@example.com" with password "correct-horse-battery"
    When I POST to admin login with email "kenny.admin.bdd@example.com" and password "correct-horse-battery"
    Then the admin response status should be 200
    And the admin response has no session token
    And the admin response requires a one-time code

  Scenario: a wrong password is rejected with 401
    Given an admin user "kenny.admin.bdd@example.com" with password "correct-horse-battery"
    When I POST to admin login with email "kenny.admin.bdd@example.com" and password "wrong-password"
    Then the admin response status should be 401
    And the admin response has no session token
