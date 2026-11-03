@elf-school
Feature: Elf Detective School, wave 1: enrolling, paying, signing in and dressing an elf
  A grown up enrols their detectives (a first name and a festive surname only) and pays what they
  can. The payment settles through Stripe's webhook, each detective gets a badge, the welcome email
  goes, and the browser that paid is signed in to Detective HQ, where each elf can be dressed. The
  whole school ships switched off: until an admin switches it on, every page is not found.
  Every family here is invented.

  Background:
    Given the Elf Detective School is switched "off"

  Scenario: while it is switched off, nothing is there
    When I request the elf path "/elf"
    Then the elf response status should be 404
    When I request the elf path "/elf/join"
    Then the elf response status should be 404

  Scenario: a grown up enrols two detectives, pays, and is signed in to Detective HQ
    Given the Elf Detective School is switched "on"
    When "sam.elf.bdd@example.com" enrols "Ruby Tinselfoot" and "Leo Frostwhistle" paying 1000 pence
    Then the elf response status should be 200
    And the enrolment is waiting for its payment
    When Stripe says the enrolment was paid
    Then the enrolment is paid, with a badge for each detective
    And 1 "elfWelcome" email went to "sam.elf.bdd@example.com"
    When the paying browser comes back from Stripe
    Then it is sent to Detective HQ, signed in
    When I open Detective HQ
    Then the elf response should contain "Detective Ruby Tinselfoot"
    And the elf response should contain "Detective Leo Frostwhistle"
    When I save a look for "Ruby" wearing a top that is not earned yet
    Then the look kept for "Ruby" has the starter top
    When Stripe says the enrolment was paid
    Then 1 "elfWelcome" email went to "sam.elf.bdd@example.com"

  Scenario: an email that already has detectives must sign in to add more
    Given the Elf Detective School is switched "on"
    And "jo.elf.bdd@example.com" has already enrolled "Ivy Snowsleuth" and paid
    When "jo.elf.bdd@example.com" enrols "Max Jinglesnoop" and "Ada Twinkletoes" paying 400 pence
    Then the elf response status should be 409
    And the elf response should contain "Please sign in to add more"
