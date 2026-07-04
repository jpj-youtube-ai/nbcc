@db @donation-journey
Feature: End-to-end donation journey (REQ-028/REQ-029/REQ-036)
  A donor completes checkout and Stripe fires the completion webhook it built. Each
  scenario POSTs /api/checkout-session, captures the REAL stamped session metadata
  (echoed in stub mode, TASK-116), replays it into a signed checkout.session.completed
  event with the payment fields Stripe adds at completion, and asserts the resulting
  donor / donation / declaration rows. Stripe is the offline stub; no live account.

  Scenario: individual one-off Gift Aid (UK) becomes a claimable declared donation
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": true, "donorType": "individual",
        "fullName": "Ada Individual", "email": "ada.journey@example.com", "emailConsent": true,
        "declaration": { "firstName": "Ada", "lastName": "Individual", "houseNameNumber": "12",
          "address": "Analytical Avenue, London", "postcode": "KA1 1AA", "nonUk": false } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_ind_uk", "amount_total": 5000,
        "customer_details": { "name": "Ada Individual", "email": "ada.journey@example.com" } }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_ind_uk"
    And the donation with payment intent "pi_journey_ind_uk" should have gift aid true
    And the donation with payment intent "pi_journey_ind_uk" should have claim status "eligible"
    And the donation with payment intent "pi_journey_ind_uk" should have a linked declaration
    And the declaration for payment intent "pi_journey_ind_uk" should have scope "this_donation"
    And the declaration for payment intent "pi_journey_ind_uk" should have wording version "hmrc-single-2024-01"
    And the donor for payment intent "pi_journey_ind_uk" should have donor type "individual"

  Scenario: individual one-off Gift Aid (non-UK) stores a declaration with a blank postcode
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": true, "donorType": "individual",
        "declaration": { "firstName": "Jean", "lastName": "Journey", "houseNameNumber": "La Rue",
          "address": "St Helier, Jersey", "postcode": "SW1A 1AA", "nonUk": true } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_ind_nonuk", "amount_total": 5000 }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_ind_nonuk"
    And the donation with payment intent "pi_journey_ind_nonuk" should have a linked declaration
    And the declaration for payment intent "pi_journey_ind_nonuk" should have blank postcode

  Scenario: individual one-off, no Gift Aid, anonymous is stored non-claimable and anonymous
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": false, "donorType": "individual",
        "anonymous": true }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_ind_anon", "amount_total": 5000 }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_ind_anon"
    And the donation with payment intent "pi_journey_ind_anon" should have gift aid false
    And the donation with payment intent "pi_journey_ind_anon" should have claim status "not_eligible"
    And the donor for payment intent "pi_journey_ind_anon" should have anonymous true

  Scenario: company one-off (no consideration) is stored non-eligible and gets a CT-receipt path
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 100000, "giftAid": false, "donorType": "company",
        "businessName": "Acme Ltd",
        "company": { "legalName": "Acme Ltd", "contactName": "Ada Lovelace",
          "contactEmail": "finance.journey@example.com", "billingAddress": "1 Office Park, London",
          "billingPostcode": "SW1A 1AA", "considerationGiven": false } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_co_clean", "amount_total": 100000,
        "customer_details": { "name": "Ada Lovelace", "email": "finance.journey@example.com" } }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_co_clean"
    And the donation with payment intent "pi_journey_co_clean" should have gift aid false
    And the donation with payment intent "pi_journey_co_clean" should have claim status "not_eligible"
    And the donor for payment intent "pi_journey_co_clean" should have donor type "company"
    And the donor for payment intent "pi_journey_co_clean" should have business name "Acme Ltd"

  Scenario: company one-off WITH consideration is flagged for the trustees (no receipt)
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 100000, "giftAid": false, "donorType": "company",
        "businessName": "Beta Ltd",
        "company": { "legalName": "Beta Ltd", "contactName": "Grace Hopper",
          "contactEmail": "finance2.journey@example.com", "billingAddress": "2 Office Park, London",
          "billingPostcode": "SW1A 1AA", "considerationGiven": true } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_co_consid", "amount_total": 100000 }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_co_consid"
    And the donation with payment intent "pi_journey_co_consid" should have claim status "not_eligible"
    And there should be a "donation.flagged_for_trustees" audit row for the donation with payment intent "pi_journey_co_consid"

  Scenario: partnership Gift Aid records one declaration + one share per partner, summing to the amount
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 10000, "giftAid": true, "donorType": "partnership",
        "partners": [
          { "firstName": "Ada", "lastName": "Partner", "houseNameNumber": "1",
            "address": "Partnership House, London", "postcode": "SW1A 1AA", "nonUk": false, "sharePence": 6000 },
          { "firstName": "Grace", "lastName": "Partner", "houseNameNumber": "1",
            "address": "Partnership House, London", "postcode": "SW1A 1AA", "nonUk": false, "sharePence": 4000 } ] }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_partnership", "amount_total": 10000 }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_partnership"
    And there should be exactly 2 partner share for payment intent "pi_journey_partnership"
    And the partner shares for payment intent "pi_journey_partnership" should sum to 10000

  Scenario: monthly Gift Aid (enduring) records an enduring declaration, and a later invoice bills a further donation
    When I start checkout with JSON:
      """
      { "mode": "monthly", "plan": "gold", "amount": 2500, "giftAid": true, "ageConfirmed": true,
        "donorType": "individual", "email": "grace.journey@example.com", "emailConsent": true,
        "declaration": { "firstName": "Grace", "lastName": "Monthly", "houseNameNumber": "9",
          "address": "Recurring Road, London", "postcode": "KA1 1AA", "nonUk": false } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "subscription": "sub_journey_monthly", "amount_total": 2500, "payment_intent": null,
        "customer_details": { "name": "Grace Monthly", "email": "grace.journey@example.com" } }
      """
    Then the response status should be 200
    And the donation for subscription "sub_journey_monthly" should have gift aid true
    And the declaration for subscription "sub_journey_monthly" should have scope "all_donations"
    When I POST a signed Stripe "invoice.paid" webhook event:
      """
      {
        "id": "in_journey_monthly",
        "object": "invoice",
        "amount_paid": 2500,
        "currency": "gbp",
        "subscription": "sub_journey_monthly",
        "payment_intent": "pi_journey_monthly_renewal",
        "charge": "ch_journey_monthly_renewal",
        "billing_reason": "subscription_cycle"
      }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_monthly_renewal"
    And the donation with payment intent "pi_journey_monthly_renewal" should have amount 2500
    And the donation with payment intent "pi_journey_monthly_renewal" should have gift aid true

  Scenario: a BACS gift is claimable only after the pending mandate settles
    When I start checkout with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": true, "donorType": "individual",
        "declaration": { "firstName": "Ada", "lastName": "Bacs", "houseNameNumber": "12",
          "address": "Analytical Avenue, London", "postcode": "KA1 1AA", "nonUk": false } }
      """
    Then the response status should be 200
    When Stripe completes the checkout with:
      """
      { "payment_intent": "pi_journey_bacs", "amount_total": 5000, "payment_status": "unpaid" }
      """
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_bacs"
    And the donation with payment intent "pi_journey_bacs" should have a linked declaration
    And the donation with payment intent "pi_journey_bacs" should have claim status "not_eligible"
    When Stripe settles the pending payment as succeeded
    Then the response status should be 200
    And there should be exactly 1 donation with payment intent "pi_journey_bacs"
    And the donation with payment intent "pi_journey_bacs" should have claim status "eligible"

  Scenario: a partnership whose shares do not sum to the amount is rejected before checkout
    # The other rejects (monthly without 18+, company asserting Gift Aid, company missing
    # details) are covered by features/checkout.feature; this adds the partnership-sum reject.
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 10000, "giftAid": true, "donorType": "partnership",
        "partners": [
          { "firstName": "Ada", "lastName": "Partner", "houseNameNumber": "1",
            "address": "Partnership House, London", "postcode": "SW1A 1AA", "nonUk": false, "sharePence": 6000 },
          { "firstName": "Grace", "lastName": "Partner", "houseNameNumber": "1",
            "address": "Partnership House, London", "postcode": "SW1A 1AA", "nonUk": false, "sharePence": 3000 } ] }
      """
    Then the response status should be 400
