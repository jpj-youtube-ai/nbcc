@ticker @db
Feature: Supporter ticker (REQ-003 · TASK-178)
  Staff curate a list of ongoing supporters. Active ones are served to the public ticker under the
  site nav. Adding/editing/removing is Editor and up; a Viewer cannot write.

  Scenario: an Editor adds a supporter and it appears in the public feed
    Given a ticker admin "editor.ticker.bdd@example.com" with role "editor" and password "pw-edit"
    When I add the supporter "Ayrshire Bakery" as "editor.ticker.bdd@example.com"
    Then the ticker response status should be 201
    Then the public ticker feed should include "Ayrshire Bakery"

  Scenario: hiding a supporter removes it from the public feed but keeps the row
    Given a ticker admin "editor2.ticker.bdd@example.com" with role "editor" and password "pw-edit2"
    When I add the supporter "Troon Toys" as "editor2.ticker.bdd@example.com"
    Then the ticker response status should be 201
    When I hide that supporter as "editor2.ticker.bdd@example.com"
    Then the ticker response status should be 200
    And the public ticker feed should not include "Troon Toys"

  Scenario: an Editor deletes a supporter
    Given a ticker admin "editor3.ticker.bdd@example.com" with role "editor" and password "pw-edit3"
    When I add the supporter "Gone Soon Ltd" as "editor3.ticker.bdd@example.com"
    Then the ticker response status should be 201
    When I delete that supporter as "editor3.ticker.bdd@example.com"
    Then the ticker response status should be 200
    And the public ticker feed should not include "Gone Soon Ltd"

  Scenario: a Viewer cannot add a supporter
    Given a ticker admin "viewer.ticker.bdd@example.com" with role "viewer" and password "pw-view"
    When I add the supporter "Not Allowed Co" as "viewer.ticker.bdd@example.com"
    Then the ticker response status should be 403
