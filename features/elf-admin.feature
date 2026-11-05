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
