@site-pages @db
Feature: Site addressing (site-pages feature)
  Unknown addresses first try the spare-address table (a quiet hop to the right page), then land
  on a branded page-not-found with a real 404 status. The /sitemap page and sitemap.xml are
  generated from the page registry; admins choose which pages search engines see.

  Scenario: a mistyped address gets the branded 404, with the right status
    When I request the site path "/no-such-page"
    Then the site response status should be 404
    And the site response should contain "We cannot find that page"
    # The way out matters more than the wording on it: a 404 that offers nowhere to go is a
    # dead end.
    And the site response should contain "Where would you like to go?"
    # And it has to be on the site's page shell. Without page-top the heading sits under the
    # fixed header; without the reading column the copy runs the full width of the window.
    And the site response should contain "page-top"
    And the site response should contain "page-prose"

  Scenario: an unknown API path gets a JSON 404, never an HTML page
    When I request the site path "/api/no-such-endpoint"
    Then the site response status should be 404
    And the site response should be JSON with error "Not found"

  Scenario: the seeded spare addresses hop to the canonical page
    When I request the site path "/about"
    Then the site response should redirect permanently to "/about-us"
    When I request the site path "/mystory"
    Then the site response should redirect permanently to "/my-story"
    When I request the site path "/give"
    Then the site response should redirect permanently to "/donate"

  Scenario: an admin adds a spare address and it works immediately; guard rails hold
    Given a newsletter admin "site.admin.bdd@example.com" with role "admin" and password "pw-sp"
    When I add a spare address "/festive" pointing at "/donate"
    Then the site pages response status should be 201
    When I request the site path "/festive"
    Then the site response should redirect permanently to "/donate"
    # A spare address may never shadow a real page or system route.
    When I add a spare address "/donate" pointing at "/about-us"
    Then the site pages response status should be 400
    When I add a spare address "/api/steal" pointing at "/donate"
    Then the site pages response status should be 400

  Scenario: editing site addressing needs the site permission at edit level
    Given a newsletter admin "site.editor.bdd@example.com" with role "editor" and password "pw-sp2"
    When I add a spare address "/blocked" pointing at "/donate"
    Then the site pages response status should be 403

  Scenario: the sitemap page lists the public pages and stays out of search engines
    When I request the site path "/sitemap"
    Then the site response status should be 200
    And the site response should contain "Site map"
    And the site response should contain "/about-us"
    And the site response noindex header should be set

  Scenario: sitemap.xml respects the admin's visibility choices
    Given a newsletter admin "site.seo.bdd@example.com" with role "admin" and password "pw-sp3"
    When I request the site path "/sitemap.xml"
    Then the site response status should be 200
    And the site response should contain "https://nbcc.scot/about-us"
    And the site response should not contain "/donor-portal"
    When I set the search visibility of "/about-us" to hidden
    And I request the site path "/sitemap.xml"
    Then the site response should not contain "https://nbcc.scot/about-us"
    When I set the search visibility of "/about-us" to shown
    And I request the site path "/sitemap.xml"
    Then the site response should contain "https://nbcc.scot/about-us"
