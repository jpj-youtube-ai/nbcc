@admin @db
Feature: Mandatory email 2FA on admin login (admin-management Phase 3)
  Every admin login requires a one-time emailed code unless the browser already holds a
  valid 30-day "remember this device" token. Step 1 (POST /api/admin/login) verifies the
  password and, absent a trusted device, issues a 6-digit code instead of a session; step 2
  (POST /api/admin/login/2fa) verifies the code and issues the session (optionally a device
  token to skip the code step next time). In this non-production test environment the email
  client is stubbed, so the code is also returned as `devCode` on the step-1 response.

  Scenario: correct password prompts for a one-time code, with a devCode in this stubbed environment
    Given an admin user "twofa1.admin.bdd@example.com" with password "correct-horse-battery"
    When I POST to admin login with email "twofa1.admin.bdd@example.com" and password "correct-horse-battery"
    Then the admin response status should be 200
    And the admin response has no session token
    And the admin response requires a one-time code
    And the admin response includes a one-time code for this non-production environment

  Scenario: a wrong code is rejected, the correct code then signs in
    Given an admin user "twofa2.admin.bdd@example.com" with password "correct-horse-battery"
    When I POST to admin login with email "twofa2.admin.bdd@example.com" and password "correct-horse-battery"
    Then the admin response status should be 200
    When I POST to admin login 2fa with a wrong code for "twofa2.admin.bdd@example.com"
    Then the admin response status should be 401
    And the admin response has no session token
    When I POST to admin login 2fa with email "twofa2.admin.bdd@example.com" and the code from the login response
    Then the admin response status should be 200
    And the admin response has a session token

  Scenario: a valid device token skips the code step on the next login
    Given an admin user "twofa3.admin.bdd@example.com" with password "correct-horse-battery"
    When I POST to admin login with email "twofa3.admin.bdd@example.com" and password "correct-horse-battery"
    Then the admin response status should be 200
    When I POST to admin login 2fa with email "twofa3.admin.bdd@example.com" and the code from the login response, remembering the device
    Then the admin response status should be 200
    And the admin response has a session token
    And the admin response has a device token
    When I POST to admin login with email "twofa3.admin.bdd@example.com", password "correct-horse-battery" and the device token from the 2fa response
    Then the admin response status should be 200
    And the admin response has a session token
    And the admin response does not require a one-time code

  Scenario: too many wrong codes locks out the pending challenge
    Given an admin user "twofa4.admin.bdd@example.com" with password "correct-horse-battery"
    When I POST to admin login with email "twofa4.admin.bdd@example.com" and password "correct-horse-battery"
    Then the admin response status should be 200
    When I submit 6 wrong admin 2FA codes for "twofa4.admin.bdd@example.com"
    Then the admin response status should be 401
    And the admin response has no session token
    When I POST to admin login 2fa with email "twofa4.admin.bdd@example.com" and the code from the login response
    Then the admin response status should be 401
    And the admin response has no session token
