Feature: Subscription plan change endpoint (REQ-055)
  POST /api/subscription/change-plan moves a monthly subscription up or down a
  tier: given { subscriptionId, plan } it swaps the subscription's single recurring
  item to the target plan's price with Stripe proration and returns the updated
  subscription. Unknown or missing fields are rejected with 400. (The offline stub
  in src/clients/stripe drives this end to end without a live Stripe account.)

  @stub-only
  # @stub-only: this happy path reaches Stripe with a fixture subscription id
  # (sub_demo_123) that exists only in the offline stub — a live Stripe test account
  # has no such subscription, so the real SDK 502s. It cannot run against a live
  # deployment; excluded from the staging BDD like @db and covered in pr.yml via the
  # offline stub. The two 400 validation scenarios below reject before touching Stripe,
  # so they stay live-safe and keep running against staging.
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
