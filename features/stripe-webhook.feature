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

  Scenario: a prorated subscription charge records the actual amount and keeps Gift Aid
    # The monthly checkout captures the initial charge and the Gift Aid declaration.
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_prorate",
        "object": "checkout.session",
        "amount_total": 2500,
        "currency": "gbp",
        "mode": "subscription",
        "payment_intent": null,
        "subscription": "sub_bdd_prorate",
        "metadata": { "mode": "monthly", "plan": "gold", "giftAid": "true" },
        "customer_details": { "name": "Grace Prorate", "email": "grace.bdd@example.com" }
      }
      """
    Then the response status should be 200
    # A mid-subscription up/downgrade bills a prorated amount (1234) that differs from
    # the 2500 tier preset; it must become its own donation recording that true amount,
    # carrying the Gift Aid flag from the original declaration.
    When I POST a signed Stripe "invoice.paid" webhook event:
      """
      {
        "id": "in_bdd_prorate",
        "object": "invoice",
        "amount_paid": 1234,
        "currency": "gbp",
        "subscription": "sub_bdd_prorate",
        "payment_intent": "pi_bdd_prorate",
        "charge": "ch_bdd_prorate",
        "billing_reason": "subscription_update"
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_bdd_prorate"
    And the donation with payment intent "pi_bdd_prorate" should have amount 1234
    And the donation with payment intent "pi_bdd_prorate" should have gift aid true

  Scenario: a company checkout persists a not-eligible, non-Gift-Aid company donation (REQ-038)
    # donor_type + business name ride through metadata onto the donor record; a company
    # is stored gift_aid=false and derives claim_status='not_eligible' (REQ-036/REQ-053).
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_company",
        "object": "checkout.session",
        "amount_total": 100000,
        "currency": "gbp",
        "mode": "payment",
        "payment_intent": "pi_bdd_company",
        "subscription": null,
        "metadata": { "mode": "once", "plan": "", "giftAid": "false", "donorType": "company", "businessName": "Acme Ltd" },
        "customer_details": { "name": "Casey Contact", "email": "acme.bdd@example.com" }
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_bdd_company"
    And the donation with payment intent "pi_bdd_company" should have gift aid false
    And the donation with payment intent "pi_bdd_company" should have claim status "not_eligible"
    And the donor for payment intent "pi_bdd_company" should have donor type "company"
    And the donor for payment intent "pi_bdd_company" should have business name "Acme Ltd"

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
