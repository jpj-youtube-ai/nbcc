@admin @db
Feature: Role-based admin login (REQ-062)
  A staff user signs in at POST /api/admin/login with their email and password.
  Valid credentials return a signed session token; invalid credentials are rejected
  with 401.

  Scenario: an admin signs in with valid credentials and receives a session token
    Given an admin user "kenny.admin.bdd@example.com" with password "correct-horse-battery"
    When I POST to admin login with email "kenny.admin.bdd@example.com" and password "correct-horse-battery"
    Then the admin response status should be 200
    And the admin response has a session token

  Scenario: a wrong password is rejected with 401
    Given an admin user "kenny.admin.bdd@example.com" with password "correct-horse-battery"
    When I POST to admin login with email "kenny.admin.bdd@example.com" and password "wrong-password"
    Then the admin response status should be 401
    And the admin response has no session token
