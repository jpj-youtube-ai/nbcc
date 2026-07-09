Feature: My Story page
  The service serves the public story-sharing page at its clean URL.

  Scenario: the My Story page is served at its clean URL
    When I GET "/my-story"
    Then the response status should be 200
    And the response body should contain "Share your story"

  Scenario: the raw .html path canonicalises to the clean URL
    When I GET "/my-story.html" without following redirects
    Then the response status should be 301
    And the response should redirect to "/my-story"
