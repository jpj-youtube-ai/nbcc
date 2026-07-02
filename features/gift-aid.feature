@gift-aid @db
Feature: Public Gift Aid declaration completion (REQ-048)
  A walk-in donor whose in-person (card_present) gift was recorded can complete a Gift Aid
  declaration via the token-scoped link in their confirmation email. GETting the link renders
  the form with the verbatim HMRC statement and does NOT complete it; only a valid POST
  persists the immutable declaration, links it, and sets declaration_status='completed'.

  Scenario: a GET renders the form without completing; a valid POST completes it
    # Seed an in-person donation with a receipt email, so TASK-075 stamps a token and sets
    # declaration_status='sent'.
    When I POST a signed Stripe "charge.succeeded" webhook event with id "evt_bdd_ga_1":
      """
      {
        "id": "ch_bdd_ga_1",
        "object": "charge",
        "amount": 5000,
        "currency": "gbp",
        "payment_intent": "pi_bdd_ga_1",
        "receipt_email": "ga.walkin.bdd@example.com",
        "payment_method_details": { "type": "card_present" }
      }
      """
    Then the response status should be 200
    And I capture the declaration token for payment intent "pi_bdd_ga_1"

    # GET renders the declaration form with the verbatim HMRC statement, and does NOT
    # advance declaration_status off 'sent'.
    When I GET the gift aid page for the captured token
    Then the response status should be 200
    And the response body should contain "I want to Gift Aid my donation"
    And the donation with payment intent "pi_bdd_ga_1" should have declaration status "sent"

    # A valid POST completes: persists the declaration, links it, sets 'completed'.
    When I POST the gift aid declaration for the captured token
    Then the response status should be 200
    And the donation with payment intent "pi_bdd_ga_1" should have declaration status "completed"
    And the donation with payment intent "pi_bdd_ga_1" should have a linked declaration
    And the donation with payment intent "pi_bdd_ga_1" should have gift aid true
