Feature: Subscription plan change endpoint (REQ-055)
  POST /api/subscription/change-plan moves a monthly subscription up or down a
  tier: given { subscriptionId, plan } it swaps the subscription's single recurring
  item to the target plan's price with Stripe proration and returns the updated
  subscription. Unknown or missing fields are rejected with 400. (The offline stub
  in src/clients/stripe drives this end to end without a live Stripe account.)

  Scenario: a valid plan change returns the updated subscription
    When I POST "/api/subscription/change-plan" with JSON:
      """
      { "subscriptionId": "sub_demo_123", "plan": "gold" }
      """
    Then the response status should be 200
    And the response field "id" should start with "sub"
    And the response field "status" should be "active"

  Scenario: an unknown plan is rejected
    When I POST "/api/subscription/change-plan" with JSON:
      """
      { "subscriptionId": "sub_demo_123", "plan": "diamond" }
      """
    Then the response status should be 400

  Scenario: a missing subscription id is rejected
    When I POST "/api/subscription/change-plan" with JSON:
      """
      { "plan": "gold" }
      """
    Then the response status should be 400
