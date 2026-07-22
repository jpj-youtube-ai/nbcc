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

  # Hosted documents (2026-07-22 design): an uploaded file is never attached to the email — it is
  # served from a public viewer page (print/download) that a button block links. The uuid is the
  # capability: with it the page opens with no session; without a valid one there is only a 404.
  Scenario: an uploaded document is hosted on a public print and download page
    Given a newsletter admin "doc.editor.newsletter.bdd@example.com" with role "editor" and password "pw-doc"
    When I create a block newsletter with subject "Certificate issue"
    Then the newsletter response status should be 201
    When I attach a "application/pdf" file named "certificate.pdf" to that newsletter
    Then the attachment response status should be 201
    When I open the hosted document page for that upload with no session
    Then the hosted document page status should be 200
    And the hosted document page should include "certificate.pdf"
    And the hosted document page should include "Download"
    When I fetch the hosted document file for that upload
    Then the hosted document file status should be 200
    And the hosted document file content type should be "application/pdf"
    And the hosted document file disposition should be "inline"
    When I fetch the hosted document file for that upload with download
    Then the hosted document file disposition should be "attachment"
    When I open the hosted document page for an unknown id
    Then the hosted document page status should be 404

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

  # TASK-258 (supersedes TASK-252): a DRAFT deletes outright; a SENT newsletter is a PERMANENT
  # record — the server refuses to delete it and its content stays fetchable forever. The full history
  # of what was said to donors is the point.
  Scenario: an Admin deletes a draft, but a sent newsletter is permanent
    Given a newsletter admin "admin2.newsletter.bdd@example.com" with role "admin" and password "pw-admin2"
    And a consenting donor with email "sub3.newsletter.bdd@example.com"

    # A draft never reached anyone -> really deleted, and then it is gone.
    When I create a newsletter with subject "Nope" and body "<p>Draft</p>"
    And I delete that newsletter
    Then the newsletter response status should be 200
    And the newsletter response field "status" should be "deleted"
    When I fetch that newsletter
    Then the newsletter response status should be 404

    # A SENT newsletter cannot be deleted — by anyone.
    When I create a newsletter with subject "Send me" and body "<p>Real content</p>"
    And I send that newsletter
    Then the newsletter response status should be 200
    When I delete that newsletter
    Then the newsletter response status should be 409

    # And every part of the record — including the content itself — is still there.
    When I fetch that newsletter
    Then the newsletter response status should be 200
    And the newsletter response field "subject" should be "Send me"
    And the newsletter response field "status" should be "sent"
    And the newsletter response field "bodyHtml" should be "<p>Real content</p>"
    And the newsletter recipient count should be at least 1

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

    # TASK-257 (Phase 2): engagement rides the SAME webhook once tracking is on. A click carries WHICH
    # link, and the stats break clicks down per link.
    When Resend reports a signed click on "https://nbcc.scot/donate" by "delivered.newsletter.bdd@example.com"
    Then the webhook response status should be 200
    When I fetch that newsletter's stats
    Then the newsletter stats should count 1 click
    And the per-link stats should show 1 person clicked "https://nbcc.scot/donate"

  # TASK-259: audiences. Volunteers/partners/referrers are their OWN lists: a send to one reaches
  # exactly its members (not the donors), and a member's unsubscribe link leaves that one list —
  # attributed on the stats — without touching anyone's newsletter consent.
  Scenario: an audience is its own list, its own send, and its own unsubscribe
    Given a newsletter admin "aud.admin.newsletter.bdd@example.com" with role "admin" and password "pw-aud"
    And a consenting donor with email "bystander.newsletter.bdd@example.com"
    When I create an audience named "Bdd Street Team"
    Then the audience response status should be 201
    When I add "casey@street.bdd.example.com" named "Casey" to that audience
    Then the audience response status should be 201

    # The send reaches the audience — and ONLY the audience: the consenting donor is not in it.
    When I create a newsletter with subject "Send me" and body "<p>Team news</p>"
    And I send that newsletter to that audience
    Then the newsletter response status should be 200
    And the newsletter response field "recipientCount" should be "1"

    # Their unsubscribe link (a SUBSCRIBER token) leaves this one list.
    When that audience member unsubscribes via their link
    Then the audience has 0 members
    When I fetch that newsletter's stats
    Then the newsletter stats should count 1 unsubscribe

  # TASK-260: spreadsheet import. Preview first (the admin confirms exactly what they see), the
  # consent attestation is the gate, and an opted-out address is NEVER re-added by a spreadsheet.
  Scenario: importing a spreadsheet previews first, requires attestation, and honours opt-outs
    Given a newsletter admin "imp.admin.newsletter.bdd@example.com" with role "admin" and password "pw-imp"
    When I create an audience named "Bdd Import Crew"
    Then the audience response status should be 201
    # Someone who was on the audience and opted out — the tombstone the import must respect.
    When I add "gone@street.bdd.example.com" named "Gone" to that audience
    And I remove "gone@street.bdd.example.com" from that audience

    # The file: one good row, the opted-out person, a duplicate and a junk row.
    When I preview an import into that audience:
      """
      Name,Email
      Fresh Person,fresh@street.bdd.example.com
      Gone Person,gone@street.bdd.example.com
      Fresh Again,FRESH@street.bdd.example.com
      No Email Here,
      """
    Then the import preview shows 1 ready, 1 previously opted out and 2 issues

    # No attestation, no import.
    When I import it without attestation
    Then the audience response status should be 400
    When I import it with attestation
    Then the import result is 1 added and 1 kept out
    And the audience has 1 members

  # TASK-261: the public footer signup. Consent is the gate (PECR: a positive action), the honeypot
  # eats bots without telling them, and a real signup lands on the Newsletter audience with
  # consent_source 'footer'.
  Scenario: a visitor signs up in the footer, and only with consent
    Given a newsletter admin "foot.admin.newsletter.bdd@example.com" with role "admin" and password "pw-ft"
    When a visitor subscribes in the footer as "Footer Fan" with email "fan@street.bdd.example.com"
    Then the subscribe response status should be 201
    And the Newsletter audience includes "fan@street.bdd.example.com"

    When a visitor subscribes in the footer as "No Consent" with email "noc@street.bdd.example.com" but without consent
    Then the subscribe response status should be 400
    And the Newsletter audience does not include "noc@street.bdd.example.com"

    # A bot fills the field people never see: cheerfully accepted, silently dropped.
    When a bot fills the footer honeypot with email "bot@street.bdd.example.com"
    Then the subscribe response status should be 200
    And the Newsletter audience does not include "bot@street.bdd.example.com"
