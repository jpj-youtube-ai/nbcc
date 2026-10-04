@fundraising @fundraising-touch @email-wording @db
Feature: A new team member, and the team organiser is told (Jaimie, 2026-10-04)
  When staff approve a new team member's page, the team organiser gets an email, "[First name] has
  joined [team name]", so "you get the team's emails" is true. Its wording is new, so it is held
  until an admin approves it in Admin > Fundraising > Automatic emails (key "team_joined"), and it
  is an automatic email, so it also waits for the Automatic emails switch. While it is held nothing
  is sent and nothing is logged. Every name, team and address here is invented.

  Scenario: it is held until an admin approves its wording, then goes to the team organiser
    Given fundraising is switched on
    And the automatic emails are switched on
    And a fundraising staff member "a1.wording.fr.bdd@example.com" with role "admin"
    And a fundraising staff member "e1.wording.fr.bdd@example.com" with role "editor"
    When "organiser1.wording.fr.bdd@example.com" signs up the wording team "Wording Wanderers (bdd-fr)"
    And "a1.wording.fr.bdd@example.com" approves "Wording Wanderers (bdd-fr)"
    And "Ava" joins the wording team "Wording Wanderers (bdd-fr)" as "ava1.wording.fr.bdd@example.com"
    And "a1.wording.fr.bdd@example.com" approves "Ava's page for Wording Wanderers (bdd-fr)"
    Then no "fundraiseTeamMemberJoined" email went to "organiser1.wording.fr.bdd@example.com"
    When "e1.wording.fr.bdd@example.com" reads the "team_joined" automatic email
    Then the fundraising answer is 200
    And the automatic email's subject is "Alex has joined Team Tinsel"
    When "e1.wording.fr.bdd@example.com" approves the "team_joined" automatic email wording
    Then the fundraising answer is 403
    When "a1.wording.fr.bdd@example.com" approves the "team_joined" automatic email wording
    Then the fundraising answer is 200
    And the "team_joined" automatic email wording is approved by "a1.wording.fr.bdd@example.com"
    When "Ben" joins the wording team "Wording Wanderers (bdd-fr)" as "ben1.wording.fr.bdd@example.com"
    And "a1.wording.fr.bdd@example.com" approves "Ben's page for Wording Wanderers (bdd-fr)"
    Then a "fundraiseTeamMemberJoined" email with the subject "Ben has joined Wording Wanderers (bdd-fr)" went to "organiser1.wording.fr.bdd@example.com"
    And exactly 1 "fundraiseTeamMemberJoined" email went to "organiser1.wording.fr.bdd@example.com"
    And no "fundraiseTeamMemberJoined" email went to "ben1.wording.fr.bdd@example.com"

  Scenario: approved, it still waits while the automatic emails are switched off
    Given fundraising is switched on
    And the automatic emails are switched on
    And a fundraising staff member "a2.wording.fr.bdd@example.com" with role "admin"
    When "organiser2.wording.fr.bdd@example.com" signs up the wording team "Wording Walkers (bdd-fr)"
    And "a2.wording.fr.bdd@example.com" approves "Wording Walkers (bdd-fr)"
    And "a2.wording.fr.bdd@example.com" approves the "team_joined" automatic email wording
    And the automatic emails are switched off
    And "Cal" joins the wording team "Wording Walkers (bdd-fr)" as "cal2.wording.fr.bdd@example.com"
    And "a2.wording.fr.bdd@example.com" approves "Cal's page for Wording Walkers (bdd-fr)"
    Then no "fundraiseTeamMemberJoined" email went to "organiser2.wording.fr.bdd@example.com"
