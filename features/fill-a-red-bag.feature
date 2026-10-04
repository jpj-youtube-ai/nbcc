@fill-a-red-bag
Feature: Fill a Red Bag, public but linked from nowhere
  /fill-a-red-bag is a new way to give: fill a list of example items, watch a red bag fill, and give
  the total. It is public (one constant, src/red-bag/switch.ts), but for now nothing links to it,
  it is on no site map and it tells search engines to leave it alone: people reach it only if they
  are given the address. The checkout takes a Red Bag gift from anyone. A Red Bag gift is never
  less than £2, and is never also a gift on a fundraising page.

  Scenario: the page is there for anyone who has the address
    When I request the site path "/fill-a-red-bag"
    Then the site response status should be 200
    And the site response should contain "Fill a Red Bag"
    And the site response should contain "Pop these in the bag"
    # The list is in the page itself, drawn by the server.
    And the site response should contain "Home comforts"
    And the site response should contain "rb-paper"
    # Nothing of the staff preview, and not the page not found page.
    And the site response should not contain "Staff preview"
    And the site response should not contain "We cannot find that page"
    And the site response should not contain "red-bag-preview.js"

  Scenario: it tells search engines to leave it alone while it is unlisted
    When I request the site path "/fill-a-red-bag"
    Then the site response status should be 200
    And the site response noindex header should be set
    And the site response should contain "noindex, nofollow"

  Scenario: the page's own file is not served
    When I request the site path "/fill-a-red-bag.html"
    Then the site response status should be 404

  Scenario: it is on no site map
    When I request the site path "/sitemap.xml"
    Then the site response status should be 200
    And the site response should not contain "fill-a-red-bag"
    When I request the site path "/sitemap"
    Then the site response status should be 200
    And the site response should not contain "fill-a-red-bag"

  Scenario: the donate page does not link to it yet
    When I request the site path "/donate"
    Then the site response status should be 200
    And the site response should not contain "fill-a-red-bag"

  Scenario: a Red Bag gift under £2 is refused
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 199, "giftAid": false, "email": "donor@example.com", "redBag": true }
      """
    Then the response status should be 400
    And the response field "error" should be "Invalid checkout request"

  Scenario: a Red Bag gift from the public is taken
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5410, "giftAid": false, "email": "donor@example.com", "redBag": true }
      """
    Then the response status should be 200
    And the response field "url" should start with "https://"

  @stub-only
  Scenario: a Red Bag gift is marked, and is otherwise an ordinary donation
    When I POST "/api/checkout-session" with JSON:
      """
      { "mode": "once", "plan": null, "amount": 5410, "giftAid": false, "email": "donor@example.com", "redBag": true }
      """
    Then the response status should be 200
    And the session metadata field "redBag" should be "true"
    And the session metadata field "mode" should be "once"
    And the session metadata field "feeCoverPence" should be "0"

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
