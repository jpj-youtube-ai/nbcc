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

  Scenario: an Editor renames a supporter and the public feed follows (TASK-262)
    Given a ticker admin "editor4.ticker.bdd@example.com" with role "editor" and password "pw-edit4"
    When I add the supporter "Ayrshire Bakry" as "editor4.ticker.bdd@example.com"
    Then the ticker response status should be 201
    When I rename that supporter to "Ayrshire Bakery Ltd" as "editor4.ticker.bdd@example.com"
    Then the ticker response status should be 200
    And the public ticker feed should include "Ayrshire Bakery Ltd"
    And the public ticker feed should not include "Ayrshire Bakry"

  Scenario: a Viewer cannot rename a supporter (TASK-262)
    Given a ticker admin "editor5.ticker.bdd@example.com" with role "editor" and password "pw-edit5"
    And a ticker admin "viewer2.ticker.bdd@example.com" with role "viewer" and password "pw-view2"
    When I add the supporter "Read Only Co" as "editor5.ticker.bdd@example.com"
    Then the ticker response status should be 201
    When I rename that supporter to "Renamed By Viewer" as "viewer2.ticker.bdd@example.com"
    Then the ticker response status should be 403

  Scenario: partners stay alphabetical however they were added (TASK-262)
    Given a ticker admin "editor6.ticker.bdd@example.com" with role "editor" and password "pw-edit6"
    When I add the supporter "Zzz Alphabetical Test" as "editor6.ticker.bdd@example.com"
    Then the ticker response status should be 201
    When I add the supporter "Aaa Alphabetical Test" as "editor6.ticker.bdd@example.com"
    Then the ticker response status should be 201
    # Zzz was added FIRST, so an insertion-ordered feed would put it first. Alphabetical must not.
    Then the public ticker feed should list "Aaa Alphabetical Test" before "Zzz Alphabetical Test"

  Scenario: a renamed partner re-sorts to its new position (TASK-262)
    Given a ticker admin "editor7.ticker.bdd@example.com" with role "editor" and password "pw-edit7"
    When I add the supporter "Mmm Rename Anchor" as "editor7.ticker.bdd@example.com"
    Then the ticker response status should be 201
    When I add the supporter "Aaa Rename Sorts" as "editor7.ticker.bdd@example.com"
    Then the ticker response status should be 201
    And the public ticker feed should list "Aaa Rename Sorts" before "Mmm Rename Anchor"
    # Renaming Aaa -> Zzy must move it PAST the anchor, proving order follows the name, not the id.
    When I rename that supporter to "Zzy Rename Sorts" as "editor7.ticker.bdd@example.com"
    Then the ticker response status should be 200
    And the public ticker feed should list "Mmm Rename Anchor" before "Zzy Rename Sorts"

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
