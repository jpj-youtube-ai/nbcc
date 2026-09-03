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

  # The third source the matcher reads, and the one nothing exercised until this scenario: a
  # business that ALREADY gives us money. Cold-pitching an existing supporter is the most
  # embarrassing mistake this screen exists to prevent.
  Scenario: a business that already gives us money is flagged, not cold-pitched
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And "Zzbdd Motors" already gives us money
    When I check the business "Zzbdd Motors Ltd" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach response should match a business we already know

  # A company that started a checkout and never paid has given us nothing. Warning a volunteer off
  # it would cost us the very approach worth making.
  Scenario: a business that started a payment and never finished it is not treated as a supporter
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And "Zzbdd Glazing" started a payment that never went through
    When I check the business "Zzbdd Glazing" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach response should find nothing

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

  # TASK-405: the one list a volunteer opens. What is on it is a pure rule, proved DB-free in
  # test/unit/outreach-todo.test.ts; what only a running server can prove is WHOSE list it is.
  Scenario: the list defaults to mine and anything nobody owns
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And "Zzbdd Mine" was emailed 30 days ago and belongs to "editor.admin.bdd@example.com"
    And "Zzbdd Nobody" was emailed 30 days ago and belongs to nobody
    And "Zzbdd Theirs" was emailed 30 days ago and belongs to "someone.else@example.com"
    When I open the list of what needs doing as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the list should include "Zzbdd Mine"
    And the list should include "Zzbdd Nobody"
    But the list should not include "Zzbdd Theirs"

  # Nothing falls through: a business nobody owns is still somebody's problem, and the count says
  # so before you have to click to find out.
  Scenario: everyone's list shows the lot, and the count says what is behind the toggle
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And "Zzbdd Mine" was emailed 30 days ago and belongs to "editor.admin.bdd@example.com"
    And "Zzbdd Theirs" was emailed 30 days ago and belongs to "someone.else@example.com"
    When I open everyone's list of what needs doing as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the list should include "Zzbdd Mine"
    And the list should include "Zzbdd Theirs"

  Scenario: a business that said no never appears, however long ago it was
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And "Zzbdd Refused" was emailed 300 days ago and belongs to nobody
    When I record the outcome "declined" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    And I open everyone's list of what needs doing as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the list should not include "Zzbdd Refused"

  Scenario: the list is not readable without a session
    When I open the list of what needs doing without a token
    Then the outreach response status should be 401

  # The picker offers the people who can sign in, not the people who sign letters.
  Scenario: the volunteers a business can be handed to are the admin users
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    When I ask who a business can be assigned to as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the volunteers should include "editor.admin.bdd@example.com"

  # TASK-404: the business page, and the two things a volunteer does on it.
  Scenario: a Viewer can read a business and its notes but cannot change either
    Given an admin user "viewer.admin.bdd@example.com" with role "viewer" and password "view-pw-123"
    And the business "Zzbdd Electrics" was added with email "hello@zzbddelectrics.example"
    When I open the business as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the outreach response status should be 200
    When I record the outcome "interested" as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the outreach response status should be 403
    When I add the note "Rang and spoke to Jim." as "viewer.admin.bdd@example.com" with password "view-pw-123"
    Then the outreach response status should be 403

  Scenario: an Editor records what happened, and it sticks
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the business "Zzbdd Electrics" was added with email "hello@zzbddelectrics.example"
    When I record the outcome "interested" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach business outcome should be "interested"
    And the outreach business should count as engaged

  # Silence is not contact. Treating it as engagement would keep a dead record alive for ever and
  # put a business nobody has heard from on the call list.
  Scenario: recording no reply does not count as the business engaging
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the business "Zzbdd Tyres" was added with email "hello@zzbddtyres.example"
    When I record the outcome "no_reply" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach business should not count as engaged

  # A decline is an instruction: it has to reach the matcher, or a different volunteer writes to
  # them again next year.
  Scenario: recording a decline puts the business beyond the matcher
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the business "Zzbdd Carpets" was added with email "hello@zzbddcarpets.example"
    When I record the outcome "declined" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    When I check the business "Zzbdd Carpets Ltd" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response should say do not contact

  Scenario: an ask-again date is kept for not this year, and ignored for anything else
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the business "Zzbdd Signs" was added with email "hello@zzbddsigns.example"
    When I record the outcome "not_this_year" asking again on "2027-08-01" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach business ask-again date should be "2027-08-01"
    When I record the outcome "interested" asking again on "2027-08-01" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach business should have no ask-again date

  # Append-only, and stamped with who wrote it. A record that can be tidied afterwards is not one.
  Scenario: a note is kept with its author, and cannot be emptied
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the business "Zzbdd Windows" was added with email "hello@zzbddwindows.example"
    When I add the note "   " as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 400
    When I add the note "Rang and spoke to Jim." as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 201
    And the business should have a note by "editor.admin.bdd@example.com" saying "Rang and spoke to Jim."

  Scenario: a business that does not exist is not found
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    When I open business 999999999 as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 404

  # PECR (TASK-403). A sole trader is a person in law, not a company, so an unsolicited marketing
  # email needs their agreement first. Checked on the SERVER: the screen hides the box for a
  # company, but a hidden box is not a legal control.
  Scenario: a sole trader cannot be emailed until we record that they agreed
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the sole trader "Zzbdd Barbers" was added with email "hello@zzbddbarbers.example"
    When I send the invitation as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 422
    And the outreach response should explain the sole trader rule
    And the outreach business should not have been emailed

  Scenario: a sole trader who agreed can be emailed
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the sole trader "Zzbdd Florists" agreed to hear from us
    When I send the invitation as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach business should have been emailed

  # Two volunteers can open the same business at once. The second send is a fact, not a scolding.
  Scenario: a business is never emailed twice
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And the business "Zzbdd Plumbing" was added with email "hello@zzbddplumbing.example"
    When I send the invitation as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 200
    And the outreach business should have been emailed
    When I send the invitation as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the outreach response status should be 409
