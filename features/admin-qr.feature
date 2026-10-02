@admin @admin-qr
Feature: QR codes for every page, in the admin (TASK-492)
  Staff make a QR code for any page of nbcc.scot, to print or share. Every page in the site's page
  list has one, so a new page gets its code with no more work. Codes download as SVG for printing
  and PNG for screens. Anyone who can view Site pages may use them.

  Background:
    Given an admin user "ann.qr.admin.bdd@example.com" with role "admin" and password "qr-pw-123"

  Scenario: the QR codes need a session
    When I ask for the QR codes without a session
    Then the QR answer is 401

  Scenario: every page has a code, tagged as a QR scan of that page
    When "ann.qr.admin.bdd@example.com" lists the QR codes
    Then the QR answer is 200
    And the home page and the donate page are listed with their codes
    And the donate page's code carries "https://nbcc.scot/donate?utm_medium=qr&utm_campaign=donate"

  Scenario: a code downloads as an SVG for print and a PNG for screens, named after its page
    When "ann.qr.admin.bdd@example.com" downloads the "svg" code for "/donate"
    Then the QR answer is 200
    And the download is "image/svg+xml" named "nbcc-qr-donate.svg"
    When "ann.qr.admin.bdd@example.com" downloads the "png" code for "/donate"
    Then the QR answer is 200
    And the download is "image/png" named "nbcc-qr-donate.png"

  Scenario: a code is only ever made for an address on nbcc.scot
    When "ann.qr.admin.bdd@example.com" downloads the "svg" code for "https://elsewhere.example.com/"
    Then the QR answer is 400
