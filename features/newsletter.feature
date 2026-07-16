@newsletter @db
Feature: Admin newsletter (REQ-069)
  Staff author an HTML newsletter and save it as a draft (Editor and up). An Admin sends it to
  every consenting donor as an individual email; sending is idempotent. A Viewer cannot edit and
  an Editor cannot send.

  Scenario: an Editor creates and edits a draft
    Given a newsletter admin "editor.newsletter.bdd@example.com" with role "editor" and password "pw-editor"
    When I create a newsletter with subject "Winter update" and body "<p>Hello</p>"
    Then the newsletter response status should be 201
    When I edit that newsletter with subject "Winter update v2" and body "<p>Hello again</p>"
    Then the newsletter response status should be 200
    And the newsletter response field "subject" should be "Winter update v2"

  Scenario: an Admin sends a draft to consenting donors, and cannot re-send it
    Given a newsletter admin "admin.newsletter.bdd@example.com" with role "admin" and password "pw-admin"
    And a consenting donor with email "sub1.newsletter.bdd@example.com"
    And a consenting donor with email "sub2.newsletter.bdd@example.com"
    And a non-consenting donor with email "nope.newsletter.bdd@example.com"
    When I create a newsletter with subject "Send me" and body "<p>Go</p>"
    And I send that newsletter
    Then the newsletter response status should be 200
    And the newsletter response field "status" should be "sent"
    And the newsletter recipient count should be at least 2
    And the newsletter response field "sentCount" should be at least 2
    And the newsletter response field "failedCount" should be "0"
    When I send that newsletter
    Then the newsletter response status should be 409

  Scenario: a Viewer cannot send (newsletter is Editor+; Admin creates, Viewer is refused)
    Given a newsletter admin "sendadmin2.newsletter.bdd@example.com" with role "admin" and password "pw-sa2"
    When I create a newsletter with subject "Nope" and body "<p>x</p>"
    Then the newsletter response status should be 201
    Given a newsletter admin "sendviewer2.newsletter.bdd@example.com" with role "viewer" and password "pw-sv2"
    And I send that newsletter
    Then the newsletter response status should be 403

  Scenario: a donor unsubscribes via their token link, and is then excluded
    Given a consenting donor with email "leaver.newsletter.bdd@example.com"
    When I visit the unsubscribe link for "leaver.newsletter.bdd@example.com"
    Then the unsubscribe response status should be 200
    And the donor "leaver.newsletter.bdd@example.com" should have email consent "false"

  Scenario: an invalid unsubscribe token is rejected
    When I visit the unsubscribe link with token "garbage.token"
    Then the unsubscribe response status should be 400

  Scenario: an Editor creates a block-document draft and previews it
    Given a newsletter admin "editor3.newsletter.bdd@example.com" with role "editor" and password "pw-e3"
    When I create a block newsletter with subject "Blocks update"
    Then the newsletter response status should be 201
    When I preview the current block document
    Then the preview response status should be 200
    And the preview HTML should contain "Dear Jane,"
    And the preview HTML should contain "SC047995"

  Scenario: an Editor uploads an image and it serves back
    Given a newsletter admin "editor4.newsletter.bdd@example.com" with role "editor" and password "pw-e4"
    When I upload a newsletter image
    Then the image upload status should be 201
    When I fetch the uploaded image
    Then the image fetch status should be 200
    And the image content type should be "image/png"

  Scenario: an over-size image upload is rejected
    Given a newsletter admin "editor5.newsletter.bdd@example.com" with role "editor" and password "pw-e5"
    When I upload an oversize newsletter image
    Then the image upload status should be 413

  Scenario: a malformed newsletter image id is rejected, not crashed on
    When I fetch a malformed newsletter image id
    Then the image fetch status should be 404

  Scenario: an Admin previews the recipient list that a send would reach
    Given a newsletter admin "recip.admin.newsletter.bdd@example.com" with role "admin" and password "pw-recip"
    And a consenting donor with email "yes1.recip.newsletter.bdd@example.com"
    And a consenting donor with email "yes2.recip.newsletter.bdd@example.com"
    And a non-consenting donor with email "no.recip.newsletter.bdd@example.com"
    When I fetch the newsletter recipients
    Then the newsletter recipients status should be 200
    And the newsletter recipients should include "yes1.recip.newsletter.bdd@example.com"
    And the newsletter recipients should include "yes2.recip.newsletter.bdd@example.com"
    And the newsletter recipients should not include "no.recip.newsletter.bdd@example.com"

  Scenario: a Viewer cannot see the recipient list (newsletter:edit gates the donor PII)
    Given a newsletter admin "recip.viewer.newsletter.bdd@example.com" with role "viewer" and password "pw-rv"
    When I fetch the newsletter recipients
    Then the newsletter recipients status should be 403

  Scenario: an Editor manually adds a subscriber, who then appears in the recipient list
    Given a newsletter admin "subadmin.newsletter.bdd@example.com" with role "editor" and password "pw-sub"
    When I add the newsletter subscriber "verbal.sub.newsletter.bdd@example.com"
    Then the subscriber response status should be 201
    And the subscriber response field "status" should be "added"
    When I fetch the newsletter recipients
    Then the newsletter recipients status should be 200
    And the newsletter recipients should include "verbal.sub.newsletter.bdd@example.com"
    When I add the newsletter subscriber "verbal.sub.newsletter.bdd@example.com"
    Then the subscriber response status should be 200
    And the subscriber response field "status" should be "resubscribed"

  Scenario: a Viewer cannot manually add a subscriber
    Given a newsletter admin "subviewer.newsletter.bdd@example.com" with role "viewer" and password "pw-sv"
    When I add the newsletter subscriber "nope.sub.newsletter.bdd@example.com"
    Then the subscriber response status should be 403

  Scenario: an Editor sends a test copy to themselves
    Given a newsletter admin "test.editor.newsletter.bdd@example.com" with role "editor" and password "pw-t"
    When I test-send the block newsletter with subject "Preview me"
    Then the test-send response status should be 200

  # TASK-254: {{firstName}} in the SUBJECT. The body always merged it; the subject went out raw, so a
  # newsletter titled "Hey, {{firstName}}!" reached every donor with the marker showing. The subject
  # that actually went out is echoed back, so this proves the merge across the real HTTP hop — which is
  # where the bug lived, not in the merge function.
  Scenario: the donor's name is merged into the subject, not just the body
    Given a newsletter admin "subj.editor.newsletter.bdd@example.com" with role "editor" and password "pw-s"
    When I test-send the block newsletter with subject "Hey, {{firstName}}! it's the NBCC"
    Then the test-send response status should be 200
    # A test copy shows what a DONOR gets, so it personalises as the sample donor the preview uses.
    And the test-send subject should be "[TEST] Hey, Jane! it's the NBCC"
    And the test-send subject should not contain "{{firstName}}"

  Scenario: a Viewer cannot test-send
    Given a newsletter admin "test.viewer.newsletter.bdd@example.com" with role "viewer" and password "pw-tv"
    When I test-send the block newsletter with subject "Nope"
    Then the test-send response status should be 403

  Scenario: an Editor lists, exports and removes subscribers
    Given a newsletter admin "mgr.newsletter.bdd@example.com" with role "editor" and password "pw-mgr"
    And a consenting donor with email "keep.mgr.newsletter.bdd@example.com"
    And a consenting donor with email "drop.mgr.newsletter.bdd@example.com"
    When I list the newsletter subscribers
    Then the subscriber list status should be 200
    And the subscriber list should include "keep.mgr.newsletter.bdd@example.com"
    When I export the newsletter subscribers as CSV
    Then the CSV status should be 200
    And the CSV should contain "keep.mgr.newsletter.bdd@example.com"
    When I remove the newsletter subscriber "drop.mgr.newsletter.bdd@example.com"
    Then the remove-subscriber response status should be 200
    When I list the newsletter subscribers
    Then the subscriber list should not include "drop.mgr.newsletter.bdd@example.com"

  Scenario: a Viewer cannot list subscribers (donor PII)
    Given a newsletter admin "mgr.viewer.newsletter.bdd@example.com" with role "viewer" and password "pw-mv"
    When I list the newsletter subscribers
    Then the subscriber list status should be 403

  Scenario: an Editor attaches a file, lists it, and removes it
    Given a newsletter admin "att.editor.newsletter.bdd@example.com" with role "editor" and password "pw-att"
    When I create a block newsletter with subject "Blocks update"
    Then the newsletter response status should be 201
    When I attach a "application/pdf" file named "flyer.pdf" to that newsletter
    Then the attachment response status should be 201
    When I list the attachments for that newsletter
    Then the attachment list should include "flyer.pdf"
    When I delete that attachment
    Then the attachment delete status should be 200
    When I list the attachments for that newsletter
    Then the attachment list should not include "flyer.pdf"

  Scenario: an unsupported attachment type is rejected
    Given a newsletter admin "att.mime.newsletter.bdd@example.com" with role "editor" and password "pw-attm"
    When I create a block newsletter with subject "Blocks update"
    When I attach a "application/x-msdownload" file named "danger.exe" to that newsletter
    Then the attachment response status should be 400

  Scenario: a Viewer cannot attach a file
    Given a newsletter admin "att.admin.newsletter.bdd@example.com" with role "admin" and password "pw-atta"
    When I create a block newsletter with subject "Blocks update"
    Then the newsletter response status should be 201
    Given a newsletter admin "att.viewer.newsletter.bdd@example.com" with role "viewer" and password "pw-attv"
    When I attach a "application/pdf" file named "x.pdf" to that newsletter
    Then the attachment response status should be 403

  # TASK-249: the SHARED saved-template library. What matters end to end is the round trip — a saved
  # template comes back as a usable block document, so next month's newsletter really can start from
  # it — plus the two things a shared library makes routine rather than exceptional: a name already
  # taken (409, explained, never a 500), and a template someone else already deleted (404).
  Scenario: an Editor saves a newsletter as a template, starts from it, and the name is protected
    Given a newsletter admin "editor5.newsletter.bdd@example.com" with role "editor" and password "pw-e5"
    When I save the current block document as a template named "Bdd Christmas Appeal"
    Then the template response status should be 201

    # It appears in the shared library for the whole team.
    When I fetch the newsletter templates
    Then the template response status should be 200
    And the template list should contain "Bdd Christmas Appeal"

    # Starting from it returns a real block document, not just a name.
    When I fetch that saved template
    Then the template response status should be 200
    And the saved template should carry its block document

    # A shared library means clashes happen; they are explained, not a 500.
    When I save the current block document as a template named "Bdd Christmas Appeal"
    Then the template response status should be 409

    When I delete that saved template
    Then the template response status should be 204
    # Deleting it again is a 404, not a pretend success — someone else may have removed it first.
    When I delete that saved template
    Then the template response status should be 404

  # TASK-252: deleting a newsletter. A draft never went anywhere, so it really goes. A SENT newsletter
  # went to real donors — deleting the row would destroy the record of what was emailed, so it is
  # REDACTED instead: the content and the bounced addresses go, the audit stub stays. This scenario
  # exists to prove the stub SURVIVES, because that is the whole promise.
  Scenario: an Admin deletes a draft outright, and a sent newsletter keeps its audit stub
    Given a newsletter admin "admin2.newsletter.bdd@example.com" with role "admin" and password "pw-admin2"
    And a consenting donor with email "sub3.newsletter.bdd@example.com"

    # A draft never reached anyone → really deleted, and then it is gone.
    When I create a newsletter with subject "Nope" and body "<p>Draft</p>"
    And I delete that newsletter
    Then the newsletter response status should be 200
    And the newsletter response field "status" should be "deleted"
    When I fetch that newsletter
    Then the newsletter response status should be 404

    # A SENT newsletter is redacted, not deleted.
    When I create a newsletter with subject "Send me" and body "<p>Real content</p>"
    And I send that newsletter
    Then the newsletter response status should be 200
    When I delete that newsletter
    Then the newsletter response status should be 200
    And the newsletter response field "status" should be "redacted"

    # The stub is still there — and still answers what was sent, when, and to how many.
    When I fetch that newsletter
    Then the newsletter response status should be 200
    And the newsletter response field "subject" should be "Send me"
    And the newsletter response field "status" should be "sent"
    And the newsletter recipient count should be at least 1
    # …but the content is gone.
    And the newsletter body should be empty

  # TASK-255: delivery-truth stats (email dashboard Phase 1). Resend reports what happened to each
  # email via a signed webhook; this proves the full loop against the running app: send -> a SIGNED
  # delivered/bounced event for that address -> the stats endpoint reflects it. Plus the trust
  # boundary (an unsigned report is rejected) and the privacy rule (an event for an address we never
  # sent a newsletter to is acknowledged but NOT stored).
  Scenario: delivery events land in the newsletter's stats, and only signed ones count
    Given a newsletter admin "stats.admin.newsletter.bdd@example.com" with role "admin" and password "pw-st"
    And a consenting donor with email "delivered.newsletter.bdd@example.com"
    And a consenting donor with email "bounced.newsletter.bdd@example.com"
    When I create a newsletter with subject "Send me" and body "<p>Go</p>"
    And I send that newsletter
    Then the newsletter response status should be 200

    # Resend reports: one delivered, one bounced — each signed with the real webhook secret.
    When Resend reports a signed "email.delivered" event for "delivered.newsletter.bdd@example.com"
    Then the webhook response status should be 200
    When Resend reports a signed "email.bounced" event for "bounced.newsletter.bdd@example.com"
    Then the webhook response status should be 200

    # A duplicate retry of the same event must not double-count (Svix retries until acknowledged).
    When Resend retries the last event
    Then the webhook response status should be 200

    When I fetch that newsletter's stats
    Then the newsletter stats should show at least 2 sends, 1 delivered and 1 bounced
    And the bounced addresses should include "bounced.newsletter.bdd@example.com"

    # The trust boundary: an unsigned report is turned away.
    When Resend reports an UNSIGNED "email.delivered" event for "delivered.newsletter.bdd@example.com"
    Then the webhook response status should be 401

    # The privacy rule: an event for an address with no newsletter send is dropped, not warehoused.
    When Resend reports a signed "email.delivered" event for "receipt-only.bdd@example.com"
    Then the webhook response status should be 200
    And the webhook outcome should be "unmatched"
