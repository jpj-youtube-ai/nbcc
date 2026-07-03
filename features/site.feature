Feature: Marketing site served by the app
  The service serves the static pages at their clean URLs and exposes the
  two marketing API endpoints (stubbed until REQ-029 / REQ-030).

  Scenario Outline: clean URLs serve the right page
    When I GET "<path>"
    Then the response status should be 200
    And the response body should contain "<marker>"

    Examples:
      | path        | marker        |
      | /           | Christmas Eve |
      | /about-us   | About         |
      | /donate     | Donate        |
      | /contact    | Contact       |
      | /supporters | Supporters    |
      | /donate/thank-you | Thank you |
      | /donor-portal | Manage your support |
      | /privacy    | Privacy notice |

  Scenario Outline: raw .html paths canonicalise to the clean URL
    When I GET "<path>" without following redirects
    Then the response status should be 301
    And the response should redirect to "<location>"

    Examples:
      | path             | location    |
      | /index.html      | /           |
      | /about.html      | /about-us   |
      | /donate.html     | /donate     |
      | /contact.html    | /contact    |
      | /supporters.html | /supporters |
      | /thank-you.html  | /donate/thank-you |
      | /portal.html     | /donor-portal |
      | /privacy.html    | /privacy |

  Scenario: the shared stylesheet is served from /assets
    When I GET "/assets/css/styles.css"
    Then the response status should be 200

  # Both marketing API endpoints are now implemented: /api/checkout-session
  # (REQ-029) is covered by checkout.feature and /api/contact (REQ-030) by
  # contact.feature.
