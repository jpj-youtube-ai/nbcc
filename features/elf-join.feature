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
    And the family of "sam.elf.bdd@example.com" keeps the mobile number "+447700900123"
    When Stripe says the enrolment was paid
    Then the enrolment is paid, with a badge for each detective
    And 1 "elfWelcome" email went to "sam.elf.bdd@example.com"
    When the paying browser comes back from Stripe
    Then it is sent to Detective HQ, signed in
    When I open Detective HQ
    Then the elf response should contain "Detective Ruby Tinselfoot"
    And the elf response should contain "Detective Leo Frostwhistle"
    When I save a look for "Ruby" in a costume that is not unlocked yet, with a favourite
    Then the look kept for "Ruby" has no costume, and keeps its scene and friend
    And the favourite kept for "Ruby" is made safe too
    When Stripe says the enrolment was paid
    Then 1 "elfWelcome" email went to "sam.elf.bdd@example.com"

  # TASK-613: a mobile number, so NBCC can ring the grand prize winner's grown up on Christmas Eve.
  Scenario: an enrolment with no mobile number, or one that is not a UK mobile, is refused and nothing is saved
    Given the Elf Detective School is switched "on"
    When "pat.mobile.elf.bdd@example.com" enrols "Ruby Tinselfoot" paying 500 pence with no mobile number
    Then the elf response status should be 400
    And the elf response should contain "Please type a UK mobile number, like 07700 900 123."
    And no family was saved for "pat.mobile.elf.bdd@example.com"
    When "pat.mobile.elf.bdd@example.com" enrols "Ruby Tinselfoot" paying 500 pence with the mobile number "01632 960 123"
    Then the elf response status should be 400
    And the elf response should contain "Please type a UK mobile number, like 07700 900 123."
    And no family was saved for "pat.mobile.elf.bdd@example.com"
    When "pat.mobile.elf.bdd@example.com" enrols "Ruby Tinselfoot" paying 500 pence with the mobile number "+44 7700 900 045"
    Then the elf response status should be 200
    And the family of "pat.mobile.elf.bdd@example.com" keeps the mobile number "+447700900045"

  Scenario: an email that already has detectives must sign in to add more, and is never told so outright
    Given the Elf Detective School is switched "on"
    And "jo.elf.bdd@example.com" has already enrolled "Ivy Snowsleuth" and paid
    When "jo.elf.bdd@example.com" enrols "Max Jinglesnoop" and "Ada Twinkletoes" paying 400 pence
    Then the elf response status should be 200
    And the elf response should contain "Check your email to carry on"
    And 1 "elfSignInCode" email went to "jo.elf.bdd@example.com"
