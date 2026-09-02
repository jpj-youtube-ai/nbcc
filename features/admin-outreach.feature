@admin @admin-outreach @db
Feature: Contacting local businesses (REQ-003 · TASK-401)
  A volunteer adds a local business, sees whether we already know them, writes a line of
  their own and sends one invitation. Reading is Viewer+; adding and sending are Editor+.
  Every rule that protects a business from us is enforced on the SERVER, not in the browser.

  Scenario: the list is not readable without a session
    When I GET the outreach list without a token
    Then the outreach response status should be 401

  Scenario: a Viewer may check for duplicates but may not add anyone
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    When I check the business "Zzbdd Joinery" as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the outreach response status should be 200
    When I add the business "Zzbdd Joinery" as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the outreach response status should be 403

  Scenario: an Editor adds a business, and it starts out not emailed
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    When I add the business "Zzbdd Joinery" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 201
    And the outreach business should not have been emailed

  # The reason this endpoint exists. A volunteer who has never seen the earlier conversation
  # gets told, before they commit anything, that this firm has already said no.
  Scenario: a business that told us no is refused until a volunteer says it is a different firm
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the business "Zzbdd Bakery" told us not to contact them again
    When I check the business "Zzbdd Bakery Ltd" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach response should say do not contact
    When I add the business "Zzbdd Bakery Ltd" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 409
    When I add the business "Zzbdd Bakery Ltd" acknowledging the matches as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 201

  # The preview goes through the same builder as the send, so what a volunteer approves on
  # screen is what the business receives.
  Scenario: the preview is the real email, personal message and all
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    When I preview the invitation to "Zzbdd Joinery" saying "We met at the Chamber breakfast." as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the preview should contain "Zzbdd Joinery"
    And the preview should contain "We met at the Chamber breakfast."
    And the preview should contain "SC047995"

  Scenario: a business with no email address cannot be sent to
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the business "Zzbdd Roofing" was added without an email address
    When I send the invitation as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 400

  # Two volunteers can open the same business at once. The second send is a fact, not a scolding.
  Scenario: a business is never emailed twice
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the business "Zzbdd Plumbing" was added with email "hello@zzbddplumbing.example"
    When I send the invitation as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach business should have been emailed
    When I send the invitation as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 409
