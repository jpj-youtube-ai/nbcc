@admin @db
Feature: Role-gated admin actions on a donor's behalf (REQ-062)
  An authenticated staff user acts on a donor via /api/admin/donors/:id. Every route
  needs a valid admin session token (401 otherwise), and the role gates writes: a
  Viewer is read-only (403 on any write), an Editor or Admin may write.

  Background:
    Given a donor "Ada Behalf" with email "ada.behalf.admin.bdd@example.com"

  Scenario: no token is rejected with 401
    When I GET the admin donor without a token
    Then the admin response status should be 401

  Scenario: a Viewer can read but not write
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    When I GET the admin donor as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 200
    When I PATCH the admin donor full name to "Ada Renamed" as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 403

  Scenario: an Editor can update the donor
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    When I PATCH the admin donor full name to "Ada Edited" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the admin response field "fullName" should be "Ada Edited"

  Scenario: an Editor corrects a donor's declaration address (amend, not revise)
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the admin donor has an active Gift Aid declaration
    When I PATCH the admin donor declaration as "editor.admin.bdd@example.com" with password "edit-pw-123":
      """
      { "firstName": "Ada", "lastName": "Behalf", "houseNameNumber": "12", "address": "New Road, Ayr", "postcode": "KA7 1AA", "nonUk": false }
      """
    Then the admin response status should be 200
    And the donor's active declaration address should be "New Road, Ayr"
    And the donor's declaration is not revoked

  Scenario: a Viewer can search donors and finds the seeded donor
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    When I search admin "donors" for "Ada Behalf" as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 200
    And the admin search results are not empty

  Scenario: search without a token is rejected with 401
    When I search admin "donors" for "Ada Behalf" without a token
    Then the admin response status should be 401

  Scenario: an Editor submits an open claim batch
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And an open claim batch
    When I submit the claim batch as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the admin response field "submitted" should be "true"

  Scenario: a Viewer cannot submit a claim batch
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    And an open claim batch
    When I submit the claim batch as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 403

  Scenario: a Viewer can list the adjustment-due queue
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    When I GET the admin adjustment-due queue as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 200

  Scenario Outline: a Viewer can read the retention and awaiting-declaration queues
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    When I GET the admin queue "<queue>" as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 200

    Examples:
      | queue                |
      | retention-expiry     |
      | awaiting-declaration |
      | gasds-deadline       |
      | declaration-review   |

  Scenario Outline: the admin queues reject a missing token with 401
    When I GET the admin queue "<queue>" without a token
    Then the admin response status should be 401

    Examples:
      | queue                |
      | retention-expiry     |
      | awaiting-declaration |
      | gasds-deadline       |
      | declaration-review   |

  Scenario Outline: a Viewer can read the dashboard lists (REQ-066)
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    When I GET the admin path "<path>" as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 200

    Examples:
      | path                             |
      | /api/admin/donations             |
      | /api/admin/claim-batches         |
      | /api/admin/audit                 |
      | /api/admin/subscriptions/dunning |

  Scenario Outline: the dashboard lists reject a missing token with 401
    When I GET the admin path "<path>" without a token
    Then the admin response status should be 401

    Examples:
      | path                             |
      | /api/admin/donations             |
      | /api/admin/claim-batches         |
      | /api/admin/audit                 |
      | /api/admin/subscriptions/dunning |

  Scenario: an Editor can export a claim batch as Charities Online CSV (REQ-052/066)
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And an open claim batch
    When I export the claim batch as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the admin response content type should contain "text/csv"

  Scenario: a Viewer cannot export a claim batch (Editor and up only)
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    And an open claim batch
    When I export the claim batch as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the admin response status should be 403

  @claims-pipeline
  Scenario: an Editor claims eligible donations end to end and exports a non-empty CSV
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And an eligible Gift-Aided donation
    When I create a claim batch as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 201
    And the created claim batch id is returned
    When I add the eligible donation to the batch as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    When I export the claim batch to CSV as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the exported CSV has at least 1 data row
