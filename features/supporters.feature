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

  Scenario: a grandfathered pre-223 donor stays on the wall without opting in (TASK-228)
    # A ONE-OFF gift (£90) from a donor who never opted in. Under the TASK-223 opt-in monthly rules this
    # donor would NOT appear — but the TASK-228 grandfather flag keeps everyone the OLD (pre-223) wall
    # showed, banded by their max paid amount (here £90 → a metal band), so they are not lost.
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_grand",
        "object": "checkout.session",
        "amount_total": 9000,
        "currency": "gbp",
        "mode": "payment",
        "payment_intent": "pi_bdd_sup_grand",
        "subscription": null,
        "metadata": { "mode": "once", "plan": "", "giftAid": "false", "fullName": "Grandfather Gwen Bdd", "email": "gwen.sup.bdd@example.com", "emailConsent": "true", "anonymous": "false" },
        "customer_details": { "name": "Grandfather Gwen Bdd", "email": "gwen.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    # The one-time backfill grandfathers the pre-223 supporters; here we set the same flag directly for
    # this donor (the migration snapshots real donors at deploy time — there is no app action for it).
    When the donor with email "gwen.sup.bdd@example.com" is grandfathered onto the supporters wall

    When I GET "/supporters"
    Then the response status should be 200
    # The grandfathered one-off donor appears by their name, even though they never opted in and give
    # one-off (not monthly).
    And the response body should contain "Grandfather Gwen Bdd"

  Scenario: an opted-in supporter drops off once their cancelled subscription passes the grace window (TASK-240)
    # Two monthly individuals (£25/mo) opt in and would both appear. One cancels 40 days ago (beyond the
    # 30-day grace) and drops off; the other cancelled just 5 days ago (within grace) and is kept.
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_gone",
        "object": "checkout.session",
        "amount_total": 2500,
        "currency": "gbp",
        "mode": "subscription",
        "payment_intent": null,
        "subscription": "sub_bdd_sup_gone",
        "metadata": { "mode": "monthly", "plan": "silver", "giftAid": "false", "fullName": "Faded Supporter Bdd", "email": "faded.sup.bdd@example.com", "emailConsent": "true", "anonymous": "false" },
        "customer_details": { "name": "Faded Supporter Bdd", "email": "faded.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_recent",
        "object": "checkout.session",
        "amount_total": 2500,
        "currency": "gbp",
        "mode": "subscription",
        "payment_intent": null,
        "subscription": "sub_bdd_sup_recent",
        "metadata": { "mode": "monthly", "plan": "silver", "giftAid": "false", "fullName": "Recent Supporter Bdd", "email": "recent.sup.bdd@example.com", "emailConsent": "true", "anonymous": "false" },
        "customer_details": { "name": "Recent Supporter Bdd", "email": "recent.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    When the donor with email "faded.sup.bdd@example.com" opts into the supporters wall as "Faded Supporter Bdd"
    When the donor with email "recent.sup.bdd@example.com" opts into the supporters wall as "Recent Supporter Bdd"
    When the donor with email "faded.sup.bdd@example.com" cancelled their subscription 40 days ago
    When the donor with email "recent.sup.bdd@example.com" cancelled their subscription 5 days ago

    When I GET "/supporters"
    Then the response status should be 200
    # Cancelled beyond the grace window → dropped; cancelled within grace → still shown.
    But the response body should not contain "Faded Supporter Bdd"
    And the response body should contain "Recent Supporter Bdd"

  Scenario: a supporter who cancelled long ago but is paying again stays on the wall (recovery, TASK-246)
    # A monthly individual (£25/mo) opts in. Their subscription carries a cancel from 60 days ago (well
    # beyond the 30-day grace), but their latest gift is dated AFTER that end (they are paying again), so
    # the recovery-aware active-sub check keeps them on the wall rather than dropping a still-paying donor.
    When I POST a signed Stripe "checkout.session.completed" webhook event:
      """
      {
        "id": "cs_bdd_sup_recovered",
        "object": "checkout.session",
        "amount_total": 2500,
        "currency": "gbp",
        "mode": "subscription",
        "payment_intent": null,
        "subscription": "sub_bdd_sup_recovered",
        "metadata": { "mode": "monthly", "plan": "silver", "giftAid": "false", "fullName": "Reborn Supporter Bdd", "email": "recovered.sup.bdd@example.com", "emailConsent": "true", "anonymous": "false" },
        "customer_details": { "name": "Reborn Supporter Bdd", "email": "recovered.sup.bdd@example.com" }
      }
      """
    Then the response status should be 200

    When the donor with email "recovered.sup.bdd@example.com" opts into the supporters wall as "Reborn Supporter Bdd"
    When the donor with email "recovered.sup.bdd@example.com" cancelled long ago but is paying again

    When I GET "/supporters"
    Then the response status should be 200
    # Paying again (gift after the old cancel) → kept, not dropped despite the 60-day-old cancel.
    And the response body should contain "Reborn Supporter Bdd"
