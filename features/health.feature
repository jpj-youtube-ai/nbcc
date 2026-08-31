Feature: Health endpoint
  The service exposes a health check used by the load balancer and the
  deployment smoke test.

  Scenario: service reports healthy
    When I GET "/health"
    Then the response status should be 200
    And the response field "status" should be "ok"

  Scenario: health says WHICH BUILD is running
    # TASK-332. Without this a deploy cannot tell "shipped" from "silently reverted": three
    # production deploys reported success while ECS quietly rolled back to the previous
    # containers, and the old build answered /health exactly as the new one would have.
    # The deploy's smoke test now asserts this value matches the commit it just built.
    When I GET "/health"
    Then the response field "version" should be present

  Scenario: home page is served
    When I GET "/"
    Then the response status should be 200
    And the response body should contain "Night Before Christmas Campaign"
