@fundraising @events @db
Feature: Every approved public event has its own page, at /event/<short name>
  An event signed up through /fundraise gets a page of its own once staff approve it, like a
  fundraiser's: what, when and where, a meter, the way to give, the supporter wall, its QR code and
  a countdown. Staff must set its short name (its web address) before approving it. Each address
  answers only for its own kind: /fundraise/<x> for an event sends people on to /event/<x> (a
  temporary redirect, never kept). While
  fundraising is switched off, an event's page is not found, like every fundraising page.

  Scenario: an event cannot be approved until its short name is set, and then has its own page
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a1.evp.fr.bdd@example.com" with role "admin"
    When someone signs up the event "The Event Page Quiz (bdd-fr)", ticketed on another website, to be shown on the website
    Then the fundraising answer is 200
    When "a1.evp.fr.bdd@example.com" approves "The Event Page Quiz (bdd-fr)"
    Then the fundraising answer is 409
    And the fundraising answer says "Give this event a short name first, for its web address."
    And the fundraiser "The Event Page Quiz (bdd-fr)" is stored with status "new"
    When "a1.evp.fr.bdd@example.com" keeps the short name of "The Event Page Quiz (bdd-fr)"
    And "a1.evp.fr.bdd@example.com" approves "The Event Page Quiz (bdd-fr)"
    Then the fundraising answer is 200
    When a visitor opens the event page for "The Event Page Quiz (bdd-fr)"
    Then the visitor gets status 200
    And the page shows "The Event Page Quiz (bdd-fr)"
    And the page shows "About this event"
    And the page shows "Make a donation"
    And the page shows "This is a donation to NBCC, not a ticket."
    And the page shows "Tickets are sold on another website."
    When a visitor opens the event page QR code for "The Event Page Quiz (bdd-fr)"
    Then the visitor gets status 200
    And the answer is an SVG picture
    When a visitor opens the page for "The Event Page Quiz (bdd-fr)"
    Then the visitor gets status 302
    And the visitor is sent to the event page of "The Event Page Quiz (bdd-fr)"
    When a visitor opens "/get-involved"
    Then the card for "The Event Page Quiz (bdd-fr)" links to its event page

  Scenario: an event's page is not found while fundraising is switched off
    Given the events page is switched on
    And fundraising is switched on
    And an approved event "Switched Off Bake Sale (bdd-fr)" signed up before the event questions
    When a visitor opens the event page for "Switched Off Bake Sale (bdd-fr)"
    Then the visitor gets status 200
    Given fundraising is switched off
    When a visitor opens the event page for "Switched Off Bake Sale (bdd-fr)"
    Then the visitor gets status 404
