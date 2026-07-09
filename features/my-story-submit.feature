@my-story-submit @db
Feature: My Story submission (Task B1)
  POST /api/my-story persists a submission to the SEPARATE `stories` database. Accepts
  both application/json (JS path) and application/x-www-form-urlencoded (no-JS native
  form POST). Invalid bodies (missing consent/confirm) are rejected with 400. A filled
  honeypot is silently accepted but never stored.

  Scenario: a valid JSON submission is accepted and persisted
    When I POST "/api/my-story" with JSON:
      """
      {
        "submitterRole": "supported",
        "storyText": "The Red Bag made such a difference to our Christmas this year (bdd-json).",
        "useScope": "internal_only",
        "confirmOver16": true
      }
      """
    Then the response status should be 200
    And the response body should contain "\"ok\":true"
    And the stories table should contain a story with text "The Red Bag made such a difference to our Christmas this year (bdd-json)."

  Scenario: a valid form-encoded submission is accepted and returns an HTML thank-you page
    When I POST the my-story form with storyText "The Red Bag made such a difference to our Christmas this year (bdd-form)."
    Then the response status should be 200
    And the response body should contain "Thank you"
    And the stories table should contain a story with text "The Red Bag made such a difference to our Christmas this year (bdd-form)."

  Scenario: a submission missing the required confirm is rejected
    When I POST "/api/my-story" with JSON:
      """
      {
        "submitterRole": "supported",
        "storyText": "Missing the confirm checkbox.",
        "useScope": "internal_only",
        "confirmOver16": false
      }
      """
    Then the response status should be 400
    And the stories table should not contain a story with text "Missing the confirm checkbox."

  Scenario: a honeypot-filled submission is silently accepted but nothing is stored
    When I POST "/api/my-story" with JSON:
      """
      {
        "submitterRole": "supported",
        "storyText": "A bot submission that should never be stored.",
        "useScope": "internal_only",
        "confirmOver16": true,
        "website": "http://spam.example"
      }
      """
    Then the response status should be 200
    And the stories table should not contain a story with text "A bot submission that should never be stored."
