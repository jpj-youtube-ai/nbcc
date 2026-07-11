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
