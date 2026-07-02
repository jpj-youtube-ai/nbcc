@supporters @db
Feature: Public supporters wall (REQ-035)
  The /supporters page renders the real, donation-sourced donor list server-side.
  A non-anonymous individual and a non-anonymous company donor appear, labelled by
  name / business name; a donor who opted to be anonymous is NEVER shown. Donors are
  seeded through the signed Stripe webhook (the one write path), mirroring
  features/stripe-webhook.feature.

  Scenario: real non-anonymous donors appear, an anonymous donor never does
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_indiv",
        "object": "checkout.session",
        "amount_total": 5000,
        "currency": "gbp",
        "mode": "payment",
        "payment_intent": "pi_bdd_sup_indiv",
        "subscription": null,
        "metadata": { "mode": "once", "plan": "", "giftAid": "false", "fullName": "Zeta Supporter Bdd", "email": "zeta.sup.bdd@example.com", "emailConsent": "true", "anonymous": "false" },
        "customer_details": { "name": "Zeta Supporter Bdd", "email": "zeta.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_company",
        "object": "checkout.session",
        "amount_total": 2500,
        "currency": "gbp",
        "mode": "payment",
        "payment_intent": "pi_bdd_sup_company",
        "subscription": null,
        "metadata": { "mode": "once", "plan": "", "giftAid": "false", "donorType": "company", "businessName": "Beacon Supporter Bdd", "email": "beacon.sup.bdd@example.com", "emailConsent": "true", "anonymous": "false" },
        "customer_details": { "name": "Casey Supporter", "email": "beacon.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_anon",
        "object": "checkout.session",
        "amount_total": 9000,
        "currency": "gbp",
        "mode": "payment",
        "payment_intent": "pi_bdd_sup_anon",
        "subscription": null,
        "metadata": { "mode": "once", "plan": "", "giftAid": "false", "fullName": "Ghost Supporter Bdd", "email": "ghost.sup.bdd@example.com", "emailConsent": "true", "anonymous": "true" },
        "customer_details": { "name": "Ghost Supporter Bdd", "email": "ghost.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    When I GET "/supporters"
    Then the response status should be 200
    # The non-anonymous individual is listed by full name, the company by business name.
    And the response body should contain "Zeta Supporter Bdd"
    And the response body should contain "Beacon Supporter Bdd"
    And the response body should contain "Organisation"
    # The anonymous donor is NEVER rendered.
    But the response body should not contain "Ghost Supporter Bdd"
