Feature: Health endpoint
  The service exposes a health check used by the load balancer and the
  deployment smoke test.

  Scenario: service reports healthy
    When I GET "/health"
    Then the response status should be 200
    And the response field "status" should be "ok"

  Scenario: home page is served
    When I GET "/"
    Then the response status should be 200
    And the response body should contain "Charity Site"
