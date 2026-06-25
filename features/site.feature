Feature: Marketing site served by the app
  The service serves the four static pages at their clean URLs and exposes the
  two marketing API endpoints (stubbed until REQ-029 / REQ-030).

  Scenario Outline: clean URLs serve the right page
    When I GET "<path>"
    Then the response status should be 200
    And the response body should contain "<marker>"

    Examples:
      | path      | marker                  |
      | /         | Christmas Eve           |
      | /about-us | About                   |
      | /donate   | Donate                  |
      | /contact  | Contact                 |

  Scenario Outline: raw .html paths canonicalise to the clean URL
    When I GET "<path>" without following redirects
    Then the response status should be 301
    And the response should redirect to "<location>"

    Examples:
      | path          | location  |
      | /index.html   | /         |
      | /about.html   | /about-us |
      | /donate.html  | /donate   |
      | /contact.html | /contact  |

  Scenario: the shared stylesheet is served from /assets
    When I GET "/assets/css/styles.css"
    Then the response status should be 200

  Scenario Outline: API endpoints are wired but not yet implemented
    When I POST "<path>"
    Then the response status should be 501

    Examples:
      | path                  |
      | /api/checkout-session |
      | /api/contact          |
