Feature: Checkout session endpoint (REQ-029)
  POST /api/checkout-session turns the donate front-end payload
  ({ mode, plan, amount, giftAid }, REQ-028) into a Stripe Checkout session and
  returns its redirect { url }. Invalid bodies are rejected with 400.

  Scenario: a valid one-off donation returns a Stripe checkout URL
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5000, "giftAid": false }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

  Scenario: a valid monthly Gift Aid donation returns a session reflecting the opt-in
    # giftAid=true binds the verbatim HMRC wording onto the session metadata (TASK-053);
    # the offline stub reflects the opt-in in its preview URL, so this is asserted
    # without a live Stripe account. Monthly giving requires confirming 18 or over
    # (ageConfirmed, REQ-039/TASK-059).
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "monthly", "plan": "gold", "amount": 5000, "giftAid": true, "ageConfirmed": true }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"
    And the response field "url" should contain "giftaid"

  Scenario: a monthly donation that does not confirm 18 or over is rejected (REQ-039)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "monthly", "plan": "gold", "amount": 5000, "giftAid": true }
      """
    Then the response status should be 400

  Scenario: an invalid body is rejected
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "monthly", "plan": null, "amount": null, "giftAid": false }
      """
    Then the response status should be 400

  Scenario: a company donation is accepted (companies take the no-Gift-Aid path, REQ-038)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 100000, "giftAid": false, "donorType": "company", "businessName": "Acme Ltd" }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

  Scenario: a company donation asserting Gift Aid is rejected (REQ-038)
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 100000, "giftAid": true, "donorType": "company", "businessName": "Acme Ltd" }
      """
    Then the response status should be 400
