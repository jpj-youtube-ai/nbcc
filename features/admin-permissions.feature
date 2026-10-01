@admin @db
Feature: Admin per-section permission matrix (admin-management Phase 2)
  A DB-backed authorizeSection gate checks a staff member's EFFECTIVE per-section permissions
  (their stored `permissions` matrix if set, else their role's defaults via roleToPermissions) on
  every admin request, replacing the flat viewer/editor/admin role gate. An admin can fine-tune a
  person's access section by section, and there must always be at least one enabled user with
  edit access to the "team" section (the new "last admin").

  Background:
    Given an admin user "root.admin.bdd@example.com" with password "root-pw-123"

  Scenario: a user with only stories:view can read stories, but not write stories or read donations
    Given a staff user "limited.admin.bdd@example.com" with password "limited-pw-123" and only "stories:view" permission
    And a submitted story with text "The Red Bag changed our Christmas (bdd-admin-permissions)."
    When I GET the admin path "/api/admin/stories" as "limited.admin.bdd@example.com" with password "limited-pw-123"
    Then the admin response status should be 200
    When I PATCH the admin story status to "reviewed" as "limited.admin.bdd@example.com" with password "limited-pw-123"
    Then the admin response status should be 403
    When I GET the admin path "/api/admin/donations" as "limited.admin.bdd@example.com" with password "limited-pw-123"
    Then the admin response status should be 403

  Scenario: granting donations:edit lets the user act on donations
    Given a staff user "grantee.admin.bdd@example.com" with password "grantee-pw-123" and only "stories:view" permission
    And a donor "Dana Donor" with email "dana.donor.admin.bdd@example.com"
    When I PATCH the admin donor full name to "Dana D. Updated" as "grantee.admin.bdd@example.com" with password "grantee-pw-123"
    Then the admin response status should be 403
    When I PATCH the admin user "grantee.admin.bdd@example.com" permissions to add "donations:edit" as "root.admin.bdd@example.com" with password "root-pw-123"
    Then the admin response status should be 200
    When I PATCH the admin donor full name to "Dana D. Updated" as "grantee.admin.bdd@example.com" with password "grantee-pw-123"
    Then the admin response status should be 200

  Scenario: a user without team:edit is forbidden from changing another user's permissions
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "editor-pw-123"
    And a staff user "target.admin.bdd@example.com" with password "target-pw-123" and only "stories:view" permission
    When I PATCH the admin user "target.admin.bdd@example.com" permissions to add "donations:edit" as "editor.admin.bdd@example.com" with password "editor-pw-123"
    Then the admin response status should be 403

  @admin-last-guard
  Scenario: removing the last effective team:edit holder is blocked with 409 last_admin
    Given an admin user "lone.admin.bdd@example.com" with password "lone-pw-123"
    And every other enabled admin is temporarily disabled, leaving only "lone.admin.bdd@example.com"
    When I PATCH the admin user "lone.admin.bdd@example.com" permissions to remove team edit as "lone.admin.bdd@example.com" with password "lone-pw-123"
    Then the admin response status should be 409
    And the admin response field "error" should be "last_admin"

  Scenario: GET /api/admin/me returns the caller's effective permissions
    Given a staff user "me.admin.bdd@example.com" with password "me-pw-123" and only "stories:view" permission
    When I GET the admin path "/api/admin/me" as "me.admin.bdd@example.com" with password "me-pw-123"
    Then the admin response status should be 200
    And the admin response field "email" should be "me.admin.bdd@example.com"
    And the admin response permissions field "stories" should be "view"
    And the admin response permissions field "donations" should be "none"

  # TASK-406: Business supporters is granted per person, not inherited with a role. The records
  # carry business contact details and the postal address a certificate is sent to, so it is
  # locked down like the email audit rather than arriving with "editor".
  Scenario: an editor cannot reach the business supporters list until it is granted
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    When I GET the admin path "/api/admin/fulfilments" as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 403

  Scenario: an admin reaches it by role
    Given an admin user "boss.admin.bdd@example.com" with password "boss-pw-123"
    When I GET the admin path "/api/admin/fulfilments" as "boss.admin.bdd@example.com" with password "boss-pw-123"
    Then the admin response status should be 200

  Scenario: a staff user granted it can reach it whatever their role
    Given a staff user "care.admin.bdd@example.com" with password "care-pw-123" and only "business-supporters:edit" permission
    When I GET the admin path "/api/admin/fulfilments" as "care.admin.bdd@example.com" with password "care-pw-123"
    Then the admin response status should be 200

  # TASK-463: Festive Ball, Site pages and Contact businesses arrived after saved access existed and
  # before TASK-406's rule that each new section ships with a migration adding it to the access already
  # saved. The Email audit arrived then too and is deliberately left out: it was asked for so that two
  # named admins hold it and grant it. The backfill runs against this database inside a transaction that
  # is rolled back, so the other scenarios never see it.
  Scenario Outline: access saved before the late sections existed gets them at the <role> role's own level
    Given a user "<email>" with role "<role>" whose saved access predates the four late sections
    When the TASK-463 permissions backfill runs
    Then the backfilled access of "<email>" gives "ball" as "<ball>"
    And the backfilled access of "<email>" gives "site" as "<site>"
    And the backfilled access of "<email>" gives "outreach" as "<outreach>"
    And the backfilled access of "<email>" does not mention "email-audit"
    And the backfilled access of "<email>" gives "stories" as "view"
    And the backfill logged "outreach" as "<outreach>" for "<email>"

    Examples:
      | role   | email                            | ball | site | outreach |
      | admin  | old.admin.admin.bdd@example.com  | edit | edit | edit     |
      | editor | old.editor.admin.bdd@example.com | view | view | edit     |
      | viewer | old.viewer.admin.bdd@example.com | view | view | view     |

  # Somebody may have been given None on purpose, by the TASK-459 fault, or by Manage access filling a
  # gap when an older matrix was saved again. Only a person can tell which, on Team > Manage access, so
  # the backfill never changes a section a matrix already names.
  Scenario: the backfill leaves alone a section somebody has already been given
    Given a user "chosen.editor.admin.bdd@example.com" with role "editor" whose saved access already sets the four late sections to "none"
    When the TASK-463 permissions backfill runs
    Then the backfilled access of "chosen.editor.admin.bdd@example.com" gives "outreach" as "none"
    And the backfilled access of "chosen.editor.admin.bdd@example.com" gives "ball" as "none"
    And the backfilled access of "chosen.editor.admin.bdd@example.com" gives "site" as "none"
    And the backfill logged nothing for "chosen.editor.admin.bdd@example.com"

  # The Background's admin has no saved access at all, so they already get their role's defaults. A
  # backfill that wrote into an empty matrix would turn it into three sections and None everywhere else.
  Scenario: the backfill leaves people with no saved access on their role's defaults
    When the TASK-463 permissions backfill runs
    Then the backfilled access of "root.admin.bdd@example.com" is still empty
    And the backfill logged nothing for "root.admin.bdd@example.com"

  # TASK-479: site analytics is admins only by role, as Jaimie asked. Access saved before it existed
  # gets it at the role's own level, with an audit row each, and anybody else is given it from Team.
  Scenario Outline: access saved before site analytics existed gets it at the <role> role's own level
    Given a user "<email>" with role "<role>" whose saved access predates the four late sections
    When the TASK-479 analytics permissions backfill runs
    Then the backfilled access of "<email>" gives "analytics" as "<analytics>"
    And the backfilled access of "<email>" gives "stories" as "view"
    And the analytics backfill logged "<analytics>" for "<email>"

    Examples:
      | role   | email                            | analytics |
      | admin  | old.admin.admin.bdd@example.com  | edit      |
      | editor | old.editor.admin.bdd@example.com | none      |
      | viewer | old.viewer.admin.bdd@example.com | none      |

  Scenario: the analytics backfill leaves people with no saved access on their role's defaults
    When the TASK-479 analytics permissions backfill runs
    Then the backfilled access of "root.admin.bdd@example.com" is still empty
    And the backfill logged nothing for "root.admin.bdd@example.com"
