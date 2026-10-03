@fundraising @events @db
Feature: Team pages
  A sponsorship fundraiser can be a team. The person who sets it up is the team organiser. The
  people they add are held until staff approve the team, then invited. People join with a short
  form; staff approve every member page; gifts on a member page count on the member's meter and the
  team's. A whole team split is every member's, and members are not asked. The team page lists its
  members A to Z, never by money. Every name, team and address here is invented.

  Scenario: a team signs up with members, and approving it sends the invites
    Given fundraising is switched on
    And a fundraising staff member "a1.team.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Exampleton Juniors (bdd-fr)" adding "ava.team.fr.bdd@example.com" and "parent.team.fr.bdd@example.com"
    Then the fundraising answer is 200
    And "Exampleton Juniors (bdd-fr)" is stored as a team with 2 people held to invite
    And no "fundraiseTeamInvite" email went to "ava.team.fr.bdd@example.com"
    When "a1.team.fr.bdd@example.com" approves "Exampleton Juniors (bdd-fr)"
    Then a "fundraiseTeamInvite" email went to "ava.team.fr.bdd@example.com"
    And a "fundraiseTeamInvite" email went to "parent.team.fr.bdd@example.com"
    And the organiser of "Exampleton Juniors (bdd-fr)" was sent a "fundraiseTeamLive" email
    And every invite of "Exampleton Juniors (bdd-fr)" is sent

  Scenario: joining from an invite, staff approve the member, and gifts count on the member and the team
    Given fundraising is switched on
    And a fundraising staff member "a2.team.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Exampleton Dashers (bdd-fr)" adding "ava.team.fr.bdd@example.com" and "parent.team.fr.bdd@example.com"
    And "a2.team.fr.bdd@example.com" approves "Exampleton Dashers (bdd-fr)"
    And the invite to "parent.team.fr.bdd@example.com" on "Exampleton Dashers (bdd-fr)" is opened
    Then the join form is filled in with "Ava" and "parent.team.fr.bdd@example.com"
    When they join "Exampleton Dashers (bdd-fr)" from that invite as "Jack" "Sample", 18 or over
    Then the fundraising answer is 200
    And "Jack's page for Exampleton Dashers (bdd-fr)" is a member page of "Exampleton Dashers (bdd-fr)", waiting for staff
    And the invite to "parent.team.fr.bdd@example.com" on "Exampleton Dashers (bdd-fr)" is joined
    And a "fundraiseTeamJoinStaff" email went to the events inbox about "Exampleton Dashers (bdd-fr)"
    When "a2.team.fr.bdd@example.com" approves "Jack's page for Exampleton Dashers (bdd-fr)"
    And a supporter gives 2500 pence on the page for "Jack's page for Exampleton Dashers (bdd-fr)", paid as "pi_fr_bdd_team_1"
    And a supporter gives 1000 pence on the page for "Exampleton Dashers (bdd-fr)", paid as "pi_fr_bdd_team_2"
    And a visitor opens the page for "Jack's page for Exampleton Dashers (bdd-fr)"
    Then the page shows "£25"
    And the page shows "Part of the team"
    When a visitor opens the page for "Exampleton Dashers (bdd-fr)"
    Then the page shows "£35"
    And the page shows "Jack S."
    And the page shows "Join this team"

  Scenario: a whole team split is every member's, and members are not asked
    Given fundraising is switched on
    And a fundraising staff member "a3.team.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Exampleton Sharers (bdd-fr)" sharing 50 percent with "Exampleton Food Larder" for the whole team
    And "a3.team.fr.bdd@example.com" approves "Exampleton Sharers (bdd-fr)"
    And a visitor opens the join form for "Exampleton Sharers (bdd-fr)"
    Then the visitor gets status 200
    And the page shows "50% comes to NBCC and the rest goes to Exampleton Food Larder"
    When "Cal" "Example" joins "Exampleton Sharers (bdd-fr)", saying they are not sharing
    Then the fundraising answer is 200
    And "Cal's page for Exampleton Sharers (bdd-fr)" is stored as 18 or over, sharing 50 percent with "Exampleton Food Larder"

  Scenario: the team page lists its members A to Z, never by money
    Given fundraising is switched on
    And a fundraising staff member "a4.team.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Exampleton Racers (bdd-fr)" adding "ava.team.fr.bdd@example.com" and "parent.team.fr.bdd@example.com"
    And "a4.team.fr.bdd@example.com" approves "Exampleton Racers (bdd-fr)"
    And "Zara" "Sample" joins "Exampleton Racers (bdd-fr)"
    And "Ava" "Sample" joins "Exampleton Racers (bdd-fr)"
    And "Ben" "Sample" joins "Exampleton Racers (bdd-fr)"
    And "a4.team.fr.bdd@example.com" approves "Zara's page for Exampleton Racers (bdd-fr)"
    And "a4.team.fr.bdd@example.com" approves "Ava's page for Exampleton Racers (bdd-fr)"
    And "a4.team.fr.bdd@example.com" approves "Ben's page for Exampleton Racers (bdd-fr)"
    And a supporter gives 9000 pence on the page for "Zara's page for Exampleton Racers (bdd-fr)", paid as "pi_fr_bdd_team_3"
    And a visitor opens the page for "Exampleton Racers (bdd-fr)"
    Then the page lists "Ava S." before "Ben S."
    And the page lists "Ben S." before "Zara S."

  Scenario: someone under 18 cannot join, and nothing is stored
    Given fundraising is switched on
    And a fundraising staff member "a5.team.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Exampleton Youngsters (bdd-fr)" adding "ava.team.fr.bdd@example.com" and "parent.team.fr.bdd@example.com"
    And "a5.team.fr.bdd@example.com" approves "Exampleton Youngsters (bdd-fr)"
    And "Ella" "Sample" joins "Exampleton Youngsters (bdd-fr)", under 18
    Then the fundraising answer is 400
    And the fundraising answer names the field "over18"
    And no fundraiser called "Ella's page for Exampleton Youngsters (bdd-fr)" is stored

  Scenario: the daily pass deletes the names, emails and links of invites whose time is up
    Given fundraising is switched on
    And a fundraising staff member "a6.team.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Exampleton Rovers (bdd-fr)" adding "ava.team.fr.bdd@example.com" and "parent.team.fr.bdd@example.com"
    And "a6.team.fr.bdd@example.com" approves "Exampleton Rovers (bdd-fr)"
    Then a "fundraiseTeamInvite" email went to "ava.team.fr.bdd@example.com"
    When the invites of "Exampleton Rovers (bdd-fr)" were sent 31 days ago
    And the daily team pass runs
    Then every invite of "Exampleton Rovers (bdd-fr)" has had its names, email and links deleted
    And no email log row names "ava.team.fr.bdd@example.com"

  Scenario: a handover code tried wrongly 5 times stops working, even the right one
    Given fundraising is switched on
    And a fundraising staff member "a7.team.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Exampleton Hikers (bdd-fr)" adding "ava.team.fr.bdd@example.com" and "parent.team.fr.bdd@example.com"
    And "a7.team.fr.bdd@example.com" approves "Exampleton Hikers (bdd-fr)"
    And "a7.team.fr.bdd@example.com" hands "Exampleton Hikers (bdd-fr)" over to "sam.handover.fr.bdd@example.com"
    Then the fundraising answer is 200
    When "sam.handover.fr.bdd@example.com" puts in a wrong handover code 5 times
    And "sam.handover.fr.bdd@example.com" puts in the right handover code for "Exampleton Hikers (bdd-fr)"
    Then the fundraising answer is 401
    And the team organiser of "Exampleton Hikers (bdd-fr)" is still "robin.team.fr.bdd@example.com"

  Scenario: a team organiser cannot take someone off another team
    Given fundraising is switched on
    And a fundraising staff member "a8.team.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Exampleton Owls (bdd-fr)" adding "ava.team.fr.bdd@example.com" and "parent.team.fr.bdd@example.com"
    And "a8.team.fr.bdd@example.com" approves "Exampleton Owls (bdd-fr)"
    And "Zara" "Sample" joins "Exampleton Owls (bdd-fr)"
    And someone else signs up the team "Exampleton Larks (bdd-fr)"
    And "a8.team.fr.bdd@example.com" approves "Exampleton Larks (bdd-fr)"
    And the organiser of "Exampleton Larks (bdd-fr)" is signed in to their private area
    And the signed in team organiser of "Exampleton Larks (bdd-fr)" takes "Zara's page for Exampleton Owls (bdd-fr)" off their team
    Then the fundraising answer is 404
    And the signed in team organiser tries the same on "Exampleton Owls (bdd-fr)"
    Then the fundraising answer is 404
    And "Zara's page for Exampleton Owls (bdd-fr)" is still on "Exampleton Owls (bdd-fr)"
