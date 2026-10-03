@fundraising @impact @db
Feature: What gifts could do: examples on fundraiser pages, set in the admin
  One shared list of "could" examples, like "£25 could help buy a pair of school shoes". Admins add
  them in Admin > Fundraising, and every fundraiser, event and team page shows them under the give
  amounts and the meter. The words always start with could, and never promise (will buy, buys). Every name
  and address here is invented.

  Scenario: an admin adds an example, and a fundraiser's page shows it under its amount
    Given fundraising is switched on
    And a fundraising staff member "a1.impact.fr.bdd@example.com" with role "admin"
    And an approved fundraiser "Sam's Sponsored Swim (bdd-fr)" raising 50000 pence
    When "a1.impact.fr.bdd@example.com" adds the impact example of 2000 pence "could help buy a warm winter hat and scarf"
    Then the impact example answer is 201
    And the page of "Sam's Sponsored Swim (bdd-fr)" shows "could help buy a warm winter hat and scarf" under its give amounts
    And the page of "Sam's Sponsored Swim (bdd-fr)" shows the footnote "These show what gifts could do. Every gift goes where it's needed most."
    And adding the impact example is in audit_log by "admin:a1.impact.fr.bdd@example.com"

  Scenario: words that do not start with could, or that promise, are refused
    Given a fundraising staff member "a2.impact.fr.bdd@example.com" with role "admin"
    When "a2.impact.fr.bdd@example.com" adds the impact example of 2000 pence "a warm winter hat and scarf could help"
    Then the impact example answer is 400
    And there is no impact example saying "a warm winter hat and scarf could help"
    When "a2.impact.fr.bdd@example.com" adds the impact example of 2000 pence "will buy a hat, and it could be warm"
    Then the impact example answer is 400
    And there is no impact example saying "will buy a hat, and it could be warm"

  Scenario: only an admin may add an example
    Given a fundraising staff member "e1.impact.fr.bdd@example.com" with role "editor"
    When "e1.impact.fr.bdd@example.com" adds the impact example of 2000 pence "could help buy a warm winter hat and scarf"
    Then the impact example answer is 403
    And there is no impact example saying "could help buy a warm winter hat and scarf"
