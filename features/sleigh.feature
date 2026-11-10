Feature: The Kilmarnock Santa Sleigh page
  /sleigh is the page on every poster and QR card: the nights, the year's total and a way to give.
  /santa-sleigh forwards to it for good. Stripe brings a giver back to /sleigh/thank-you. A Santa
  Sleigh gift goes through the same checkout as the donate page with one marker, sleigh. Every name
  and address here is invented.

  # The page is up until its switch off day (31 January 2027 unless staff change it), then forwards
  # to the home page; these run against the real clock, so after that day they are skipped.
  @while-sleigh-on
  Scenario: the page shows the 2026 nights and the give form
    When I request the site path "/sleigh"
    Then the site response status should be 200
    And the site response should contain "Kilmarnock Santa Sleigh 2026"
    And the site response should contain "New Farm"
    And the site response should contain "Caprington &amp; Grange"
    And the site response should contain "Timings TBC"
    And the site response should contain "id=\"slGive\""

  @while-sleigh-on
  Scenario: staff can see the thank you state before the last night, kept from search engines
    When I request the site path "/sleigh?at=after"
    Then the site response status should be 200
    And the site response should contain "Thank you, <em>Kilmarnock.</em>"
    And the site response noindex header should be set

  Scenario: the long address forwards to /sleigh for good, keeping the query string
    When I request the site path "/santa-sleigh"
    Then the site response should redirect permanently to "/sleigh"
    When I request the site path "/santa-sleigh?utm_medium=qr"
    Then the site response should redirect permanently to "/sleigh?utm_medium=qr"

  Scenario: the thank you is a plain one when the payment cannot be read
    When I request the site path "/sleigh/thank-you?session_id=cs_test_invented"
    Then the site response status should be 200
    And the site response should contain "<meta name=\"robots\" content=\"noindex\" />"

  Scenario: a Santa Sleigh gift is taken
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 1000, "giftAid": false, "email": "donor@example.com", "fullName": "Robin Example", "sleigh": true }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

  Scenario: a Santa Sleigh gift under £2 is refused
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 199, "giftAid": false, "email": "donor@example.com", "sleigh": true }
      """
    Then the response status should be 400
