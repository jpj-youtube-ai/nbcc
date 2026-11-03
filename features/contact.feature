Feature: Contact endpoint (REQ-030, 2026-07-10 contact-inbox)
  POST /api/contact validates a website enquiry ({ firstName, lastName, email,
  message }, REQ-027) and STORES it in the isolated contact database (no external
  forward). Invalid bodies are rejected with 400. (Reuses the JSON-POST step from
  checkout.steps.js.)

  Scenario: a valid enquiry is accepted
    When I POST "/api/contact" with JSON:
      """
      { "firstName": "Ada", "lastName": "Lovelace", "email": "ada@example.com", "message": "Happy to help at Christmas." }
      """
    Then the response status should be 200
    And the response field "status" should be "sent"

  # TASK-565: the phone number is optional. One that is given is stored; one that is not a phone
  # number is refused, and nothing is stored.
  Scenario: an enquiry with a phone number is accepted
    When I POST "/api/contact" with JSON:
      """
      { "firstName": "Ada", "lastName": "Example", "email": "ada@example.com", "phone": "07700 900123", "message": "Please call me back." }
      """
    Then the response status should be 200
    And the response field "status" should be "sent"

  Scenario: an enquiry whose phone number is not a phone number is rejected
    When I POST "/api/contact" with JSON:
      """
      { "firstName": "Ada", "lastName": "Example", "email": "ada@example.com", "phone": "call me", "message": "Please call me back." }
      """
    Then the response status should be 400

  Scenario: an enquiry missing required fields is rejected
    When I POST "/api/contact" with JSON:
      """
      { "firstName": "", "lastName": "", "email": "not-an-email", "message": "" }
      """
    Then the response status should be 400

  # TASK-490: the contact page asks whether the spam check is on. CI runs with both Turnstile keys
  # unset, so it is off there and the page is told there is no site key (and draws no box).
  Scenario: the page is told the spam check is off when no keys are set
    When I GET "/api/contact/captcha"
    Then the response status should be 200
    And the response body should contain '{"siteKey":null}'
