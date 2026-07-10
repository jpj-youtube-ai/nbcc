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

  Scenario: an enquiry missing required fields is rejected
    When I POST "/api/contact" with JSON:
      """
      { "firstName": "", "lastName": "", "email": "not-an-email", "message": "" }
      """
    Then the response status should be 400
