@stripe-webhook @monthly-renewals
Feature: A monthly gift's renewal is recorded once
  Stripe sends two events for every paid renewal, invoice.paid and invoice.payment_succeeded, and on
  the API version we are pinned to the invoice carries no payment intent or charge. Each renewal is
  known by its invoice and recorded once. The renewals recorded twice before this was put right are
  taken out of donations and kept aside beside the gift they repeated. Every giver here is invented.

  Scenario: both of Stripe's events for one renewal record one gift
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_renew_once",
        "object": "checkout.session",
        "amount_total": 1000,
        "currency": "gbp",
        "mode": "subscription",
        "payment_intent": null,
        "subscription": "sub_bdd_renew_once",
        "metadata": { "mode": "monthly", "plan": "", "giftAid": "false" },
        "customer_details": { "name": "Rowan Renewal", "email": "rowan.renewal.bdd@example.com" }
      }
      """
    Then the response status should be 200
    When I POST a signed Stripe "invoice.paid" webhook event:
      """
      {
        "id": "in_bdd_renew_once",
        "object": "invoice",
        "amount_paid": 1000,
        "currency": "gbp",
        "parent": { "subscription_details": { "subscription": "sub_bdd_renew_once" } },
        "billing_reason": "subscription_cycle"
      }
      """
    Then the response status should be 200
    When I POST a signed Stripe "invoice.payment_succeeded" webhook event:
      """
      {
        "id": "in_bdd_renew_once",
        "object": "invoice",
        "amount_paid": 1000,
        "currency": "gbp",
        "parent": { "subscription_details": { "subscription": "sub_bdd_renew_once" } },
        "billing_reason": "subscription_cycle"
      }
      """
    Then the response status should be 200
    And there should be exactly 2 donations for subscription "sub_bdd_renew_once"
    And the renewal for subscription "sub_bdd_renew_once" keeps the invoice "in_bdd_renew_once"

  Scenario: renewals recorded twice before are taken out and kept aside, and nothing else is touched
    Given a monthly giver whose renewal was recorded twice, a minute apart
    And their next renewal, a month later, was recorded once
    And a later renewal recorded twice whose repeat was refunded
    When the renewals recorded twice are tidied
    Then the repeat is taken out of donations and kept aside beside the gift it repeated
    And an audit line says the repeat was taken out
    And the first gift, both renewals, next month's renewal and the refunded repeat are all still in donations
    When the renewals recorded twice are tidied
    Then nothing more is taken out
