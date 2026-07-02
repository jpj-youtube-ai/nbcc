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

  Scenario: a gift-aided checkout with a declaration persists a claimable donation linked to a declarations row (REQ-043)
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_decl",
        "object": "checkout.session",
        "amount_total": 5000,
        "currency": "gbp",
        "mode": "payment",
        "payment_intent": "pi_bdd_decl",
        "subscription": null,
        "metadata": {
          "mode": "once", "plan": "", "giftAid": "true", "donorType": "individual",
          "declarationScope": "this_donation",
          "giftAidWordingVersion": "hmrc-single-2024-01",
          "giftAidWording": "I want to Gift Aid my donation to the Night Before Christmas Campaign. I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any difference.",
          "declTitle": "Dr", "declFirstName": "Ada", "declLastName": "Decl",
          "declHouseNameNumber": "12", "declAddress": "Analytical Avenue", "declPostcode": "KA1 1AA", "declNonUk": "false",
          "email": "ada.decl.bdd@example.com", "emailConsent": "true"
        },
        "customer_details": { "name": "Ada Decl", "email": "ada.decl.bdd@example.com" }
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_bdd_decl"
    And the donation with payment intent "pi_bdd_decl" should have gift aid true
    # An individual gift-aided donation with a declaration is claimable (REQ-037).
    And the donation with payment intent "pi_bdd_decl" should have claim status "eligible"
    And the donation with payment intent "pi_bdd_decl" should have a linked declaration

  Scenario: a card-present (in-person) charge books a walk-in donation, idempotently; online charges are ignored
    # A Stripe Terminal / card_present charge is an in-person gift with no checkout session,
    # captured straight off the charge (REQ-054) as an anonymous walk-in donor + donation.
    When I POST a signed Stripe "charge.succeeded" webhook event with id "evt_bdd_cp_1":
      """
      {
        "id": "ch_bdd_cp_1",
        "object": "charge",
        "amount": 5000,
        "currency": "gbp",
        "payment_intent": "pi_bdd_cp_1",
        "receipt_email": "walkin.cp.bdd@example.com",
        "payment_method_details": { "type": "card_present" }
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_bdd_cp_1"
    And the donation with payment intent "pi_bdd_cp_1" should have payment channel "in_person"
    And there should be exactly 1 donor for payment intent "pi_bdd_cp_1"
    And there should be a "donation.created" audit row for the donation with payment intent "pi_bdd_cp_1"
    # The in-person confirmation email (TASK-075) is sent post-commit to the receipt email
    # (stubbed on the .example provider URL in CI, so it "succeeds"): declaration_status is
    # flipped to 'sent' and a unique declaration_token addresses the emailed link/QR.
    And the donation with payment intent "pi_bdd_cp_1" should have declaration status "sent"
    And the donation with payment intent "pi_bdd_cp_1" should have a declaration token
    # A £50 gift is above the £30 GASDS ceiling, so it is NOT GASDS-eligible (TASK-078).
    And the donation with payment intent "pi_bdd_cp_1" should have gasds eligible false

    # Resending the IDENTICAL event id is a no-op (idempotent by event id) — still exactly one.
    When I POST a signed Stripe "charge.succeeded" webhook event with id "evt_bdd_cp_1":
      """
      {
        "id": "ch_bdd_cp_1",
        "object": "charge",
        "amount": 5000,
        "currency": "gbp",
        "payment_intent": "pi_bdd_cp_1",
        "receipt_email": "walkin.cp.bdd@example.com",
        "payment_method_details": { "type": "card_present" }
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_bdd_cp_1"

    # A non-card-present (online) charge.succeeded is IGNORED — the gift is already captured
    # via checkout.session.completed, so mapping it here too would double-count.
    When I POST a signed Stripe "charge.succeeded" webhook event with id "evt_bdd_online_1":
      """
      {
        "id": "ch_bdd_online_1",
        "object": "charge",
        "amount": 5000,
        "currency": "gbp",
        "payment_intent": "pi_bdd_online_1",
        "payment_method_details": { "type": "card" }
      }
      """
    Then the response status should be 200
    And there should be exactly 0 donation with payment intent "pi_bdd_online_1"

  Scenario: a small card-present gift is flagged GASDS-eligible, Gift Aid rules untouched (REQ-058)
    # A £25 card-present tap is a GASDS small donation (no declaration, no Gift Aid), so it is
    # flagged gasds_eligible=true while claim_status stays not_eligible (Gift Aid is untouched).
    When I POST a signed Stripe "charge.succeeded" webhook event with id "evt_bdd_gasds_1":
      """
      {
        "id": "ch_bdd_gasds_1",
        "object": "charge",
        "amount": 2500,
        "currency": "gbp",
        "payment_intent": "pi_bdd_gasds_1",
        "payment_method_details": { "type": "card_present" }
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_bdd_gasds_1"
    And the donation with payment intent "pi_bdd_gasds_1" should have gasds eligible true
    And the donation with payment intent "pi_bdd_gasds_1" should have claim status "not_eligible"

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
