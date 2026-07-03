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
