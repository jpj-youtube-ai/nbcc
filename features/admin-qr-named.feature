@admin @admin-qr-named
Feature: Named QR codes, each counting its own scans (TASK-588)
  Staff make a QR code for each place one is printed or shown, such as a billboard or a business
  card, name it, and choose where it goes from a list. The code holds a short link, /q/c<id>, which
  forwards to the chosen page and counts the scan, so each code's scans can be seen apart. Where it
  goes can be changed after printing. Anyone who can view Site pages sees and downloads them; making
  and changing one needs Site pages edit.

  Background:
    Given an admin user "ann.qrnamed.admin.bdd@example.com" with role "admin" and password "qr-pw-123"
    And an admin user "ed.qrnamed.admin.bdd@example.com" with role "editor" and password "qr-pw-123"

  Scenario: the named codes need a session, and making one needs Site pages edit
    When I ask for the named QR codes without a session
    Then the named QR answer is 401
    When "ed.qrnamed.admin.bdd@example.com" lists the named QR codes
    Then the named QR answer is 200
    When "ed.qrnamed.admin.bdd@example.com" makes a named QR code "Editor's poster" going to "/donate"
    Then the named QR answer is 403

  Scenario: a named code goes only where the list says
    When "ann.qrnamed.admin.bdd@example.com" makes a named QR code "Typed address" going to "https://elsewhere.example.com"
    Then the named QR answer is 400
    When "ann.qrnamed.admin.bdd@example.com" makes a named QR code "Typo" going to "/donat"
    Then the named QR answer is 400

  Scenario: a scan of a named code is forwarded with its tags, and counted
    When "ann.qrnamed.admin.bdd@example.com" makes a named QR code "Billboard" going to "/donate"
    Then the named QR answer is 201
    And the new code's link is its short link
    When a link preview fetches the new code
    Then the scan is forwarded to "https://nbcc.scot/donate" tagged as that code
    When a phone scans the new code
    Then the scan is forwarded to "https://nbcc.scot/donate" tagged as that code
    When "ann.qrnamed.admin.bdd@example.com" lists the named QR codes
    Then the new code is listed with 1 scan, going to "Donate"

  Scenario: where a code goes can be changed after printing, and it can be hidden
    When "ann.qrnamed.admin.bdd@example.com" makes a named QR code "Drop-off poster" going to "/"
    Then the named QR answer is 201
    When "ann.qrnamed.admin.bdd@example.com" changes the new code to go to "https://drop.nbcc.scot"
    Then the named QR answer is 200
    When a phone scans the new code
    Then the scan is forwarded to exactly "https://drop.nbcc.scot"
    When "ann.qrnamed.admin.bdd@example.com" hides the new code
    Then the named QR answer is 200
    When a phone scans the new code
    Then the scan is forwarded to exactly "https://drop.nbcc.scot"

  Scenario: a named code downloads as SVG and PNG, and an unknown short link is not found
    When "ann.qrnamed.admin.bdd@example.com" makes a named QR code "Table card" going to "/contact"
    Then the named QR answer is 201
    When "ann.qrnamed.admin.bdd@example.com" downloads the new code as "png"
    Then the named QR answer is 200
    When a phone scans the short link "/q/c2000000000"
    Then the scan answer is 404
