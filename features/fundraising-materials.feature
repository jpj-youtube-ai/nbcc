@fundraising @db
Feature: Fundraising materials (TASK-504)
  A signed in organiser opens their poster, pictures to share, sponsor form and, once finished, a
  certificate of thanks, each a print ready page made from their approved details. Only their own,
  and nothing while fundraising is switched off. Anyone can print a blank sponsor form and download
  our logos while fundraising is on.

  Scenario: an organiser opens their poster and sponsor form
    Given fundraising is switched on
    And an approved fundraiser "Sams Poster Dash (bdd-fr)" raising 50000 pence, organised by "sam.mat.fr.bdd@example.com"
    And an approved fundraiser "Someone Elses Bake (bdd-fr)" raising 50000 pence, organised by "other.mat.fr.bdd@example.com"
    And the organiser of "Sams Poster Dash (bdd-fr)" is signed in to their private area
    When the signed in organiser opens the "poster" for "Sams Poster Dash (bdd-fr)"
    Then the materials answer is 200
    And the materials page shows "Fundraising for NBCC"
    And the materials page shows "Sams Poster Dash (bdd-fr)"
    And the materials page shows "Every pound helps the children, young people and vulnerable adults we support, all year round."
    And the materials page is never kept or indexed
    When the signed in organiser opens the "sponsor-form" for "Sams Poster Dash (bdd-fr)"
    Then the materials answer is 200
    And the materials page shows "Please send this form back to us with the money so we can claim Gift Aid"
    And the materials page shows "I confirm that I am a UK Income or Capital Gains taxpayer"
    When the signed in organiser opens the "certificate" for "Sams Poster Dash (bdd-fr)"
    Then the materials answer is 404
    When the signed in organiser opens the "poster" for "Someone Elses Bake (bdd-fr)"
    Then the materials answer is 404
    Given fundraising is switched off
    When the signed in organiser opens the "poster" for "Sams Poster Dash (bdd-fr)"
    Then the materials answer is 404

  Scenario: the certificate is there once the fundraiser is finished
    Given fundraising is switched on
    And a finished fundraiser "Finished Cert Walk (bdd-fr)" raising 50000 pence, organised by "cert.mat.fr.bdd@example.com"
    And the organiser of "Finished Cert Walk (bdd-fr)" is signed in to their private area
    When the signed in organiser opens the "certificate" for "Finished Cert Walk (bdd-fr)"
    Then the materials answer is 200
    And the materials page shows "Certificate of thanks"

  Scenario: the blank sponsor form and the logo pack are there only while fundraising is on
    Given fundraising is switched on
    When a visitor opens "/fundraise/sponsor-form"
    Then the visitor gets status 200
    And the page shows "Sponsorship and Gift Aid declaration"
    When a visitor opens "/fundraise/logos"
    Then the visitor gets status 200
    And the page shows 'href="/assets/img/nbcc-logo-white.svg"'
    When a visitor opens "/fundraise/help"
    Then the page shows 'href="/fundraise/logos"'
    Given fundraising is switched off
    When a visitor opens "/fundraise/sponsor-form"
    Then the visitor gets status 404
    When a visitor opens "/fundraise/logos"
    Then the visitor gets status 404
