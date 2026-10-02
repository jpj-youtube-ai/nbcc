@fundraising @db
Feature: Fundraiser pages: countdown, on the day, and news updates (TASK-506)
  A raising money fundraiser's page counts down to its date ("12 days to go"), and on the day wishes
  its organiser luck with the share links. The organiser can post a short news update, with a photo
  if they like, from their private area. Every update waits for staff: only once approved does it
  show on the page, newest first, and until then its photo has no public address at all.

  Scenario: an organiser posts an update, staff approve it, and it appears on the page
    Given fundraising is switched on
    And a fundraising staff member "news.staff.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Robins News Walk (bdd-fr)" raising 50000 pence, organised by "robin.news.fr.bdd@example.com"
    And the organiser of "Robins News Walk (bdd-fr)" is signed in to their private area
    When the signed in organiser posts the news update "Halfway round and still smiling (bdd-fr)" to "Robins News Walk (bdd-fr)"
    Then the fundraising answer is 202
    And the private area says the news update on "Robins News Walk (bdd-fr)" is "Waiting for us to check"
    When a visitor opens the page for "Robins News Walk (bdd-fr)"
    Then the page does not show "Halfway round and still smiling (bdd-fr)"
    When "news.staff.fr.bdd@example.com" approves the news update on "Robins News Walk (bdd-fr)"
    Then the fundraising answer is 200
    And the organiser of "Robins News Walk (bdd-fr)" is soon sent a "fundraiseNewsApproved" email
    And the history of "Robins News Walk (bdd-fr)" records "fundraiser.news_approved" by "news.staff.fr.bdd@example.com"
    And the private area says the news update on "Robins News Walk (bdd-fr)" is "On your page"
    When a visitor opens the page for "Robins News Walk (bdd-fr)"
    Then the page shows "Halfway round and still smiling (bdd-fr)"
    And the page shows "fr-news"

  Scenario: a waiting photo is never public; only its organiser sees it until staff approve
    Given fundraising is switched on
    And a fundraising staff member "photo.staff.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Sams Photo Swim (bdd-fr)" raising 50000 pence, organised by "sam.photo.fr.bdd@example.com"
    And the organiser of "Sams Photo Swim (bdd-fr)" is signed in to their private area
    When the signed in organiser posts the news update "Look at us all (bdd-fr)" with a photo to "Sams Photo Swim (bdd-fr)"
    Then the fundraising answer is 202
    And the photo of the news update on "Sams Photo Swim (bdd-fr)" is not served to the public
    And the signed in organiser can see the photo of the news update on "Sams Photo Swim (bdd-fr)"
    When "photo.staff.fr.bdd@example.com" approves the news update on "Sams Photo Swim (bdd-fr)"
    Then the photo of the news update on "Sams Photo Swim (bdd-fr)" is served to the public

  Scenario: a sixth update in a day is refused
    Given fundraising is switched on
    And an approved fundraiser "Busy Bake Sale (bdd-fr)" raising 50000 pence, organised by "busy.news.fr.bdd@example.com"
    And the organiser of "Busy Bake Sale (bdd-fr)" is signed in to their private area
    When the signed in organiser posts 5 news updates to "Busy Bake Sale (bdd-fr)"
    And the signed in organiser posts the news update "One more (bdd-fr)" to "Busy Bake Sale (bdd-fr)"
    Then the fundraising answer is 429

  Scenario: the page counts down to its date, and wishes its organiser luck on the day
    Given fundraising is switched on
    And an approved fundraiser "Countdown Dash (bdd-fr)" raising 50000 pence
    And "Countdown Dash (bdd-fr)" is dated 12 days from today
    When a visitor opens the page for "Countdown Dash (bdd-fr)"
    Then the page shows "12</span> days to go"
    Given "Countdown Dash (bdd-fr)" is dated 0 days from today
    When a visitor opens the page for "Countdown Dash (bdd-fr)"
    Then the page shows "Today's the day! Good luck, Robin!"
    And the page does not show "days to go"
