@admin @admin-donations-log
Feature: The Donations log (Admin > Giving > Donations)
  Each new gift notes what brought the giver (a QR code, an email, a search ...) and the page it was
  given on, worked out at checkout from the giving page's address and the page before it, and copied
  onto the donation after it is saved. A browser that asks not to be tracked has nothing noted. Staff
  who can view Donations filter the log by name or email, dates, how it was paid and what brought the
  giver, and open any gift's details. Every giver, payer and member of staff here is invented, with an
  address ending "donlog.admin.bdd@example.com", and the hooks remove everything made for them.

  Background:
    Given an admin user "ann.donlog.admin.bdd@example.com" with role "admin" and password "donlog-pw-123"

  Scenario: a Donate page gift from a QR code notes what brought the giver, and Came from finds it
    When a giver checks out on the Donate page opened as "/donate?utm_medium=qr&utm_campaign=c12"
    Then the checkout notes the arrival channel "qr" and the giving page "/donate"
    When Stripe completes the giver's checkout
    Then "ann.donlog.admin.bdd@example.com" finds the gift by its email, noted as arrival channel "qr" given on "/donate"
    And "ann.donlog.admin.bdd@example.com" finds the gift when the log is filtered with "came=qr"
    And "ann.donlog.admin.bdd@example.com" does not find the gift when the log is filtered with "came=email"

  Scenario: a browser sending Do Not Track has nothing noted about what brought the giver
    When a giver whose browser sends Do Not Track checks out on the Donate page opened as "/donate?utm_medium=qr&utm_campaign=c12"
    Then the checkout notes no arrival
    When Stripe completes the giver's checkout
    Then "ann.donlog.admin.bdd@example.com" finds the gift by its email, with no arrival noted

  Scenario: a gift's details answer only staff who can view Donations
    Given a staff user "sid.donlog.admin.bdd@example.com" with password "donlog-pw-123" and only "stories:view" permission
    When a giver checks out on the Donate page opened as "/donate?utm_medium=qr&utm_campaign=c12"
    And Stripe completes the giver's checkout
    And "ann.donlog.admin.bdd@example.com" opens the gift's details
    Then the gift log answer is 200
    And the details are a donation given on the "Donate page" that came from a QR code
    When "ann.donlog.admin.bdd@example.com" opens the details of a donation that does not exist
    Then the gift log answer is 404
    When "ann.donlog.admin.bdd@example.com" opens the gift's details as the kind "raffle"
    Then the gift log answer is 404
    When someone opens the gift's details without a session
    Then the gift log answer is 401
    When "sid.donlog.admin.bdd@example.com" opens the gift's details
    Then the gift log answer is 403

  Scenario: an invoice marked paid by bank transfer is found by Paid by, and its details say so
    When "ann.donlog.admin.bdd@example.com" sends an invoice of "40" and marks it paid by bank transfer today
    Then "ann.donlog.admin.bdd@example.com" finds the gift when the log is filtered with "method=bank_transfer"
    When "ann.donlog.admin.bdd@example.com" opens the gift's details
    Then the gift log answer is 200
    And the details say it was paid by "Bank transfer"

  Scenario: dates far ahead find nothing, and filter values the log does not know are ignored
    When a giver checks out on the Donate page opened as "/donate?utm_medium=qr&utm_campaign=c12"
    And Stripe completes the giver's checkout
    Then "ann.donlog.admin.bdd@example.com" finds no gifts when the log is filtered with "from=2099-12-01&to=2099-12-31"
    And "ann.donlog.admin.bdd@example.com" finds the gift when the log is filtered with "method=cheque&came=carrier_pigeon&giftAid=maybe&from=yesterday&to=31-12-2026&source=nowhere"
