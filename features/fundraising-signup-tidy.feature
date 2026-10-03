@fundraising @db
Feature: The sign up tidy: the welcome pack, sport and the T-shirt, the split check, and each path
  Every new sign up gives an address for the welcome pack. Someone raising money says whether it is
  a sporting event: a Yes offers the sporting categories and asks a T-shirt size. Someone sharing
  with another cause ticks to say the split is right. A page in memory of someone is asked only what
  fits it: no welcome pack, no sport, and its own ways of giving. "No, only people you send the link
  to" still gets a page, kept off Get involved. Every name here is invented.

  Scenario: the address is needed on a new sign up
    Given fundraising is switched on
    When someone signs up "Addressless Walk (bdd-fr)" without an address
    Then the fundraising answer is 400
    And the fundraising answer names the field "postLine1"
    And the fundraising answer names the field "postTown"
    And the fundraising answer names the field "postPostcode"
    And no fundraiser called "Addressless Walk (bdd-fr)" is stored

  Scenario: a sporting event sees the sporting categories, and needs a T-shirt size
    Given fundraising is switched on
    When a visitor opens "/fundraise"
    Then the visitor gets status 200
    And the sign up form marks "walk" as a sporting category
    And the sign up form does not mark "quiz" as a sporting category
    And the page shows "Is it a sporting event?"
    When someone signs up the sporting event "Sam's Sporty Walk (bdd-fr)" with no T-shirt size
    Then the fundraising answer is 400
    And the fundraising answer names the field "tshirtSize"
    When someone signs up the sporting event "Sam's Sporty Walk (bdd-fr)" with the T-shirt size "adult_m"
    Then the fundraising answer is 200
    And "Sam's Sporty Walk (bdd-fr)" is stored as a sporting event with the T-shirt size "adult_m"
    And "Sam's Sporty Walk (bdd-fr)" is stored with the address "1 Example Road" "Exampleton" "EX1 1EX"

  Scenario: sharing with another cause needs the tick that the split is right
    Given fundraising is switched on
    When someone signs up "Unticked Shared Walk (bdd-fr)" sharing 50 percent with "Exampleton Food Bank" without the tick
    Then the fundraising answer is 400
    And the fundraising answer names the field "splitConfirmed"
    And no fundraiser called "Unticked Shared Walk (bdd-fr)" is stored

  Scenario: an admin ticks Sporting on a category, and the form offers it for a sporting event
    Given fundraising is switched on
    And a fundraising staff member "a1.tidy.fr.bdd@example.com" with role "admin"
    And a fundraising staff member "e1.tidy.fr.bdd@example.com" with role "editor"
    When "e1.tidy.fr.bdd@example.com" marks the category "quiz" as sporting
    Then the fundraising answer is 403
    When "a1.tidy.fr.bdd@example.com" marks the category "quiz" as sporting
    Then the fundraising answer is 200
    When a visitor opens "/fundraise"
    Then the sign up form marks "quiz" as a sporting category
    And "a1.tidy.fr.bdd@example.com" puts the category "quiz" back as not sporting

  Scenario: staff correct sport and the size, and the organiser chooses a size from their private link
    Given fundraising is switched on
    And a fundraising staff member "e2.tidy.fr.bdd@example.com" with role "editor"
    When someone signs up "Kim's Quiet Quiz (bdd-fr)"
    Then the fundraising answer is 200
    When "e2.tidy.fr.bdd@example.com" sets "Kim's Quiet Quiz (bdd-fr)" as a sporting event with no T-shirt size
    Then the fundraising answer is 200
    And "Kim's Quiet Quiz (bdd-fr)" is waiting for a T-shirt size
    Given a T-shirt link for "Kim's Quiet Quiz (bdd-fr)" whose token we know
    When the organiser opens that T-shirt link
    Then the fundraising answer is 200
    When the organiser chooses the T-shirt size "kids_9_10" with that link
    Then the fundraising answer is 200
    And "Kim's Quiet Quiz (bdd-fr)" is stored as a sporting event with the T-shirt size "kids_9_10"
    When the organiser chooses the T-shirt size "adult_l" with that link
    Then the fundraising answer is 404

  Scenario: a page in memory of someone needs no address, sport or shout out, and has its own ways of giving
    Given fundraising is switched on
    When a family member signs up a page in memory of "Margaret Exampleton (bdd-fr)" by "Donations instead of flowers"
    Then the fundraising answer is 200
    And "In memory of Margaret Exampleton (bdd-fr)" is stored in memory with no sport, no T-shirt and no address
    When someone signs up "Flowers Walk (bdd-fr)" in the in memory way of giving "memory_flowers"
    Then the fundraising answer is 400
    And the fundraising answer names the field "kind"

  Scenario: only people with the link still get a page, kept off Get involved
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a3.tidy.fr.bdd@example.com" with role "admin"
    When someone signs up "Link Only Walk (bdd-fr)" for only people with the link
    Then the fundraising answer is 200
    When "a3.tidy.fr.bdd@example.com" approves "Link Only Walk (bdd-fr)"
    And a visitor opens the page for "Link Only Walk (bdd-fr)"
    Then the visitor gets status 200
    When a visitor opens "/get-involved"
    Then the page does not show "Link Only Walk (bdd-fr)"

  Scenario: an event's date may be not decided yet, but only with the tick
    Given fundraising is switched on
    When someone signs up the event "Undated Quiz (bdd-fr)" with no date
    Then the fundraising answer is 400
    And the fundraising answer names the field "eventDate"
    When someone signs up the event "Undated Quiz (bdd-fr)" with the date not decided yet
    Then the fundraising answer is 200
    And "Undated Quiz (bdd-fr)" is stored with its date to be confirmed

  Scenario: joining a team for someone under 18 needs their parent or guardian
    Given fundraising is switched on
    And a fundraising staff member "a6.tidy.fr.bdd@example.com" with role "admin"
    When someone signs up the team "Exampleton Tidy Juniors (bdd-fr)" adding "ava.tidyjoin.fr.bdd@example.com" and "ben.tidyjoin.fr.bdd@example.com"
    And "a6.tidy.fr.bdd@example.com" approves "Exampleton Tidy Juniors (bdd-fr)"
    And a parent joins "Exampleton Tidy Juniors (bdd-fr)" for "Jack" "Sample", under 18, without their own name
    Then the fundraising answer is 400
    And the fundraising answer names the field "guardianFirstName"
    And the fundraising answer names the field "guardianConsent"
    When the parent "Sarah" joins "Exampleton Tidy Juniors (bdd-fr)" for "Jack" "Sample", under 18
    Then the fundraising answer is 200
    And "Jack's page for Exampleton Tidy Juniors (bdd-fr)" is stored for someone under 18, with the parent "Sarah"
