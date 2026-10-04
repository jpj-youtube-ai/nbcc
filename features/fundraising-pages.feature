@fundraising @events @db
Feature: Get involved and the public fundraising pages (TASK-494)
  The Events page is now Get involved, at /get-involved, and /events goes there for good. While
  fundraising is switched on it also shows every approved, public fundraiser with its meter, and
  each raising money fundraiser has its own page. Its QR code moved to the organiser's private
  area (TASK-501): the address still answers, but the page no longer shows or links it, and ends
  with a quiet line for its organiser. Nothing about fundraising shows while it is switched off, and
  a fundraiser that is not approved has no page.

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

  Scenario: a fundraiser's page, its meter, no QR code, and a quiet link for its organiser
    Given fundraising is switched on
    And an approved fundraiser "Kims Coastal Walk (bdd-fr)" raising 50000 pence
    When a visitor opens the page for "Kims Coastal Walk (bdd-fr)"
    Then the visitor gets status 200
    And the page shows "Kims Coastal Walk (bdd-fr)"
    And the page shows 'aria-valuenow="0"'
    And the page shows "data-fundraiser-id"
    And the page has no QR code on it
    And the page ends with a link for its organiser to manage it
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

  Scenario: the manage page is served while fundraising is on, and kept out of search engines
    Given fundraising is switched on
    When a visitor opens "/fundraise/manage?token=bdd-not-a-real-token"
    Then the visitor gets status 200
    And the page is kept out of search engines
    And the page shows "Your private fundraising area"
    Given fundraising is switched off
    When a visitor opens "/fundraise/manage?token=bdd-not-a-real-token"
    Then the visitor gets status 404

  Scenario: a giver coming back from paying is thanked on the fundraiser's page
    Given fundraising is switched on
    And an approved fundraiser "Ewans Hill Run (bdd-fr)" raising 50000 pence
    When a visitor opens the page for "Ewans Hill Run (bdd-fr)" with "?thanks=1&message=1"
    Then the visitor gets status 200
    And the page shows "Thank you for supporting Ewans Hill Run (bdd-fr)."
    And the page shows "Your message will appear on the wall shortly."

  Scenario: the footer sends Fundraise for us to the sign up only while fundraising is on
    Given fundraising is switched on
    When a visitor opens "/contact"
    Then the page shows '<a href="/fundraise">Fundraise for us</a>'
    Given fundraising is switched off
    When a visitor opens "/contact"
    Then the page does not show '<a href="/fundraise">Fundraise for us</a>'

  # TASK-545: the sitemap is built on its own route, and its footer now has the link like every page.
  Scenario: the sitemap's footer sends Fundraise for us to the sign up while fundraising is on
    Given fundraising is switched on
    When a visitor opens "/sitemap"
    Then the page shows '<a href="/fundraise">Fundraise for us</a>'
    Given fundraising is switched off
    When a visitor opens "/sitemap"
    Then the page does not show '<a href="/fundraise">Fundraise for us</a>'

  Scenario: the fundraising help page is there only while fundraising is on (TASK-498)
    Given fundraising is switched on
    When a visitor opens "/fundraise/help"
    Then the visitor gets status 200
    And the page shows "An A to Z of fundraising ideas"
    And the page shows 'href="tel:+441292811015"'
    And the page shows 'href="mailto:events@nbcc.scot"'
    And the page does not show 'name="robots"'
    When a visitor opens "/fundraise"
    Then the page shows 'href="/fundraise/help"'
    Given fundraising is switched off
    When a visitor opens "/fundraise/help"
    Then the visitor gets status 404

  Scenario: an event signed up with the event questions shows its price, booking and access on its card (TASK-499)
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a5.fr.bdd@example.com" with role "admin"
    When someone signs up the event "The BDD Quiz (bdd-fr)", ticketed on another website, to be shown on the website
    Then the fundraising answer is 200
    And the fundraiser "The BDD Quiz (bdd-fr)" is stored with its event answers
    When "a5.fr.bdd@example.com" keeps the short name of "The BDD Quiz (bdd-fr)"
    And "a5.fr.bdd@example.com" approves "The BDD Quiz (bdd-fr)"
    And a visitor opens "/get-involved"
    Then the visitor gets status 200
    And the card for "The BDD Quiz (bdd-fr)" shows "Eight rounds and a raffle (bdd-fr)."
    And the card for "The BDD Quiz (bdd-fr)" shows "£5 a head"
    And the card for "The BDD Quiz (bdd-fr)" shows 'href="https://tickets.example.com/bdd-quiz"'
    And the card for "The BDD Quiz (bdd-fr)" shows "Book tickets"
    And the card for "The BDD Quiz (bdd-fr)" shows "Tickets are sold on another website"
    And the card for "The BDD Quiz (bdd-fr)" shows "<b>Access:</b> step free entry and a hearing loop."
    And the card for "The BDD Quiz (bdd-fr)" shows "Organised by The BDD Quiz Team"
    And the card for "The BDD Quiz (bdd-fr)" does not show "No need to book"

  Scenario: an event signed up before the event questions no longer promises there is no need to book (TASK-499)
    Given the events page is switched on
    And fundraising is switched on
    And an approved event "Old Style Bake Sale (bdd-fr)" signed up before the event questions
    When a visitor opens "/get-involved"
    Then the visitor gets status 200
    And the card for "Old Style Bake Sale (bdd-fr)" shows "Old Style Bake Sale (bdd-fr)"
    And the card for "Old Style Bake Sale (bdd-fr)" does not show "No need to book"
