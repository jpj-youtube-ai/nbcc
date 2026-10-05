@admin @red-bag-list
Feature: Staff edit the Fill a Red Bag list, as a draft, and publish it
  The items, prices and examples on /fill can be changed in Admin > Fill a Red Bag. Changes go to
  one shared draft; nothing changes for the public until someone publishes. Every publish is kept,
  and any earlier list, or the original one written in the code, can be put back as a draft. The
  editor has an access section of its own: view to look, edit to change.

  Background:
    Given an admin user "ada.redbaglist.admin.bdd@example.com" with role "admin" and password "redbag-list-pw-1"
    And an admin user "vic.redbaglist.admin.bdd@example.com" with role "viewer" and password "redbag-list-pw-1"
    And an admin user "eve.redbaglist.admin.bdd@example.com" with role "editor" and password "redbag-list-pw-1"
    And "vic.redbaglist.admin.bdd@example.com" has "view" access to the Fill a Red Bag list and nothing else

  Scenario: with nothing published, the public page shows the built-in list
    When I read the Fill a Red Bag page
    Then the Fill a Red Bag page prices "toy" at 1500 pence
    And the Fill a Red Bag page has no draft strip

  Scenario: the editor needs a session, and the section
    When someone with no session reads the Fill a Red Bag list editor
    Then the Fill a Red Bag list answer is 401
    When "eve.redbaglist.admin.bdd@example.com" reads the Fill a Red Bag list editor
    Then the Fill a Red Bag list answer is 403

  Scenario: an admin saves a draft, and the public page is unchanged
    When "ada.redbaglist.admin.bdd@example.com" saves a draft pricing "toy" at 1200 pence
    Then the Fill a Red Bag list answer is 200
    And the Fill a Red Bag list editor says 1 change is waiting
    When I read the Fill a Red Bag page
    Then the Fill a Red Bag page prices "toy" at 1500 pence

  Scenario: publishing changes the public page's price, and is on the record
    Given "ada.redbaglist.admin.bdd@example.com" has saved a draft pricing "toy" at 1200 pence
    When "ada.redbaglist.admin.bdd@example.com" publishes the Fill a Red Bag draft
    Then the Fill a Red Bag list answer is 200
    And the Fill a Red Bag list history has 1 publish, the latest saying "Toy £15"
    And the audit log has a "red_bag.list_published" row by "admin:ada.redbaglist.admin.bdd@example.com"
    When I read the Fill a Red Bag page
    Then the Fill a Red Bag page prices "toy" at 1200 pence
    And the Fill a Red Bag page has no draft strip

  Scenario: someone with view access can look, and cannot save or publish
    Given "ada.redbaglist.admin.bdd@example.com" has saved a draft pricing "toy" at 1200 pence
    When "vic.redbaglist.admin.bdd@example.com" reads the Fill a Red Bag list editor
    Then the Fill a Red Bag list answer is 200
    And the Fill a Red Bag list editor says 1 change is waiting
    And the Fill a Red Bag list editor says this person may not change it
    When "vic.redbaglist.admin.bdd@example.com" saves a draft pricing "toy" at 900 pence
    Then the Fill a Red Bag list answer is 403
    When "vic.redbaglist.admin.bdd@example.com" publishes the Fill a Red Bag draft
    Then the Fill a Red Bag list answer is 403
    When I read the Fill a Red Bag page
    Then the Fill a Red Bag page prices "toy" at 1500 pence

  Scenario: a bad price is refused, in plain words
    When "ada.redbaglist.admin.bdd@example.com" saves a draft pricing "toy" at 5 pence
    Then the Fill a Red Bag list answer is 400
    And the Fill a Red Bag list answer says "A price must be between 10p and £500."
    When "ada.redbaglist.admin.bdd@example.com" reads the Fill a Red Bag list editor
    Then the Fill a Red Bag list editor has no draft

  Scenario: an item that is on the website can be hidden, but a draft that drops it is refused
    When "ada.redbaglist.admin.bdd@example.com" saves a draft without the item "socks"
    Then the Fill a Red Bag list answer is 400
    And the Fill a Red Bag list answer says "An item that is on the website can be hidden, not removed."
    When "ada.redbaglist.admin.bdd@example.com" reads the Fill a Red Bag list editor
    Then the Fill a Red Bag list editor has no draft

  Scenario: a save against a draft someone else has changed is refused, and theirs is kept
    Given "ada.redbaglist.admin.bdd@example.com" has saved a draft pricing "toy" at 1200 pence
    When "ada.redbaglist.admin.bdd@example.com" saves a draft pricing "toy" at 1100 pence against the stamp from before that save
    Then the Fill a Red Bag list answer is 409
    And the Fill a Red Bag list answer says "Someone else has changed the draft. Reload to see their changes."
    When "ada.redbaglist.admin.bdd@example.com" reads the Fill a Red Bag list editor
    Then the Fill a Red Bag draft prices "toy" at 1200 pence

  Scenario: throwing the draft away leaves the website alone
    Given "ada.redbaglist.admin.bdd@example.com" has saved a draft pricing "toy" at 1200 pence
    When "ada.redbaglist.admin.bdd@example.com" throws the Fill a Red Bag draft away
    Then the Fill a Red Bag list answer is 200
    And the Fill a Red Bag list editor has no draft
    And the audit log has a "red_bag.draft_thrown_away" row by "admin:ada.redbaglist.admin.bdd@example.com"

  Scenario: putting back the original list restores it
    Given "ada.redbaglist.admin.bdd@example.com" has saved a draft pricing "toy" at 1200 pence
    And "ada.redbaglist.admin.bdd@example.com" has published the Fill a Red Bag draft
    When "ada.redbaglist.admin.bdd@example.com" puts the original Fill a Red Bag list back as a draft
    Then the Fill a Red Bag list answer is 200
    And the Fill a Red Bag draft prices "toy" at 1500 pence
    # Still only a draft: the website has the published price until it is published.
    When I read the Fill a Red Bag page
    Then the Fill a Red Bag page prices "toy" at 1200 pence
    When "ada.redbaglist.admin.bdd@example.com" publishes the Fill a Red Bag draft
    And I read the Fill a Red Bag page
    Then the Fill a Red Bag page prices "toy" at 1500 pence
    And the Fill a Red Bag list history has 2 publishes, the latest saying "Toy £12"

  Scenario: the draft preview is for staff with the section, and never for a plain visit
    Given "ada.redbaglist.admin.bdd@example.com" has saved a draft pricing "toy" at 1200 pence
    When I read the Fill a Red Bag draft preview with no session
    Then the Fill a Red Bag page prices "toy" at 1500 pence
    And the Fill a Red Bag page has no draft strip
    And the Fill a Red Bag page is never cached and never indexed
    When "eve.redbaglist.admin.bdd@example.com" reads the Fill a Red Bag draft preview
    Then the Fill a Red Bag page prices "toy" at 1500 pence
    And the Fill a Red Bag page has no draft strip
    When "vic.redbaglist.admin.bdd@example.com" reads the Fill a Red Bag draft preview
    Then the Fill a Red Bag page prices "toy" at 1200 pence
    And the Fill a Red Bag page has the draft strip
    And the Fill a Red Bag page has giving switched off
    And the Fill a Red Bag page is never cached and never indexed

  # The migration writes the new section into access saved before it existed, the TASK-479 way:
  # admins get it, nobody else does, and nothing else in anyone's saved access is touched.
  Scenario Outline: access saved before the section existed gets it at the <role> role's own level
    Given a user "<email>" with role "<role>" whose saved access predates the four late sections
    When the Fill a Red Bag list permissions backfill runs
    Then the backfilled access of "<email>" gives "red-bag" as "<level>"
    And the backfilled access of "<email>" gives "stories" as "view"
    And the backfilled access of "<email>" gives "team" as "none"

    Examples:
      | role   | email                                   | level |
      | admin  | old.admin.redbaglist.admin.bdd@example.com  | edit  |
      | editor | old.editor.redbaglist.admin.bdd@example.com | none  |
      | viewer | old.viewer.redbaglist.admin.bdd@example.com | none  |

  Scenario: the backfill leaves people with no saved access on their role's defaults
    When the Fill a Red Bag list permissions backfill runs
    Then the backfilled access of "ada.redbaglist.admin.bdd@example.com" is still empty
