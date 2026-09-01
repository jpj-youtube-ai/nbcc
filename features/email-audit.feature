@email-audit @db
Feature: Email audit page (email-audit feature)
  Every email the system tries to send lands one metadata row in the audit log, and the admin
  page shows them newest first with recent failures pinned in a red band. Access is its own
  permission: admins carry it by default; no other role does.

  Scenario: an admin sees sends the system made, and failures land in the red band
    Given a newsletter admin "audit.admin.bdd@example.com" with role "admin" and password "pw-ea"
    # A real send through the app (the team invite email) writes its own audit row — in CI the
    # provider is stubbed, and a stubbed send still logs as sent so this page is exercised
    # end to end without a mail account.
    When I invite "invited.audit.bdd@example.com" named "Ada Auditland" to the team
    # A failure is seeded directly: CI's stub provider cannot be made to fail on demand, and the
    # red band's job is to show whatever row says failed, however it got there.
    And a failed "newsletter" email to "broken.audit.bdd@example.com" is on record
    When I fetch the email audit log
    Then the email audit response status should be 200
    And the email audit log should include a "adminInvite" email to "invited.audit.bdd@example.com"
    And the email audit failures should include "broken.audit.bdd@example.com"

  Scenario: the log is searchable and filterable by type
    Given a newsletter admin "audit.search.bdd@example.com" with role "admin" and password "pw-ea2"
    When I invite "findme.audit.bdd@example.com" named "Finn Delane" to the team
    And I search the email audit log for "Finn Delane"
    Then the email audit response status should be 200
    And every email audit result should be to "findme.audit.bdd@example.com"
    When I filter the email audit log by type "newsletter"
    Then every email audit result should be of type "newsletter"

  Scenario: the page is its own permission, and no role below admin carries it
    Given a newsletter admin "audit.editor.bdd@example.com" with role "editor" and password "pw-ea3"
    When I fetch the email audit log
    Then the email audit response status should be 403
