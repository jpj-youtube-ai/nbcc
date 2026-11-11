@elf-school @admin
Feature: Head Elf HQ, the Elf Detective School's own admin section
  The school runs itself. Head elves come into Admin > Content > Elf Detective School to see that it is
  going right and to step in where a person has to: a child's name to check before it shows in public,
  a typo, a family who cannot sign in, a test sign up to take out. Admins have it by role; anyone else
  is given it from the Team matrix. Design: docs/superpowers/specs/2026-11-05-elf-admin-design.md.
  Every family and person here is invented.

  Background:
    Given the Elf Detective School is switched "on"
    And an admin user "boss.elfhq.admin.bdd@example.com" with role "admin" and password "Elf-Hq-Admin-1"
    And an admin user "editor.elfhq.admin.bdd@example.com" with role "editor" and password "Elf-Hq-Editor-1"

  Scenario: HQ counts a paid family and keeps an editor out
    Given "sam.hq.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" reads Head Elf HQ
    Then Head Elf HQ counts 1 family and 1 name to check
    When "editor.elfhq.admin.bdd@example.com" with password "Elf-Hq-Editor-1" reads Head Elf HQ
    Then Head Elf HQ answers 403

  # TASK-613: to ring the grand prize winner's grown up on Christmas Eve.
  Scenario: A head elf sees the grown up's mobile on the family's sheet
    Given "sam.ring.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" opens the family sheet of "sam.ring.elf.bdd@example.com"
    Then the family sheet shows the mobile number "+447700900123"

  Scenario: A head elf ticks a name, and a changed name waits for a tick again
    Given "sam.names.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" ticks "Ruby" to show in public
    Then "Ruby" shows in public
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" renames "Ruby" to "Rosa"
    Then "Rosa" waits for a tick
    And an audit_log row for action "elf.detective.changed" by actor "admin:boss.elfhq.admin.bdd@example.com" exists

  Scenario: A removed family gets no sign in code until it is put back
    Given "sam.gone.elf.bdd@example.com" has already enrolled "Ivy Snowsleuth" and paid
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" removes the family of "sam.gone.elf.bdd@example.com"
    And a sign in code is asked for "sam.gone.elf.bdd@example.com"
    Then once the request has finished, 0 "elfSignInCode" emails went to "sam.gone.elf.bdd@example.com"
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" puts back the family of "sam.gone.elf.bdd@example.com"
    And a sign in code is asked for "sam.gone.elf.bdd@example.com"
    Then once the request has finished, 1 "elfSignInCode" email went to "sam.gone.elf.bdd@example.com"

  Scenario: An elf payment comes through Donations, under its own filter too, until its family is removed
    Given "pat.paid.elf.bdd@example.com" has already enrolled "Ivy Snowsleuth" and paid
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" reads the donations list
    Then it lists an Elf Detective School payment from "pat.paid.elf.bdd@example.com"
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" reads the donations list with source "elf_school"
    Then it lists an Elf Detective School payment from "pat.paid.elf.bdd@example.com"
    And every row it lists is an Elf Detective School payment
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" removes the family of "pat.paid.elf.bdd@example.com"
    And "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" reads the donations list with source "elf_school"
    Then it lists no Elf Detective School payment from "pat.paid.elf.bdd@example.com"

  Scenario: A removed family's session stops working, and Head Elf HQ stops counting it
    Given "sam.held.elf.bdd@example.com" has already enrolled "Ivy Snowsleuth" and paid
    When the paying browser comes back from Stripe
    Then it is sent to Detective HQ, signed in
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" removes the family of "sam.held.elf.bdd@example.com"
    Then the family's held session goes to the sign in instead of Detective HQ
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" reads Head Elf HQ
    Then Head Elf HQ counts no families and no detectives

  Scenario: A head elf cannot give one family another family's email
    Given "sam.first.elf.bdd@example.com" has already enrolled "Ruby Tinselfoot" and paid
    And "alex.second.elf.bdd@example.com" has already enrolled "Ivy Snowsleuth" and paid
    When "boss.elfhq.admin.bdd@example.com" with password "Elf-Hq-Admin-1" tries to give the family of "sam.first.elf.bdd@example.com" the email "alex.second.elf.bdd@example.com"
    Then Head Elf HQ answers 409
    And Head Elf HQ says "Another family already uses that email."
    And the family of "sam.first.elf.bdd@example.com" still has its own email
