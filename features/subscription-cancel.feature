@portal @db
Feature: Reduce-instead-then-cancel subscription flow (REQ-055)
  A donor cancels a monthly subscription from the portal via
  POST /api/portal/:token/subscription/cancel. Cancellation REQUIRES an explicit
  acknowledgement that reduce-instead was offered (accepted: 'reduce'|'cancel'); a
  missing/invalid one is 400. On 'cancel' the subscription is cancelled and returned.
  (The offline stub in src/clients/stripe drives this without a live Stripe account.)

  Scenario: cancelling without the reduce-instead acknowledgement is rejected
    Given a donor "Cara Cancel" with email "cara.portal.bdd@example.com" and a valid portal token
    When I POST to cancel the donor subscription:
      """
      { "subscriptionId": "sub_demo_123" }
      """
    Then the portal response status should be 400

  Scenario: cancelling with the acknowledgement returns the cancelled subscription
    Given a donor "Dan Cancel" with email "dan.portal.bdd@example.com" and a valid portal token
    When I POST to cancel the donor subscription:
      """
      { "subscriptionId": "sub_demo_123", "accepted": "cancel" }
      """
    Then the portal response status should be 200
    And the portal response field "status" should be "canceled"

  Scenario: an invalid portal token is rejected with 401
    Given a donor "Eve Cancel" with email "eve.portal.bdd@example.com" and an expired portal token
    When I POST to cancel the donor subscription:
      """
      { "subscriptionId": "sub_demo_123", "accepted": "cancel" }
      """
    Then the portal response status should be 401
