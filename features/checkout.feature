Feature: Checkout session endpoint (REQ-029)
  POST /api/checkout-session turns the donate front-end payload
  ({ mode, plan, amount, giftAid }, REQ-028) into a Stripe Checkout session and
  returns its redirect { url }. Invalid bodies are rejected with 400.

  Scenario: a valid one-off donation returns a Stripe checkout URL
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": false, "email": "donor@example.com" }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

  Scenario: an embedded one-off donation returns an inline client secret and publishable key (TASK-215)
    # uiMode:"embedded" opens Stripe Embedded Checkout INLINE on nbcc.scot: the endpoint returns a
    # clientSecret (not a redirect url) plus the PUBLIC publishable key the browser needs to construct
    # Stripe.js. The hosted redirect above stays the default and the no-JS fallback, so this is purely
    # additive. Works in CI (offline stub returns a cs_ client secret) and against a real Stripe key.
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": false, "email": "donor@example.com", "uiMode": "embedded" }
      """
    Then the response status should be 200
    And the response field "clientSecret" should start with "cs_"
    And the response field "publishableKey" should start with "pk_"

  @stub-only
  Scenario: a valid monthly Gift Aid donation returns a session reflecting the opt-in
    # giftAid=true binds the verbatim HMRC wording onto the session metadata (TASK-053);
    # the offline stub reflects the opt-in in its preview URL, so this is asserted
    # without a live Stripe account. Monthly giving requires confirming 18 or over
    # (ageConfirmed, REQ-039/TASK-059). @stub-only: a preset plan maps to a
    # STRIPE_PRICE_* id, which on a live deployment is a real Stripe price the test
    # account need not have (staging's is a REPLACE_ME placeholder) — real Stripe then
    # rejects it (502). Excluded from the live-staging BDD like @db; covered in pr.yml
    # against the offline stub.
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "monthly", "plan": "gold", "amount": 5000, "giftAid": true, "ageConfirmed": true, "email": "donor@example.com" }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"
    And the response field "url" should contain "giftaid"

  Scenario: a monthly donation that does not confirm 18 or over is rejected (REQ-039)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "monthly", "plan": "gold", "amount": 5000, "giftAid": true, "email": "donor@example.com" }
      """
    Then the response status should be 400

  Scenario: an individual donation without an email is rejected (REQ-039: email mandatory)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "amount": 2500, "giftAid": false, "donorType": "individual" }
      """
    Then the response status should be 400

  Scenario: a valid monthly custom amount (no preset plan) returns a subscription URL (REQ-041)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "monthly", "plan": null, "amount": 3000, "giftAid": false, "ageConfirmed": true, "email": "donor@example.com" }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

  Scenario: a monthly donation with neither a plan nor an amount is rejected
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "monthly", "plan": null, "amount": null, "giftAid": false }
      """
    Then the response status should be 400

  Scenario: a company donation is accepted (companies take the no-Gift-Aid path, REQ-038)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 100000, "giftAid": false, "donorType": "company", "businessName": "Acme Ltd", "company": { "legalName": "Acme Ltd", "contactName": "Ada Lovelace", "contactEmail": "finance@acme.test", "billingAddress": "1 Office Park, London", "billingPostcode": "SW1A 1AA", "considerationGiven": false } }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

  # TASK-242: a MONTHLY company donation — the £100/month business case. The donate form maps its
  # individual/business radio to the server's donorType (company here) via currentDonorPath; posting
  # the raw "business" was rejected by the enum, so every business donation failed before the fix.
  Scenario: a monthly company donation is accepted (£100/month business, TASK-242)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "monthly", "plan": "platinum", "amount": 10000, "giftAid": false, "ageConfirmed": true, "donorType": "company", "businessName": "Beacon Trading Ltd", "email": "finance@beacon.test", "company": { "legalName": "Beacon Trading Ltd", "contactName": "Casey Finance", "contactEmail": "finance@beacon.test", "billingAddress": "1 Office Park, Glasgow", "billingPostcode": "G1 1AA", "considerationGiven": false } }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

  Scenario: a company donation without company details is rejected (REQ-038 / TASK-085)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 100000, "giftAid": false, "donorType": "company", "businessName": "Acme Ltd" }
      """
    Then the response status should be 400

  Scenario: a company donation asserting Gift Aid is rejected (REQ-038)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 100000, "giftAid": true, "donorType": "company", "businessName": "Acme Ltd" }
      """
    Then the response status should be 400
