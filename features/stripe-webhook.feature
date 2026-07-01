@stripe-webhook
Feature: Stripe webhook handler (REQ-036)
  The ONE Stripe webhook endpoint verifies each event's signature and processes it
  against the single donation record: checkout.session.completed persists a
  donation (Gift Aid recorded as a flag from metadata), and charge.refunded updates
  that SAME record's refunded amount rather than creating a duplicate. Mirrors
  features/checkout.feature; events are signed with STRIPE_WEBHOOK_SECRET.

  Scenario: a completed checkout persists a donation, and a refund updates that same record
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_1",
        "object": "checkout.session",
        "amount_total": 5000,
        "currency": "gbp",
        "mode": "payment",
        "payment_intent": "pi_bdd_1",
        "subscription": null,
        "metadata": { "mode": "once", "plan": "", "giftAid": "true" },
        "customer_details": { "name": "Ada BDD", "email": "ada.bdd@example.com" }
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_bdd_1"
    And the donation with payment intent "pi_bdd_1" should have gift aid true

    When I POST a signed Stripe "charge.refunded" webhook event:
      """
      {
        "id": "ch_bdd_1",
        "object": "charge",
        "payment_intent": "pi_bdd_1",
        "amount": 5000,
        "amount_refunded": 5000
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_bdd_1"
    And the donation with payment intent "pi_bdd_1" should have refunded amount 5000

  Scenario: an invalid signature is rejected
    When I POST a Stripe "charge.refunded" webhook event with an invalid signature:
      """
      {
        "id": "ch_bad",
        "object": "charge",
        "payment_intent": "pi_none",
        "amount": 1000,
        "amount_refunded": 1000
      }
      """
    Then the response status should be 400
