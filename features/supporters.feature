@supporters @db
Feature: Public supporters wall (REQ-035; opt-in monthly 4-band rework TASK-223)
  The /supporters page renders the real, donation-sourced supporter list server-side, but only for
  supporters who OPTED IN and give MONTHLY. A monthly individual who opted in appears by their chosen
  name; a monthly business that opted in appears by its business credit name, labelled Organisation.
  A one-off donor NEVER appears (the wall is monthly-only now), and an anonymous donor NEVER appears
  even if they opted in. Donors are seeded through the signed Stripe webhook (the one write path);
  opt-in is set the way the app sets it (donors.list_on_supporters for an individual; the business
  fulfilment record's list_on_supporters + captured_at for a business).

  Scenario: opted-in monthly supporters appear; a one-off and an anonymous donor never do
    # A monthly BUSINESS gift (company, £50/mo) — the webhook creates the donor, the monthly paid
    # donation, and the business_supporter_fulfilment record.
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_biz",
        "object": "checkout.session",
        "amount_total": 5000,
        "currency": "gbp",
        "mode": "subscription",
        "payment_intent": null,
        "subscription": "sub_bdd_sup_biz",
        "metadata": { "mode": "monthly", "plan": "gold", "giftAid": "false", "donorType": "company", "businessName": "Beacon Supporter Bdd", "email": "beacon.sup.bdd@example.com", "emailConsent": "true", "anonymous": "false" },
        "customer_details": { "name": "Casey Supporter", "email": "beacon.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    # A monthly INDIVIDUAL gift (£25/mo).
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_indiv",
        "object": "checkout.session",
        "amount_total": 2500,
        "currency": "gbp",
        "mode": "subscription",
        "payment_intent": null,
        "subscription": "sub_bdd_sup_indiv",
        "metadata": { "mode": "monthly", "plan": "silver", "giftAid": "false", "fullName": "Zeta Supporter Bdd", "email": "zeta.sup.bdd@example.com", "emailConsent": "true", "anonymous": "false" },
        "customer_details": { "name": "Zeta Supporter Bdd", "email": "zeta.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    # A ONE-OFF gift (£90) — must never appear on the monthly-only wall, even opted in.
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_once",
        "object": "checkout.session",
        "amount_total": 9000,
        "currency": "gbp",
        "mode": "payment",
        "payment_intent": "pi_bdd_sup_once",
        "subscription": null,
        "metadata": { "mode": "once", "plan": "", "giftAid": "false", "fullName": "Odette Oneoff Bdd", "email": "odette.sup.bdd@example.com", "emailConsent": "true", "anonymous": "false" },
        "customer_details": { "name": "Odette Oneoff Bdd", "email": "odette.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    # A monthly INDIVIDUAL who is ANONYMOUS — opts in below, but must still never appear.
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_anon",
        "object": "checkout.session",
        "amount_total": 9000,
        "currency": "gbp",
        "mode": "subscription",
        "payment_intent": null,
        "subscription": "sub_bdd_sup_anon",
        "metadata": { "mode": "monthly", "plan": "platinum", "giftAid": "false", "fullName": "Ghost Supporter Bdd", "email": "ghost.sup.bdd@example.com", "emailConsent": "true", "anonymous": "true" },
        "customer_details": { "name": "Ghost Supporter Bdd", "email": "ghost.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    # Opt in the way the app does: the individual via donors.list_on_supporters, the business via its
    # fulfilment record (list_on_supporters + captured_at). The one-off donor is not opted in and the
    # anonymous donor, though opted in, stays anonymous.
    When the donor with email "zeta.sup.bdd@example.com" opts into the supporters wall as "Zeta Supporter Bdd"
    When the business with email "beacon.sup.bdd@example.com" opts into the supporters wall as "Beacon Trading Bdd"
    When the donor with email "ghost.sup.bdd@example.com" opts into the supporters wall as "Ghost Supporter Bdd"

    When I GET "/supporters"
    Then the response status should be 200
    # The opted-in monthly individual is listed by their chosen name; the business by its credit name.
    And the response body should contain "Zeta Supporter Bdd"
    And the response body should contain "Beacon Trading Bdd"
    And the response body should contain "Organisation"
    # The one-off donor is monthly-only-excluded; the anonymous donor is never rendered.
    But the response body should not contain "Odette Oneoff Bdd"
    And the response body should not contain "Ghost Supporter Bdd"
