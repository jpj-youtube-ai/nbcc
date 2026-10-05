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

  # TASK-464: one email can go to several people (the Ball's ticket report). SES names the person a
  # bounce is about: it lands on their row only, and only they are taken off future sends.
  Scenario: on an email to several people, a bounce lands on the person it was for, and nobody else
    Given one send to "ada.audit.bdd@example.com, bo.audit.bdd@example.com, cy.audit.bdd@example.com" is on record, id "msg-shared-003"
    When a bounce arrives for message id "msg-shared-003", naming only "bo.audit.bdd@example.com"
    Then the send with id "msg-shared-003" to "bo.audit.bdd@example.com" should be marked "bounced"
    And the send with id "msg-shared-003" to "ada.audit.bdd@example.com" should be marked "nothing"
    And the send with id "msg-shared-003" to "cy.audit.bdd@example.com" should be marked "nothing"
    And "bo.audit.bdd@example.com" is taken off future sends, and "ada.audit.bdd@example.com" is not

  Scenario: the page is its own permission, and no role below admin carries it
    Given a newsletter admin "audit.editor.bdd@example.com" with role "editor" and password "pw-ea3"
    When I fetch the email audit log
    Then the email audit response status should be 403

  # TASK-NNN: staff can remove an address from the red band, so a dead one stops coming back into
  # it and into the Overview's count. Nothing is deleted: the full list still has every row, and
  # says on the ones that were removed who removed them.
  Scenario: tidying an address away takes its problems out of the band and the Overview's count, until it fails again
    Given a newsletter admin "audit.tidy.bdd@example.com" with role "admin" and password "pw-ea4"
    And a failed "newsletter" email to "tidied.audit.bdd@example.com" is on record
    And I note how many email problems the Overview counts
    When I tidy "tidied.audit.bdd@example.com" away in the email audit
    Then the email audit response status should be 200
    And the Overview counts 1 fewer email problem
    And "tidied.audit.bdd@example.com" is not blocked
    When I fetch the email audit log
    Then the email audit failures should not include "tidied.audit.bdd@example.com"
    And the email audit log still lists "tidied.audit.bdd@example.com", marked as removed by "audit.tidy.bdd@example.com", kind "tidy"
    When a failed "newsletter" email to "tidied.audit.bdd@example.com" is on record
    And I fetch the email audit log
    Then the email audit failures should include "tidied.audit.bdd@example.com"

  Scenario: removing an address and stopping emails blocks it, and its later failures stay out of the band
    Given a newsletter admin "audit.stop.bdd@example.com" with role "admin" and password "pw-ea5"
    And a failed "newsletter" email to "stopped.audit.bdd@example.com" is on record
    When I remove "stopped.audit.bdd@example.com" from the email audit and stop emails to it
    Then the email audit response status should be 200
    And "stopped.audit.bdd@example.com" is blocked by staff
    When a failed "newsletter" email to "stopped.audit.bdd@example.com" is on record
    And I fetch the email audit log
    Then the email audit failures should not include "stopped.audit.bdd@example.com"

  Scenario: putting an address back returns its problems to the band and lifts the block that removing it made
    Given a newsletter admin "audit.back.bdd@example.com" with role "admin" and password "pw-ea6"
    And a failed "newsletter" email to "back.audit.bdd@example.com" is on record
    When I remove "back.audit.bdd@example.com" from the email audit and stop emails to it
    And I put "back.audit.bdd@example.com" back in the email audit
    Then the email audit response status should be 200
    And "back.audit.bdd@example.com" is not blocked
    When I fetch the email audit log
    Then the email audit failures should include "back.audit.bdd@example.com"

  # The block list keeps the first reason an address was blocked. Removing such an address did not
  # block it, so putting it back must not unblock it.
  Scenario: an address whose mail had already bounced stays blocked when it is put back
    Given a newsletter admin "audit.kept.bdd@example.com" with role "admin" and password "pw-ea7"
    And a failed "newsletter" email to "kept.audit.bdd@example.com" is on record
    And "kept.audit.bdd@example.com" is already blocked because its mail bounced
    When I remove "kept.audit.bdd@example.com" from the email audit and stop emails to it
    And I put "kept.audit.bdd@example.com" back in the email audit
    Then the email audit response status should be 200
    And "kept.audit.bdd@example.com" is still blocked because its mail bounced

  Scenario: one of the charity's own addresses is never blocked
    Given a newsletter admin "audit.own.bdd@example.com" with role "admin" and password "pw-ea8"
    When I remove "events@nbcc.scot" from the email audit and stop emails to it
    Then the email audit response status should be 400

  Scenario: someone without the Email audit cannot remove anything
    Given a newsletter admin "audit.noremove.bdd@example.com" with role "editor" and password "pw-ea9"
    When I tidy "anyone.audit.bdd@example.com" away in the email audit
    Then the email audit response status should be 403
