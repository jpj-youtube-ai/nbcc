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
          "address": "St Helier, Jersey", "nonUk": true } }
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
