@fundraising @events @db
Feature: Get involved and the public fundraising pages (TASK-494)
  The Events page is now Get involved, at /get-involved, and /events goes there for good. While
  fundraising is switched on it also shows every approved, public fundraiser with its meter, and
  each raising money fundraiser has its own page with a QR code. Nothing about fundraising shows
  while it is switched off, and a fundraiser that is not approved has no page.

  Scenario: the old Events address goes to Get involved, keeping its query string
    When a visitor opens "/events?utm_source=bdd&utm_medium=email"
    Then the visitor gets status 301
    And the visitor is sent to "/get-involved?utm_source=bdd&utm_medium=email"

  Scenario: an approved fundraiser shows on Get involved only while fundraising is on
    Given the events page is switched on
    And fundraising is switched on
    And an approved fundraiser "Sams Sponsored Swim (bdd-fr)" raising 50000 pence
    When a visitor opens "/get-involved"
    Then the visitor gets status 200
    And the page shows "Sams Sponsored Swim (bdd-fr)"
    And the page shows "Fundraise for us"
    And the menu offers Events straight after About
    Given fundraising is switched off
    When a visitor opens "/get-involved"
    Then the visitor gets status 200
    And the page does not show "Sams Sponsored Swim (bdd-fr)"
    And the page does not show "data-chips"

  Scenario: a fundraiser's page, its meter and its QR code
    Given fundraising is switched on
    And an approved fundraiser "Kims Coastal Walk (bdd-fr)" raising 50000 pence
    When a visitor opens the page for "Kims Coastal Walk (bdd-fr)"
    Then the visitor gets status 200
    And the page shows "Kims Coastal Walk (bdd-fr)"
    And the page shows 'aria-valuenow="0"'
    And the page shows "data-fundraiser-id"
    When a visitor opens the QR code for "Kims Coastal Walk (bdd-fr)"
    Then the visitor gets status 200
    And the answer is an SVG picture

  Scenario: a fundraiser that is not approved, or while fundraising is off, has no page
    Given fundraising is switched on
    And a fundraiser "Not Yet Approved (bdd-fr)" that is still new
    When a visitor opens the page for "Not Yet Approved (bdd-fr)"
    Then the visitor gets status 404
    When a visitor opens the QR code for "Not Yet Approved (bdd-fr)"
    Then the visitor gets status 404
    Given an approved fundraiser "Approved But Off (bdd-fr)" raising 50000 pence
    And fundraising is switched off
    When a visitor opens the page for "Approved But Off (bdd-fr)"
    Then the visitor gets status 404

  Scenario: the sign up page says it is not open yet while fundraising is off
    Given fundraising is switched off
    When a visitor opens "/fundraise"
    Then the visitor gets status 200
    And the page shows "data-fundraise-open hidden"
    Given fundraising is switched on
    When a visitor opens "/fundraise"
    Then the visitor gets status 200
    And the page does not show "data-fundraise-open hidden"

  Scenario: the manage page is served, and kept out of search engines
    When a visitor opens "/fundraise/manage?token=bdd-not-a-real-token"
    Then the visitor gets status 200
    And the page is kept out of search engines
