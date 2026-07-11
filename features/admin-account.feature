@admin @db
Feature: My account (admin-management Phase 4)
  Any signed-in admin user (any role) can change their own display name and password from
  the My account panel, using authorizeAny (no section/level permission required). Email is
  not self-editable here (only an admin can change it, via the Team tab). Every self-account
  change is recorded in the audit log as an admin_user.* event, alongside the events the Team
  tab already records (invite, role/status/permissions changes, resets).

  Scenario: an admin changes their own display name
    Given an admin user "account.name.admin.bdd@example.com" with password "account-name-pw-1"
    When I PATCH my own admin name to "Nadia Newname" as "account.name.admin.bdd@example.com" with password "account-name-pw-1"
    Then the admin response status should be 200
    And the admin response field "fullName" should be "Nadia Newname"

  Scenario: a name change is recorded in the audit log
    Given an admin user "account.audit.admin.bdd@example.com" with password "account-audit-pw-1"
    When I PATCH my own admin name to "Ada Audited" as "account.audit.admin.bdd@example.com" with password "account-audit-pw-1"
    Then the admin response status should be 200
    And an audit_log row for action "admin_user.name_changed" by actor "admin:account.audit.admin.bdd@example.com" exists

  Scenario: an admin changes their own password with the correct current password
    Given an admin user "account.pw.admin.bdd@example.com" with password "account-pw-old-1"
    When I POST an admin password change with current password "account-pw-old-1" and new password "account-pw-new-1" as "account.pw.admin.bdd@example.com" with password "account-pw-old-1"
    Then the admin response status should be 200
    When I POST to admin login with email "account.pw.admin.bdd@example.com" and password "account-pw-new-1"
    Then the admin response status should be 200
    And an audit_log row for action "admin_user.password_changed" by actor "admin:account.pw.admin.bdd@example.com" exists

  Scenario: a wrong current password is rejected
    Given an admin user "account.wrong.admin.bdd@example.com" with password "account-wrong-pw-1"
    When I POST an admin password change with current password "not-the-real-password" and new password "account-wrong-new-1" as "account.wrong.admin.bdd@example.com" with password "account-wrong-pw-1"
    Then the admin response status should be 400
    And the admin response field "error" should be "wrong_password"
