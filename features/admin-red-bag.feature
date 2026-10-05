@admin @admin-red-bag
Feature: Fill a Red Bag against the Donate page, in the admin
  Staff can see how much is given through the Fill a Red Bag page compared with the ordinary Donate
  page: totals at the top of the Donations screen, each gift labelled, a filter, and a line on the
  Overview. Measured as a change, so other gifts in the test database cannot get in the way.

  Background:
    Given an admin user "rae.redbag.admin.bdd@example.com" with role "viewer" and password "overview-pw-123"
    And an admin user "cal.redbag.admin.bdd@example.com" with role "editor" and password "overview-pw-123"
    And "cal.redbag.admin.bdd@example.com" can see only the contact form

  Scenario: the totals need a session
    When I read the Red Bag totals without a session
    Then the Red Bag totals answer is 401

  Scenario: someone who cannot see Donations cannot read the totals
    When "cal.redbag.admin.bdd@example.com" reads the Red Bag totals
    Then the Red Bag totals answer is 403

  Scenario: each gift is counted once, in the right place
    Given "rae.redbag.admin.bdd@example.com" has noted the Red Bag totals
    And a £30 Fill a Red Bag gift was made today
    And a £50 gift was made on the Donate page today
    And a £20 gift was taken in person today
    And a £40 Fill a Red Bag gift was made today and refunded in full
    And a £60 Fill a Red Bag gift was made today, with £15 of it refunded
    When "rae.redbag.admin.bdd@example.com" reads the Red Bag totals
    Then the Red Bag totals answer is 200
    And Fill a Red Bag has gone up by £75 from 2 gifts, this month and in all
    And the Donate page has gone up by £50 from 1 gift, this month and in all
    And the totals say when Fill a Red Bag gifts are counted from

  Scenario: the list labels a Fill a Red Bag gift and can show only those
    Given a £30 Fill a Red Bag gift was made today
    And a £50 gift was made on the Donate page today
    When "rae.redbag.admin.bdd@example.com" lists donations
    Then the £30 gift is listed as a Fill a Red Bag gift
    And the £50 gift is listed with no source
    When "rae.redbag.admin.bdd@example.com" lists Fill a Red Bag donations only
    Then every gift listed is a Fill a Red Bag gift
    And the £30 gift is listed as a Fill a Red Bag gift

  Scenario: the Overview has a Fill a Red Bag line
    Given a £30 Fill a Red Bag gift was made today
    When "rae.redbag.admin.bdd@example.com" reads the overview
    Then the overview answer is 200
    And every number could be checked
    And the overview says what Fill a Red Bag brought in this month, with a button to "Donations"
