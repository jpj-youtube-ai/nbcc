@admin @admin-sleigh
Feature: The Santa Sleigh section in the admin
  Staff see the year's Santa Sleigh nights, type in the bucket cash and the times, and set the day the
  page switches off. No permission of its own: view of Donations sees it, edit of Donations changes it.
  Card machine taps are the sleigh's when they fall inside a night's window: an hour either side of its
  times, or 4pm to 10pm UK time while its times are to be confirmed.

  Background:
    Given an admin user "vic.sleigh.admin.bdd@example.com" with role "viewer" and password "sleigh-pw-123"
    And an admin user "eli.sleigh.admin.bdd@example.com" with role "editor" and password "sleigh-pw-123"
    And an admin user "cas.sleigh.admin.bdd@example.com" with role "editor" and password "sleigh-pw-123"
    And "cas.sleigh.admin.bdd@example.com" can see only the contact form

  Scenario: the section needs a session, and view of Donations
    When the Santa Sleigh section is read without a session
    Then the Santa Sleigh answer is 401
    When "cas.sleigh.admin.bdd@example.com" reads the Santa Sleigh section
    Then the Santa Sleigh answer is 403

  Scenario: someone who may see Donations sees the 2026 nights, and cannot change them
    When "vic.sleigh.admin.bdd@example.com" reads the Santa Sleigh section
    Then the Santa Sleigh answer is 200
    And the Santa Sleigh nights are the seven 2026 nights in date order, Timings TBC
    And the Santa Sleigh page switches off on "2027-01-31"
    And the Santa Sleigh section says they may not change it
    When "vic.sleigh.admin.bdd@example.com" saves the areas "Somewhere Else" for the sleigh night of "2026-12-15"
    Then the Santa Sleigh answer is 403

  Scenario: bucket cash is added to the total, and a refused save says why in plain words
    Given "eli.sleigh.admin.bdd@example.com" has noted the Santa Sleigh total
    When "eli.sleigh.admin.bdd@example.com" saves £152.40 of bucket cash for the sleigh night of "2026-12-16"
    Then the Santa Sleigh answer is 200
    And the Santa Sleigh bucket cash has gone up by £152.40, and the total with it
    When "eli.sleigh.admin.bdd@example.com" saves the sleigh night of "2026-12-16" from "20:00" to "18:00"
    Then the Santa Sleigh answer is 400
    And the Santa Sleigh answer says "The finish time must be after the start time."

  Scenario: card machine taps follow the night's times, both ways
    Given a card machine tap of £10 was stored at "18:00" UK time on "2026-12-15"
    And a card machine tap of £20 was stored at "23:30" UK time on "2026-12-15"
    When "eli.sleigh.admin.bdd@example.com" saves the sleigh night of "2026-12-15" with its times to be confirmed
    Then the £10 tap is a Santa Sleigh gift
    And the £20 tap is not a Santa Sleigh gift
    And the sleigh night of "2026-12-15" shows £10 from 1 card machine tap
    When "eli.sleigh.admin.bdd@example.com" saves the sleigh night of "2026-12-15" from "22:00" to "22:45"
    Then the £20 tap is a Santa Sleigh gift
    And the £10 tap is not a Santa Sleigh gift
    And the sleigh night of "2026-12-15" shows £20 from 1 card machine tap

  Scenario: the switch off day can be moved
    When "eli.sleigh.admin.bdd@example.com" moves the Santa Sleigh switch off day to "2027-02-14"
    Then the Santa Sleigh answer is 200
    And the Santa Sleigh page switches off on "2027-02-14"
