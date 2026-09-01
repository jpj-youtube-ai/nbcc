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

  # TASK-346: the outcome must land on the send it belongs to, not the newest one to that
  # address. The old correlation was recipient + recency, which picks the WRONG row the moment
  # somebody has two recent emails — and a ball buyer now gets a confirmation and then a
  # guest-details read-back minutes later, so it would have shown both outcomes inverted.
  Scenario: a bounce lands on the email it was actually for, not the newest one
    Given two sends to "twice.audit.bdd@example.com" are on record, ids "msg-older-001" and "msg-newer-002"
    When a bounce arrives for message id "msg-older-001" to "twice.audit.bdd@example.com"
    Then the send with id "msg-older-001" should be marked "bounced"
    And the send with id "msg-newer-002" should be marked "nothing"

  Scenario: the page is its own permission, and no role below admin carries it
    Given a newsletter admin "audit.editor.bdd@example.com" with role "editor" and password "pw-ea3"
    When I fetch the email audit log
    Then the email audit response status should be 403
