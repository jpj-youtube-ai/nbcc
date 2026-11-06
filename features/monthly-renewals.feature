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
    # Each double was recorded once from invoice.paid and once from invoice.payment_succeeded; the
    # audit line of each gift names the event that made it, and the webhook ledger says its type.
    Given a monthly giver whose renewal was recorded twice, a minute apart
    And a renewal recorded twice whose two events were handled together, the repeat stamped first
    And two different invoices paid seconds apart, each recorded twice
    And a renewal recorded twice whose repeat is in a Gift Aid claim
    And a renewal recorded twice where both are in a Gift Aid claim
    And their next renewal, a month later, was recorded once
    When the renewals recorded twice are tidied
    Then each repeat is taken out of donations and kept aside beside the gift it repeated
    And an audit line says each repeat was taken out
    And the gift in the claim is kept and its twin is taken out instead
    And the pair both in a claim is left, and an audit line names it
    And one gift for each payment is still in donations
    When the renewals recorded twice are tidied
    Then nothing more is taken out
