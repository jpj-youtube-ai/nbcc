@elf-school @admin @elf-doors
Feature: Head Elf HQ, Doors: setting up the 24 doors
  A head elf types in each door's place and prize, names its elf, pastes in every clue at once and sees what
  each door still needs. Once a door's clue 1 is out its evening is fixed. Design:
  docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md. Every place, prize and person here is invented.

  Background:
    Given an admin user "boss.doors.admin.bdd@example.com" with role "editor" and password "Elf-Doors-Editor-1"
    And "boss.doors.admin.bdd@example.com" has "edit" access to the Elf Detective School in the admin
    And an admin user "look.doors.admin.bdd@example.com" with role "editor" and password "Elf-Doors-Viewer-1"
    And "look.doors.admin.bdd@example.com" has "view" access to the Elf Detective School in the admin
    And "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" has opened the doors list

  Scenario: The head elf sees 24 doors
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends GET to "/api/admin/elf/doors"
    Then the doors answer is 200
    And the doors answer has 24 doors
    And the doors answer can be edited by this head elf

  Scenario: Typing in a place and a prize shows on the door's tile
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends PATCH to "/api/admin/elf/doors/7" with:
      """
      { "placeName": "Pine Cone Cafe", "placeTown": "Ayr", "placeAddress": "1 Example Street", "prize": "A cake for the family" }
      """
    Then the doors answer is 200
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends GET to "/api/admin/elf/doors"
    Then the tile for door 7 shows the place "Pine Cone Cafe" and 4 to do

  Scenario: Checking a text that names a door that does not exist
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends POST to "/api/admin/elf/clues/check" with:
      """
      { "text": "Door 25\nClue 1: one" }
      """
    Then the doors answer is 200
    And the first problem says "Line 1: there is no door 25. Doors go from 1 to 24."

  Scenario: A good text saves all three clues
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends POST to "/api/admin/elf/clues/save" with:
      """
      { "text": "Door 24\nClue 1: It is by the big window.\nClue 2: Look near the till.\nClue 3: It is under the clock." }
      """
    Then the doors answer is 200
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends GET to "/api/admin/elf/doors/24"
    Then clue 1 of the door reads "It is by the big window."
    And clue 2 of the door reads "Look near the till."
    And clue 3 of the door reads "It is under the clock."

  Scenario: A head elf who can only look cannot change a door
    When "look.doors.admin.bdd@example.com" with password "Elf-Doors-Viewer-1" sends GET to "/api/admin/elf/doors"
    Then the doors answer is 200
    When "look.doors.admin.bdd@example.com" with password "Elf-Doors-Viewer-1" sends PATCH to "/api/admin/elf/doors/7" with:
      """
      { "prize": "A cake" }
      """
    Then the doors answer is 403

  Scenario: Every detail of a door is saved and read back
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends PATCH to "/api/admin/elf/doors/24" with:
      """
      {
        "placeName": "Holly Berry Books", "placeTown": "Ayr", "placeAddress": "2 Example Street",
        "contactName": "Sam Example", "contactPhone": "01632 960 123", "contactEmail": "sam@example.org",
        "closesAt": "21:00", "elfSpot": "On the top shelf by the window", "agreedBy": "Jodie",
        "prize": "A book token", "prizeShowOff": true, "elfName": "Twinkle",
        "clue1Time": "17:30", "clue2Time": "18:00", "clue3Time": "18:30", "revealTime": "19:00"
      }
      """
    Then the doors answer is 200
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends GET to "/api/admin/elf/doors/24"
    Then the door has these details
      """
      {
        "placeName": "Holly Berry Books", "placeTown": "Ayr", "placeAddress": "2 Example Street",
        "contactName": "Sam Example", "contactPhone": "01632 960 123", "contactEmail": "sam@example.org",
        "closesAt": "21:00", "elfSpot": "On the top shelf by the window", "agreedBy": "Jodie",
        "prize": "A book token", "prizeShowOff": true, "elfName": "Twinkle",
        "clue1Time": "17:30", "clue2Time": "18:00", "clue3Time": "18:30", "revealTime": "19:00"
      }
      """

  Scenario: A name is added and then taken off
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends POST to "/api/admin/elf/doors/24/names" with:
      """
      { "name": "The Berry Bookshop" }
      """
    Then the doors answer is 201
    And the door has a name "The Berry Bookshop"
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends POST to "/api/admin/elf/doors/24/names" with:
      """
      { "name": "berry bookshop" }
      """
    Then the doors answer is 409
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" takes the name "The Berry Bookshop" off door 24
    Then the doors answer is 200
    And the door has no name "The Berry Bookshop"

  Scenario: A new word is made
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends GET to "/api/admin/elf/doors/24"
    And "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends POST to "/api/admin/elf/doors/24/word"
    Then the doors answer is 200
    And the door's word is not the one before

  Scenario: Dropped off and thanked are ticked and unticked
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends POST to "/api/admin/elf/doors/24/dropped-off"
    Then the door's "droppedOffAt" is ticked
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends DELETE to "/api/admin/elf/doors/24/dropped-off"
    Then the door's "droppedOffAt" is not ticked
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends POST to "/api/admin/elf/doors/24/thanked"
    Then the door's "thankedAt" is ticked
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends DELETE to "/api/admin/elf/doors/24/thanked"
    Then the door's "thankedAt" is not ticked

  Scenario: One clue is saved and then cleared
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends PUT to "/api/admin/elf/doors/24/clues/2" with:
      """
      { "words": "Look near the till." }
      """
    Then the doors answer is 200
    And clue 2 of the door reads "Look near the till."
    When "boss.doors.admin.bdd@example.com" with password "Elf-Doors-Editor-1" sends PUT to "/api/admin/elf/doors/24/clues/2" with:
      """
      { "words": null }
      """
    Then the doors answer is 200
    And clue 2 of the door has no words
