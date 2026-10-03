@fundraising @categories @events @db
Feature: Fundraising categories: one each, A to Z, and staff can add more
  The sign up form asks what someone is doing, or what kind of event it is, from a list of categories
  that each name one thing, shown A to Z with Other last. Admins can add a category in
  Admin > Fundraising, and it is on the form at once, in its place. The old "this or that"
  categories are no longer offered, but the sign ups that chose one keep it, and its name. Every
  name and address here is invented.

  Scenario: an admin adds a category, the form offers it A to Z, and a sign up uses it
    Given fundraising is switched on
    And a fundraising staff member "a1.cat.fr.bdd@example.com" with role "admin"
    When "a1.cat.fr.bdd@example.com" adds the fundraising category "Sponsored silence"
    Then the category answer is 201
    And the sign up form offers its categories A to Z, with Other last
    And the sign up form offers "Sponsored silence" between "School collection" and "Walk"
    And adding the category "Sponsored silence" is in audit_log by "admin:a1.cat.fr.bdd@example.com"
    When someone signs up "Sam's Silent Day (bdd-fr)" in the category "Sponsored silence"
    Then the fundraising answer is 200
    And the fundraiser "Sam's Silent Day (bdd-fr)" is stored in the category "Sponsored silence"

  Scenario: only an admin may add a category
    Given a fundraising staff member "e1.cat.fr.bdd@example.com" with role "editor"
    When "e1.cat.fr.bdd@example.com" adds the fundraising category "Sponsored silence"
    Then the category answer is 403
    And there is no fundraising category "Sponsored silence"

  Scenario: an old category is not offered, but a sign up that chose one keeps its name
    Given fundraising is switched on
    And an approved fundraiser "Robin's Walk (bdd-fr)" raising 50000 pence
    Then the sign up form does not offer "Run or walk"
    When someone signs up "Sam's Silent Day (bdd-fr)" in the old category "run_walk"
    Then the fundraising answer is 400
    And Get involved names the category of "Robin's Walk (bdd-fr)" as "Run or walk"

  Scenario: an admin hides a category from the form, and puts it back
    Given fundraising is switched on
    And a fundraising staff member "a2.cat.fr.bdd@example.com" with role "admin"
    When "a2.cat.fr.bdd@example.com" hides the fundraising category "Party"
    Then the category answer is 200
    And the sign up form does not offer "Party"
    When "a2.cat.fr.bdd@example.com" puts the fundraising category "Party" back
    Then the sign up form offers "Party" between "Coffee morning" and "Quiz"
