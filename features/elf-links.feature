@elf-school
Feature: Elf Detective School open early, linked from the site from 10am on Friday 13 November
  Jaimie switches Elf Detective School on the evening before (TASK-613), so a teacher with the link in
  an email can look around and enrol. Nothing on the site links to it until the big push at 10am on
  Friday 13 November 2026 (src/elf/links-at.ts): before then the pages that would carry a link are
  exactly what they are with it switched off. These steps read the real clock, so they pass on either
  side of the moment. Every family here is invented.

  Scenario: switched on, Elf Detective School's own front page answers at once
    Given the Elf Detective School is switched "on"
    When I request the elf path "/elf"
    Then the elf response status should be 200

  Scenario: switched on, the home page, Your school and the site map wait for Friday 10am
    Given the Elf Detective School is switched "on"
    When I request the elf path "/"
    Then the page carries the Elf Detective School card only from Friday 13 November at 10am
    When I request the elf path "/get-involved/schools"
    Then the page carries the Elf Detective School card only from Friday 13 November at 10am
    When I request the elf path "/sitemap"
    Then the page links to Elf Detective School only from Friday 13 November at 10am

  Scenario: switched off, nothing on the site links to it
    Given the Elf Detective School is switched "off"
    When I request the elf path "/"
    Then the page does not link to Elf Detective School
    When I request the elf path "/get-involved/schools"
    Then the page does not link to Elf Detective School
