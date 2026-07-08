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

  Scenario: an Editor cannot send
    Given a newsletter admin "editor2.newsletter.bdd@example.com" with role "editor" and password "pw-e2"
    When I create a newsletter with subject "Nope" and body "<p>x</p>"
    And I send that newsletter
    Then the newsletter response status should be 403
