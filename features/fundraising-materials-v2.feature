@fundraising @db
Feature: Fundraising materials, round two (TASK-512)
  Every printed piece carries the charity statement and comes in more sizes. Each poster and leaflet
  has a QR code of its own, a short link that finds the fundraiser by its id and keeps working when
  its page's address changes. The organiser can ask us to print posters and leaflets, which staff
  then see as a request to send.

  Scenario: the leaflet and the A3 poster carry the charity statement
    Given fundraising is switched on
    And an approved fundraiser "Leaflet Dash (bdd-fr)" raising 50000 pence, organised by "leaf.mat2.fr.bdd@example.com"
    And the organiser of "Leaflet Dash (bdd-fr)" is signed in to their private area
    When the signed in organiser opens the "leaflet" for "Leaflet Dash (bdd-fr)"
    Then the materials answer is 200
    And the materials page shows "@page{size:A5 portrait;margin:0}"
    And the materials page shows "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation."
    When the signed in organiser opens the "poster-a3" for "Leaflet Dash (bdd-fr)"
    Then the materials answer is 200
    And the materials page shows "@page{size:A3 portrait;margin:0}"

  Scenario: a poster's own QR code follows the fundraiser when its address changes
    Given fundraising is switched on
    And an approved fundraiser "Short Link Dash (bdd-fr)" raising 50000 pence
    When someone scans the "a4" code of "Short Link Dash (bdd-fr)"
    Then the scan is sent to the page of "Short Link Dash (bdd-fr)" tagged "a4"
    Given staff change the address of "Short Link Dash (bdd-fr)" to "short-link-dash-moved-bdd-fr"
    When someone scans the "a3" code of "Short Link Dash (bdd-fr)"
    Then the scan is sent to "/fundraise/short-link-dash-moved-bdd-fr" tagged "a3"
    When a visitor opens "/q/999999999-a4"
    Then the visitor gets status 404

  Scenario: an organiser asks us to print posters, and staff see it to send
    Given fundraising is switched on
    And an approved fundraiser "Print Me Dash (bdd-fr)" raising 50000 pence, organised by "print.mat2.fr.bdd@example.com"
    And the organiser of "Print Me Dash (bdd-fr)" is signed in to their private area
    When the signed in organiser asks us to print 10 A4 and 2 A3 posters for "Print Me Dash (bdd-fr)"
    Then the print answer is 200
    And "Print Me Dash (bdd-fr)" has a posters request to send, 12 asked for
