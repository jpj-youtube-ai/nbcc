@admin @admin-invoices
Feature: Invoices for donations
  Staff send an invoice from Admin > Giving > Invoices to a person, a business or a group. It is paid
  by card or bank transfer from a private page, and a paid invoice becomes one donation, labelled with
  its invoice. Anyone who can view Donations sees the invoices; sending, marking paid and cancelling
  need Donations edit.

  Background:
    Given an admin user "ann.invoices.admin.bdd@example.com" with role "admin" and password "inv-pw-123"
    And an admin user "vic.invoices.admin.bdd@example.com" with role "viewer" and password "inv-pw-123"

  Scenario: the invoices need a session, and sending one needs Donations edit
    When I ask for the invoices without a session
    Then the invoices answer is 401
    When "vic.invoices.admin.bdd@example.com" lists the invoices
    Then the invoices answer is 200
    When "vic.invoices.admin.bdd@example.com" sends an invoice for a person of "25"
    Then the invoices answer is 403

  Scenario: a sent invoice opens by its private link, and only by it
    When "ann.invoices.admin.bdd@example.com" sends an invoice for a person of "25"
    Then the invoices answer is 201
    When someone opens the new invoice's link
    Then the page answer is 200 and shows the invoice's number
    When someone opens an invoice link that has been tampered with
    Then the page answer is 404

  Scenario: a bank transfer marked paid becomes exactly one donation, labelled with its invoice
    When "ann.invoices.admin.bdd@example.com" sends an invoice for a person of "40"
    And "ann.invoices.admin.bdd@example.com" marks the new invoice paid today
    Then the invoices answer is 200
    And the new invoice has 1 donation in Donations
    When "ann.invoices.admin.bdd@example.com" marks the new invoice paid today
    Then the invoices answer is 409
    And the new invoice has 1 donation in Donations
    When someone opens the new invoice's link
    Then the page says it was paid

  Scenario: a card payment becomes exactly one donation, even when Stripe tells us twice
    When "ann.invoices.admin.bdd@example.com" sends an invoice for a person of "60"
    And Stripe reports the new invoice paid by card
    And Stripe reports the same card payment again
    Then the new invoice has 1 donation in Donations
    When someone opens the new invoice's link
    Then the page says it was paid

  Scenario: a business is never offered Gift Aid, whatever is posted
    When "ann.invoices.admin.bdd@example.com" sends an invoice for a business of "500"
    Then the invoices answer is 201
    When someone posts a Gift Aid declaration to the new invoice's page
    Then the page answer is 409

  Scenario: a cancelled invoice can no longer be paid
    When "ann.invoices.admin.bdd@example.com" sends an invoice for a person of "30"
    And "ann.invoices.admin.bdd@example.com" cancels the new invoice
    Then the invoices answer is 200
    When someone presses Pay by card on the new invoice's page
    Then the page answer is 409
    And the page says it has been cancelled
