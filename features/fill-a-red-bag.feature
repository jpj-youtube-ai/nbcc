@fill-a-red-bag
Feature: Fill a Red Bag, listed for search engines but linked from nowhere
  /fill is a new way to give: fill a list of example items, watch a red bag fill, and give the
  total. It is public (one constant, src/red-bag/switch.ts) and search engines may list it, so it is
  on the site map; but nothing on the site links to it yet. Its thank you is a page of its own,
  /fill/thank-you, which is never indexed. The address it first had, /fill-a-red-bag, and
  /fill-a-bag forward to /fill. The checkout takes a Red Bag gift from anyone. A Red Bag gift is
  never less than £2, and is never also a gift on a fundraising page.

  Scenario: the page is there for anyone, at /fill
    When I request the site path "/fill"
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

  Scenario: search engines may list it
    When I request the site path "/fill"
    Then the site response status should be 200
    And the site response should not contain "noindex"
    And the site response should contain "https://nbcc.scot/fill"

  Scenario: the thank you is a page of its own, and is never indexed
    When I request the site path "/fill/thank-you"
    Then the site response status should be 200
    And the site response should contain "Thank you for filling a Red Bag"
    And the site response should contain "Fill another bag"
    And the site response noindex header should be set
    And the site response should contain "noindex, nofollow"
    And the site response should not contain "Pop these in the bag"

  Scenario: the address it first had forwards to /fill for good
    When I request the site path "/fill-a-red-bag"
    Then the site response should redirect permanently to "/fill"

  Scenario: the other way people type it forwards to /fill for good
    When I request the site path "/fill-a-bag"
    Then the site response should redirect permanently to "/fill"

  Scenario: the forwarding addresses keep the query string
    When I request the site path "/fill-a-red-bag?utm_source=bdd&utm_medium=poster"
    Then the site response should redirect permanently to "/fill?utm_source=bdd&utm_medium=poster"
    When I request the site path "/fill-a-bag?utm_source=bdd"
    Then the site response should redirect permanently to "/fill?utm_source=bdd"

  Scenario: an old return from paying still lands on a thank you
    When I request the site path "/fill-a-red-bag?thanks=1&session_id=cs_test_bdd"
    Then the site response should redirect permanently to "/fill/thank-you?thanks=1&session_id=cs_test_bdd"

  Scenario: the pages' own files are not served
    When I request the site path "/fill-a-red-bag.html"
    Then the site response status should be 404
    When I request the site path "/fill-thank-you.html"
    Then the site response status should be 404

  Scenario: it is on the site map, and its thank you is not
    When I request the site path "/sitemap.xml"
    Then the site response status should be 200
    And the site response should contain "https://nbcc.scot/fill</loc>"
    And the site response should not contain "fill/thank-you"
    And the site response should not contain "fill-a-red-bag"
    When I request the site path "/sitemap"
    Then the site response status should be 200
    And the site response should contain "Fill a Red Bag"
    And the site response should not contain "fill/thank-you"

  Scenario: the donate page does not link to it yet
    When I request the site path "/donate"
    Then the site response status should be 200
    And the site response should not contain "fill-a-red-bag"
    And the site response should not contain 'href="/fill"'

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
