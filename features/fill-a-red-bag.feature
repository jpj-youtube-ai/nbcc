@fill-a-red-bag
Feature: Fill a Red Bag, switched off as it ships
  /fill-a-red-bag is a new way to give: fill a list of example items, watch a red bag fill, and give
  the total. It ships switched off (one constant, src/red-bag/switch.ts). While it is off the public
  is given the site's ordinary page not found page at its address, it is on no site map, and the
  checkout refuses a Red Bag gift from the public. A Red Bag gift is never less than £2.

  Scenario: the page is the site's own 404 to the public while it is switched off
    When I request the site path "/fill-a-red-bag"
    Then the site response status should be 404
    And the site response should contain "We cannot find that page"
    And the site response should contain "Where would you like to go?"
    # Nothing of the page itself is in what the public is sent.
    And the site response should not contain "rb-paper"
    And the site response should not contain "Staff preview"
    And the site response noindex header should be set

  Scenario: the page's own file is not served either
    When I request the site path "/fill-a-red-bag.html"
    Then the site response status should be 404

  Scenario: it is on no site map while it is switched off
    When I request the site path "/sitemap.xml"
    Then the site response status should be 200
    And the site response should not contain "fill-a-red-bag"
    When I request the site path "/sitemap"
    Then the site response status should be 200
    And the site response should not contain "fill-a-red-bag"

  Scenario: a Red Bag gift under £2 is refused
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 199, "giftAid": false, "email": "donor@example.com", "redBag": true }
      """
    Then the response status should be 400
    And the response field "error" should be "Invalid checkout request"

  Scenario: a Red Bag gift from the public is refused while it is switched off
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5410, "giftAid": false, "email": "donor@example.com", "redBag": true }
      """
    Then the response status should be 403
    And the response field "error" should be "Fill a Red Bag is not open yet"

  Scenario: a Red Bag gift is never also a gift on a fundraising page
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5410, "giftAid": false, "email": "donor@example.com", "redBag": true, "fundraiserId": 1 }
      """
    Then the response status should be 400

  Scenario: the same gift without the marker is an ordinary donation, exactly as before
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5410, "giftAid": false, "email": "donor@example.com" }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"
