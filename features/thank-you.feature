@thankyou @db
Feature: Admin thank-you eligible-donors list (REQ-069 · TASK-162)
  So that staff can thank the most significant givers, the admin lists donors whose
  largest single paid gift crosses a threshold, tagging each with whether they can be
  emailed and whether they have already been thanked.

  Background:
    Given an admin user "ty.viewer@example.com" with role "viewer" and password "view-pw-123"

  Scenario: only donors over the threshold are listed
    Given a donor named "Margaret Robertson" who gave a single paid gift of 150000 pence
    And a donor named "Wee Gifter" who gave a single paid gift of 50000 pence
    When I list thank-you eligible donors over 100000 pence as "ty.viewer@example.com" with password "view-pw-123"
    Then the admin response status should be 200
    And the thank-you eligible results should include "Margaret Robertson"
    And the thank-you eligible results should not include "Wee Gifter"
    And the thank-you eligible donor "Margaret Robertson" should have send-state "ready"

  Scenario: each donor is tagged with a send-state and whether already thanked
    Given a donor named "Nessa NoEmail" with no email who gave a single paid gift of 200000 pence
    And a donor named "Olive OptedOut" who opted out of email gave a single paid gift of 200000 pence
    And a donor named "Tam Thanked" who gave a single paid gift of 200000 pence
    And the donor "Tam Thanked" has already been thanked
    When I list thank-you eligible donors over 100000 pence as "ty.viewer@example.com" with password "view-pw-123"
    Then the thank-you eligible donor "Nessa NoEmail" should have send-state "no_email"
    And the thank-you eligible donor "Olive OptedOut" should have send-state "opted_out"
    And the thank-you eligible donor "Tam Thanked" should be marked already thanked

  Scenario: the list requires an admin session
    When I list thank-you eligible donors over 100000 pence with no token
    Then the admin response status should be 401

  # TASK-163: composing + sending a thank-you letter, and the sent-letter history.

  Scenario: an Editor sends a thank-you letter; it is recorded, audited and listed in the history
    Given an admin user "ty.editor@example.com" with role "editor" and password "edit-pw-123"
    When I send a thank-you letter as "ty.editor@example.com" with password "edit-pw-123" to "grace.bell@example.com" for "Grace Bell"
    Then the admin response status should be 201
    And a thank-you letter to "grace.bell@example.com" should be recorded
    And the sent thank-you should have an audit row
    When I list sent thank-you letters as "ty.editor@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the sent thank-you history should include a letter to "grace.bell@example.com"

  Scenario: a Viewer may read the sent history but cannot send a letter
    When I send a thank-you letter as "ty.viewer@example.com" with password "view-pw-123" to "blocked@example.com" for "Blocked Sender"
    Then the admin response status should be 403
    When I list sent thank-you letters as "ty.viewer@example.com" with password "view-pw-123"
    Then the admin response status should be 200

  Scenario: a thank-you with no recipient email is rejected
    Given an admin user "ty.editor2@example.com" with role "editor" and password "edit2-pw-123"
    When I send a thank-you letter as "ty.editor2@example.com" with password "edit2-pw-123" to "not-an-email" for "Bad Email"
    Then the admin response status should be 400

  # TASK-168: deleting a sent thank-you from the history, and copying someone via CC.

  Scenario: an Editor deletes a sent thank-you from the history, and it is audited
    Given an admin user "ty.editor.del@example.com" with role "editor" and password "del-pw-123"
    When I send a thank-you letter as "ty.editor.del@example.com" with password "del-pw-123" to "del.me@example.com" for "Del Me"
    Then the admin response status should be 201
    When I delete that sent thank-you as "ty.editor.del@example.com" with password "del-pw-123"
    Then the admin response status should be 200
    And a thank-you letter to "del.me@example.com" should not be recorded
    And there should be a "thank_you.deleted" audit row for the deleted thank-you

  Scenario: a Viewer cannot delete a sent thank-you
    Given an admin user "ty.editor.del2@example.com" with role "editor" and password "del2-pw-123"
    When I send a thank-you letter as "ty.editor.del2@example.com" with password "del2-pw-123" to "keep.me@example.com" for "Keep Me"
    Then the admin response status should be 201
    When I delete that sent thank-you as "ty.viewer@example.com" with password "view-pw-123"
    Then the admin response status should be 403
    And a thank-you letter to "keep.me@example.com" should be recorded

  Scenario: deleting a thank-you that does not exist is a 404
    Given an admin user "ty.editor.del3@example.com" with role "editor" and password "del3-pw-123"
    When I delete thank-you letter id 999999 as "ty.editor.del3@example.com" with password "del3-pw-123"
    Then the admin response status should be 404

  Scenario: a CC address is accepted, and an invalid CC is rejected
    Given an admin user "ty.editor.cc@example.com" with role "editor" and password "cc-pw-123"
    When I send a thank-you letter as "ty.editor.cc@example.com" with password "cc-pw-123" to "cc.recip@example.com" for "Cc Recip" cc "colleague@example.com"
    Then the admin response status should be 201
    When I send a thank-you letter as "ty.editor.cc@example.com" with password "cc-pw-123" to "cc.recip2@example.com" for "Cc Recip2" cc "not-an-email"
    Then the admin response status should be 400
  # TASK-165: the sent letter has a public, tokenised print-your-letter page.

  Scenario: the sent letter is reachable at its signed print link
    Given an admin user "ty.editor3@example.com" with role "editor" and password "edit3-pw-123"
    When I send a thank-you letter as "ty.editor3@example.com" with password "edit3-pw-123" to "print.me@example.com" for "Print Me"
    Then the admin response status should be 201
    When I open the print page for that sent letter
    Then the print page status should be 200
    And the print page should show "Thank you, Print Me."

  Scenario: an invalid print link is rejected
    When I open the print page with an invalid token
    Then the print page status should be 400
