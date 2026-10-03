@fundraising @fundraising-in-memory @db
Feature: In memory pages (Jaimie, 2026-10-03)
  On the raising money path, a page can be in memory of someone, set up by the family, a friend or a
  funeral director, each with the family's permission. Staff check it before it goes live, as every
  page. The page is quieter: no countdown, and the target only if the family chose to show it. Every
  message a giver leaves waits for staff. A giver may ask to let the family know they gave; the
  organiser then sees their name, never the amount.

  Scenario: a friend signs up in memory of someone, staff approve it, and the page is quiet
    Given fundraising is switched on
    And a fundraising staff member "kim.memory.fr.bdd@example.com" with role "editor"
    When a friend signs up "In memory of Margaret Exampleton (bdd-fr)" in memory of "Margaret Exampleton", with the family's permission and a hidden target
    Then the fundraising answer is 200
    And the fundraiser "In memory of Margaret Exampleton (bdd-fr)" is stored in memory of "Margaret Exampleton", set up by "friend", with permission
    And the organiser of "In memory of Margaret Exampleton (bdd-fr)" was not sent a "fundraiseThanks" email
    When "kim.memory.fr.bdd@example.com" approves "In memory of Margaret Exampleton (bdd-fr)"
    Then the fundraising answer is 200
    And the organiser of "In memory of Margaret Exampleton (bdd-fr)" was sent the in memory email
    And the page for "In memory of Margaret Exampleton (bdd-fr)" says "In memory of Margaret Exampleton", with no countdown and no target

  Scenario: no page in memory of someone without the family's permission
    Given fundraising is switched on
    When a friend signs up "In memory of Jean Example (bdd-fr)" in memory of "Jean Example", without the family's permission
    Then the fundraising answer is 400
    And the fundraising answer names the field "memoryPermission"
    And no fundraiser called "In memory of Jean Example (bdd-fr)" is stored

  Scenario: a giver's message waits for staff, and the family sees who asked to let them know
    Given fundraising is switched on
    And a fundraising staff member "kim.memory2.fr.bdd@example.com" with role "editor"
    And an approved in memory page "In memory of Robin Example (bdd-fr)" organised by "family.memory.fr.bdd@example.com"
    When a supporter gives 2500 pence on the page for "In memory of Robin Example (bdd-fr)", paid as "pi_fr_bdd_memory_1"
    And the giver adds the message "Thinking of you all." to "In memory of Robin Example (bdd-fr)", asking to let the family know
    Then the fundraising answer is 200
    And the page for "In memory of Robin Example (bdd-fr)" does not show the message "Thinking of you all."
    When "kim.memory2.fr.bdd@example.com" approves the message on "In memory of Robin Example (bdd-fr)"
    Then the fundraising answer is 200
    And the page for "In memory of Robin Example (bdd-fr)" shows the message "Thinking of you all."
    Given the organiser of "In memory of Robin Example (bdd-fr)" is signed in to their private area
    When the signed in organiser opens their private area
    Then the private area shows "Alex Example" as asking to let the family know, with no amount

  Scenario: an admin corrects who an in memory page remembers, and the page's name follows
    Given fundraising is switched on
    And a fundraising staff member "ash.memory.fr.bdd@example.com" with role "admin"
    And an approved in memory page "In memory of Kit Example (bdd-fr)" remembering "Kit Example (bdd-fr)", organised by "kit.memory.fr.bdd@example.com"
    When "ash.memory.fr.bdd@example.com" corrects the in memory name of "In memory of Kit Example (bdd-fr)" to "Kit Ann Example (bdd-fr)"
    Then the fundraising answer is 200
    And the public page of that in memory page is called "In memory of Kit Ann Example (bdd-fr)" and remembers "Kit Ann Example (bdd-fr)"
