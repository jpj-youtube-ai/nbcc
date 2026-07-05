@portal @db
Feature: Self-serve donor portal (REQ-061)
  A donor reaches the portal via a one-time, expiring magic-link token. Every route
  authenticates the token and rejects an invalid/expired one with 401. GET returns the
  donor's details + status; PATCH updates the editable fields.

  Scenario: a donor reads and updates their details with a valid token
    Given a donor "Ada Portal" with email "ada.portal.bdd@example.com" and a valid portal token
    When I GET the donor portal
    Then the portal response status should be 200
    And the portal response field "fullName" should be "Ada Portal"
    And the portal response field "email" should be "ada.portal.bdd@example.com"

    When I PATCH the donor portal:
      """
      { "fullName": "Ada Renamed", "anonymous": true }
      """
    Then the portal response status should be 200
    And the portal response field "fullName" should be "Ada Renamed"
    And the portal response field "anonymous" should be "true"

  Scenario: an expired token is rejected with 401
    Given a donor "Bob Portal" with email "bob.portal.bdd@example.com" and an expired portal token
    When I GET the donor portal
    Then the portal response status should be 401

  Scenario: a donor cancels Gift Aid, revoking their active declaration
    Given a donor "Cara Portal" with email "cara.portal.bdd@example.com" and a valid portal token
    And the donor has an active Gift Aid declaration
    When I POST to cancel the donor's Gift Aid
    Then the portal response status should be 200
    And the portal response field "cancelled" should be "true"
    And the donor's active declaration is revoked

    When I POST to cancel the donor's Gift Aid
    Then the portal response status should be 404

  Scenario: a subscription donor self-requests a portal link
    Given a subscription donor "Deb Portal" with email "deb.selfreq.portal.bdd@example.com"
    When I POST a portal access request for "deb.selfreq.portal.bdd@example.com"
    Then the portal response status should be 200
    And the portal response field "message" should be "If that email matches a supporter, we've sent a portal link."
    And a portal token exists for "deb.selfreq.portal.bdd@example.com"

  Scenario: an unknown email gets the same generic response and no link
    When I POST a portal access request for "nobody.selfreq.portal.bdd@example.com"
    Then the portal response status should be 200
    And the portal response field "message" should be "If that email matches a supporter, we've sent a portal link."
    And no portal token exists for "nobody.selfreq.portal.bdd@example.com"

  Scenario: a malformed email is rejected
    When I POST a portal access request for "not-an-email"
    Then the portal response status should be 400

  Scenario: a one-off donor (no subscription) self-requests a portal link
    Given a one-off donor "Fay Portal" with email "fay.oneoff.portal.bdd@example.com"
    When I POST a portal access request for "fay.oneoff.portal.bdd@example.com"
    Then the portal response status should be 200
    And the portal response field "message" should be "If that email matches a supporter, we've sent a portal link."
    And a portal token exists for "fay.oneoff.portal.bdd@example.com"
