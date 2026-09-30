@admin @whats-new
Feature: New pills in the admin are per person (TASK-478)
  Each member of staff sees a New pill on a section that holds something they have not seen yet.
  Opening the section clears it for them, and for nobody else.

  Background:
    Given an admin user "ann.whatsnew.admin.bdd@example.com" with role "admin" and password "whatsnew-pw-123"
    And an admin user "bob.whatsnew.admin.bdd@example.com" with role "admin" and password "whatsnew-pw-123"

  Scenario: One person opening the Newsletter clears its pill for them alone
    When someone signs up for the newsletter on the website
    Then "newsletter" is new to "ann.whatsnew.admin.bdd@example.com"
    And "newsletter" is new to "bob.whatsnew.admin.bdd@example.com"
    When "ann.whatsnew.admin.bdd@example.com" opens "newsletter"
    Then "newsletter" is not new to "ann.whatsnew.admin.bdd@example.com"
    But "newsletter" is new to "bob.whatsnew.admin.bdd@example.com"

  Scenario: Nothing new means no pill
    Then "newsletter" is not new to "ann.whatsnew.admin.bdd@example.com"

  Scenario: A section someone cannot open is never offered to them
    Given an admin user "cat.whatsnew.admin.bdd@example.com" with role "viewer" and password "whatsnew-pw-123"
    Then "fulfilments" is not listed for "cat.whatsnew.admin.bdd@example.com"
    When "cat.whatsnew.admin.bdd@example.com" opens "fulfilments"
    Then the answer is 403
