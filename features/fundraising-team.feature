@fundraising @fundraising-team @db
Feature: The fundraising team's tools (TASK-503)
  Staff invite someone they have spoken to: the invite's link fills in the sign up form with their
  first name, surname and email, and the sign up made from it marks the invite used, so the link
  works once. Staff
  record the calls a week before and a week after a fundraiser's date, and take a fundraiser off
  Get involved when it is done, without stopping its page. Only admins choose who gets the Monday
  summary. Every name and address here is invented.

  Scenario: an invite fills in the form, and the sign up made from it uses it up
    Given fundraising is switched on
    And a fundraising staff member "a1.team.fr.bdd@example.com" with role "editor"
    When "a1.team.fr.bdd@example.com" invites first name "Alex Ann" and surname "Example" at "alex.team.fr.bdd@example.com", signed by themselves
    Then the fundraising answer is 201
    And a "fundraiseInvite" email went to "alex.team.fr.bdd@example.com"
    And the invite to "alex.team.fr.bdd@example.com" is kept with a hash of its link, not the link
    And the invite to "alex.team.fr.bdd@example.com" keeps the first name "Alex Ann" and the surname "Example"
    Given an invite to "Sky Sample" at "sky.team.fr.bdd@example.com" whose link we know
    When the sign up form asks for that invite
    Then the fundraising answer is 200
    And the form is given first name "Sky", surname "Sample" and "sky.team.fr.bdd@example.com", and nothing else
    When someone signs up "Sky's Bake Sale (bdd-fr)" from that invite
    Then the fundraising answer is 200
    And the invite to "sky.team.fr.bdd@example.com" is used by "Sky's Bake Sale (bdd-fr)"
    When the sign up form asks for that invite
    Then the fundraising answer is 404

  Scenario: an invite fills in the first name and surname exactly as staff typed them
    Given fundraising is switched on
    And an invite to first name "Morag Ann" and surname "Fyfe Brown" at "morag.team.fr.bdd@example.com" whose link we know
    When the sign up form asks for that invite
    Then the fundraising answer is 200
    And the form is given first name "Morag Ann", surname "Fyfe Brown" and "morag.team.fr.bdd@example.com", and nothing else

  Scenario: taking a fundraiser off Get involved keeps its page working
    Given fundraising is switched on
    And a fundraising staff member "e2.team.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Robin's Long Walk (bdd-fr)" raising 50000 pence
    Then Get involved lists "Robin's Long Walk (bdd-fr)"
    When "e2.team.fr.bdd@example.com" takes "Robin's Long Walk (bdd-fr)" off Get involved
    Then the fundraising answer is 200
    And Get involved does not list "Robin's Long Walk (bdd-fr)"
    And the page for "Robin's Long Walk (bdd-fr)" shows 0 pence raised of 50000
    And the history of "Robin's Long Walk (bdd-fr)" records "fundraiser.taken_off_list"
    When "e2.team.fr.bdd@example.com" puts "Robin's Long Walk (bdd-fr)" back on Get involved
    Then Get involved lists "Robin's Long Walk (bdd-fr)"

  Scenario: a call is recorded by an editor, never by a viewer
    Given a fundraising staff member "e3.team.fr.bdd@example.com" with role "editor"
    And a fundraising staff member "v3.team.fr.bdd@example.com" with role "viewer"
    And an approved fundraiser "Jo's Quiz Night (bdd-fr)" dated "2026-12-06"
    When "v3.team.fr.bdd@example.com" records the call before "Jo's Quiz Night (bdd-fr)"
    Then the fundraising answer is 403
    When "e3.team.fr.bdd@example.com" records the call before "Jo's Quiz Night (bdd-fr)"
    Then the fundraising answer is 200
    And the history of "Jo's Quiz Night (bdd-fr)" records "fundraiser.called"

  Scenario: only an admin chooses who gets the Monday summary
    Given a fundraising staff member "a4.team.fr.bdd@example.com" with role "admin"
    And a fundraising staff member "e4.team.fr.bdd@example.com" with role "editor"
    When "e4.team.fr.bdd@example.com" sets the Monday summary to go to "e4.team.fr.bdd@example.com"
    Then the fundraising answer is 403
    When "a4.team.fr.bdd@example.com" sets the Monday summary to go to "a4.team.fr.bdd@example.com"
    Then the fundraising answer is 200
    When "a4.team.fr.bdd@example.com" sends a test of the Monday summary
    Then the fundraising answer is 200
    And a "fundraiseSummary" email went to "a4.team.fr.bdd@example.com"
