Feature: Red bags at the Festive Ball, the checkout
  At the Festive Ball guests scan a table card to /bag and give £50 a red bag. The gift goes through
  the same checkout as the donate page, POST /api/checkout-session, with one optional marker,
  ballBags: the number of bags, 1 to 20. The server sets the amount from it, whatever the browser
  sends, and the gift is always paid on Stripe's own page. A gift without the marker is untouched.
  Every name and address here is invented.

  Scenario: a red bags gift is taken, with no amount sent
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "giftAid": false, "email": "donor@example.com", "fullName": "Robin Example", "ballBags": 3 }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

  Scenario: a red bags gift goes to Stripe's own page even when our page is asked for
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 1, "giftAid": false, "email": "donor@example.com", "ballBags": 2, "uiMode": "embedded" }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"
    And the response field "clientSecret" should be missing

  @stub-only
  Scenario: a red bags gift is marked with the number of bags, and priced by the server
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 1, "giftAid": false, "email": "donor@example.com", "ballBags": 3 }
      """
    Then the response status should be 200
    And the session metadata field "ballBags" should be "3"
    And the session metadata field "mode" should be "once"
    And the session metadata field "feeCoverPence" should be "0"
    And the session metadata should have no field "redBag"
    And the session metadata should have no field "ball"

  Scenario Outline: a red bags gift outside the rules is refused
    When I POST "/api/checkout-session" with JSON:
      """
      <body>
      """
    Then the response status should be 400
    And the response field "error" should be "Invalid checkout request"

    Examples:
      | body                                                                                                                           |
      | { "mode": "once", "plan": null, "giftAid": false, "email": "donor@example.com", "ballBags": 0 }                                |
      | { "mode": "once", "plan": null, "giftAid": false, "email": "donor@example.com", "ballBags": 21 }                               |
      | { "mode": "monthly", "plan": null, "giftAid": false, "email": "donor@example.com", "ageConfirmed": true, "ballBags": 2 }        |
      | { "mode": "once", "plan": null, "giftAid": false, "email": "donor@example.com", "ballBags": 2, "redBag": true }                |
      | { "mode": "once", "plan": null, "giftAid": false, "email": "donor@example.com", "ballBags": 2, "ball": true }                  |
      | { "mode": "once", "plan": null, "giftAid": false, "email": "donor@example.com", "ballBags": 2, "fundraiserId": 1 }             |
      | { "mode": "once", "plan": null, "giftAid": false, "ballBags": 2 }                                                              |

  Scenario: a gift without the marker still needs an amount, exactly as before
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "giftAid": false, "email": "donor@example.com" }
      """
    Then the response status should be 400

  # The page a table card's QR code opens, and the thank you Stripe brings a guest back to. Both are
  # open until the end of Sunday 8 November 2026 in the UK, then forward to /fill.
  @while-bags-open
  Scenario: the red bags page is open to anyone, with the Ball's gate shut, and kept from search engines
    Given the ball gate is closed
    When I request "/bag"
    Then the ball page status should be 200
    And the ball page should contain "Thank you for being here tonight"
    And the ball page should contain "<meta name=\"robots\" content=\"noindex\" />"
    And the ball page should contain "id=\"bbForm\""

  @while-bags-open
  Scenario: the red bags thank you is a plain thank you when the payment cannot be read
    When I request "/bag/thank-you?session_id=cs_test_invented"
    Then the ball page status should be 200
    And the ball page should contain "Enjoy the rest of your night."
    And the ball page should contain "<meta name=\"robots\" content=\"noindex\" />"
