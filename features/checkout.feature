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

  Scenario: a valid monthly donation returns a Stripe checkout URL
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "monthly", "plan": "gold", "amount": 5000, "giftAid": true }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

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
