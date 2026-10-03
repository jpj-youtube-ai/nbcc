@fundraising @db
Feature: Profile pictures: the organiser's own photos, checked by staff
  From their private area an organiser sends the main photo for their page and a small round photo of
  themselves, shown beside their name. Every photo waits for staff: until it is approved it has no
  public address, and the page goes on showing what staff last approved. The server makes each photo
  again before it is stored, so nothing from the camera is kept. On a team page every member and the
  team organiser show their round photo once approved, and the NBCC elf until then. Every name, team
  and address here is invented.

  Scenario: an organiser sends a round photo; it is not public until staff approve it, then it shows
    Given fundraising is switched on
    And a fundraising staff member "pics.staff.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Robins Photo Walk (bdd-fr)" raising 50000 pence, organised by "robin.pics.fr.bdd@example.com"
    And the organiser of "Robins Photo Walk (bdd-fr)" is signed in to their private area
    When the signed in organiser sends a round photo for "Robins Photo Walk (bdd-fr)"
    Then the fundraising answer is 202
    And the private area says the round photo on "Robins Photo Walk (bdd-fr)" is "Waiting for us to check"
    And the round photo of "Robins Photo Walk (bdd-fr)" is stored without anything from the camera
    And the round photo of "Robins Photo Walk (bdd-fr)" is not served to the public
    When a visitor opens the page for "Robins Photo Walk (bdd-fr)"
    Then the page does not show "fr-avatar"
    When "pics.staff.fr.bdd@example.com" approves the round photo on "Robins Photo Walk (bdd-fr)"
    Then the fundraising answer is 200
    And the history of "Robins Photo Walk (bdd-fr)" records "fundraiser.picture_approved" by "pics.staff.fr.bdd@example.com"
    And the private area says the round photo on "Robins Photo Walk (bdd-fr)" is "On your page"
    And the round photo of "Robins Photo Walk (bdd-fr)" is served to the public
    When a visitor opens the page for "Robins Photo Walk (bdd-fr)"
    Then the page shows the round photo of "Robins Photo Walk (bdd-fr)"
    And the page shows "A photo of Robin T."

  Scenario: an approved main photo becomes the photo at the top of the page
    Given fundraising is switched on
    And a fundraising staff member "main.staff.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Sams Main Photo Swim (bdd-fr)" raising 50000 pence, organised by "sam.main.fr.bdd@example.com"
    And the organiser of "Sams Main Photo Swim (bdd-fr)" is signed in to their private area
    When the signed in organiser sends a main photo for "Sams Main Photo Swim (bdd-fr)"
    Then the fundraising answer is 202
    When a visitor opens the page for "Sams Main Photo Swim (bdd-fr)"
    Then the page has no main photo
    When "main.staff.fr.bdd@example.com" approves the main photo on "Sams Main Photo Swim (bdd-fr)"
    And a visitor opens the page for "Sams Main Photo Swim (bdd-fr)"
    Then the page has the main photo staff approved for "Sams Main Photo Swim (bdd-fr)"

  Scenario: a photo staff do not use never shows, and the organiser sees our note
    Given fundraising is switched on
    And a fundraising staff member "decline.staff.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Kims Bake Off (bdd-fr)" raising 50000 pence, organised by "kim.pics.fr.bdd@example.com"
    And the organiser of "Kims Bake Off (bdd-fr)" is signed in to their private area
    When the signed in organiser sends a round photo for "Kims Bake Off (bdd-fr)"
    And "decline.staff.fr.bdd@example.com" does not use the round photo on "Kims Bake Off (bdd-fr)", saying "Could you send one with just you in it?"
    Then the private area says the round photo on "Kims Bake Off (bdd-fr)" is "Not used"
    And the private area shows the note "Could you send one with just you in it?" on "Kims Bake Off (bdd-fr)"
    And the round photo of "Kims Bake Off (bdd-fr)" is not served to the public

  Scenario: a team page shows each round photo once approved, and the NBCC elf until then
    Given fundraising is switched on
    And a fundraising staff member "team.pics.fr.bdd@example.com" with role "admin"
    When the team "Exampleton Snappers (bdd-fr)" signs up with nobody added, organised by "robin.snappers.fr.bdd@example.com"
    And "team.pics.fr.bdd@example.com" approves "Exampleton Snappers (bdd-fr)"
    And "Ava" "Sample" joins "Exampleton Snappers (bdd-fr)"
    And "team.pics.fr.bdd@example.com" approves "Ava's page for Exampleton Snappers (bdd-fr)"
    And a visitor opens the page for "Exampleton Snappers (bdd-fr)"
    Then the page shows "Team organiser: Robin O."
    And the page shows "fr-avatar--elf"
    And the page does not show "/media/fundraiser-profile/"
    Given the organiser of "Ava's page for Exampleton Snappers (bdd-fr)" is signed in to their private area
    When the signed in organiser sends a round photo for "Ava's page for Exampleton Snappers (bdd-fr)"
    And "team.pics.fr.bdd@example.com" approves the round photo on "Ava's page for Exampleton Snappers (bdd-fr)"
    And a visitor opens the page for "Exampleton Snappers (bdd-fr)"
    Then the page shows the round photo of "Ava's page for Exampleton Snappers (bdd-fr)"
    And the page shows "A photo of Ava S."
    And the page shows "fr-avatar--elf"

  Scenario: a round photo staff take off the page stops being served
    Given fundraising is switched on
    And a fundraising staff member "off.staff.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Lees Round Off (bdd-fr)" raising 50000 pence, organised by "lee.off.fr.bdd@example.com"
    And the organiser of "Lees Round Off (bdd-fr)" is signed in to their private area
    When the signed in organiser sends a round photo for "Lees Round Off (bdd-fr)"
    And "off.staff.fr.bdd@example.com" approves the round photo on "Lees Round Off (bdd-fr)"
    Then the round photo of "Lees Round Off (bdd-fr)" is served to the public
    When "off.staff.fr.bdd@example.com" takes the round photo on "Lees Round Off (bdd-fr)" off the page
    Then the round photo of "Lees Round Off (bdd-fr)" is not served to the public
    And the private area says the round photo on "Lees Round Off (bdd-fr)" is "Taken off your page"
    When a visitor opens the page for "Lees Round Off (bdd-fr)"
    Then the page does not show "/media/fundraiser-profile/"

  Scenario: a main photo staff take off the page stops being served
    Given fundraising is switched on
    And a fundraising staff member "mainoff.staff.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Pats Main Off (bdd-fr)" raising 50000 pence, organised by "pat.off.fr.bdd@example.com"
    And the organiser of "Pats Main Off (bdd-fr)" is signed in to their private area
    When the signed in organiser sends a main photo for "Pats Main Off (bdd-fr)"
    And "mainoff.staff.fr.bdd@example.com" approves the main photo on "Pats Main Off (bdd-fr)"
    And a visitor opens the page for "Pats Main Off (bdd-fr)"
    Then the page has the main photo staff approved for "Pats Main Off (bdd-fr)"
    When "mainoff.staff.fr.bdd@example.com" takes the main photo on "Pats Main Off (bdd-fr)" off the page
    Then the first approved main photo of "Pats Main Off (bdd-fr)" is not served to the public
    When a visitor opens the page for "Pats Main Off (bdd-fr)"
    Then the page has no main photo

  Scenario: replacing a main photo stops the old one being served
    Given fundraising is switched on
    And a fundraising staff member "swap.staff.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Alis Photo Swap (bdd-fr)" raising 50000 pence, organised by "ali.swap.fr.bdd@example.com"
    And the organiser of "Alis Photo Swap (bdd-fr)" is signed in to their private area
    When the signed in organiser sends a main photo for "Alis Photo Swap (bdd-fr)"
    And "swap.staff.fr.bdd@example.com" approves the main photo on "Alis Photo Swap (bdd-fr)"
    And the signed in organiser sends a main photo for "Alis Photo Swap (bdd-fr)"
    And "swap.staff.fr.bdd@example.com" approves the main photo on "Alis Photo Swap (bdd-fr)"
    Then the first approved main photo of "Alis Photo Swap (bdd-fr)" is not served to the public
    When a visitor opens the page for "Alis Photo Swap (bdd-fr)"
    Then the page has the main photo staff approved for "Alis Photo Swap (bdd-fr)"
