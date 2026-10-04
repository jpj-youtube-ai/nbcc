@newsletter-signup @db
Feature: Joining the mailing list from /newsletter, with a confirm by email step
  Anyone can ask to join the mailing list on the /newsletter page with a first name and an email
  address. We email that address one link. Nobody is on the list until the button behind that link
  is pressed, so a link opened by a mail scanner adds nobody. The form answers the same whoever the
  address belongs to. A confirmed person joins the same list the newsletter already uses, exactly as
  the footer form on every page adds them. Every name and address here is invented.

  Scenario: the sign up page is served at its own address
    When the mailing list page is opened at "/newsletter"
    Then the mailing list page answers 200
    And the mailing list page says "Join our mailing list"
    And the mailing list page says "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland"

  Scenario: asking to join sends one email and adds nobody until the button in it is pressed
    When "Sam" asks to join the mailing list as "sam1.newsletter.signup.bdd@example.com"
    Then the mailing list form answers 200 with "check_email"
    And 1 mailing list confirm email has gone to "sam1.newsletter.signup.bdd@example.com"
    And "sam1.newsletter.signup.bdd@example.com" is not on the mailing list
    When "sam1.newsletter.signup.bdd@example.com" opens their mailing list link
    Then the mailing list page answers 200
    And the mailing list page says "Yes, add me"
    And "sam1.newsletter.signup.bdd@example.com" is not on the mailing list
    When "sam1.newsletter.signup.bdd@example.com" presses the button behind their mailing list link
    Then the mailing list page answers 200
    And the mailing list page says "Thank you for joining us"
    And "sam1.newsletter.signup.bdd@example.com" is on the mailing list as "Sam", having signed up themselves
    And no mailing list request is waiting for "sam1.newsletter.signup.bdd@example.com"

  Scenario: a link works once
    Given "Sam" has joined the mailing list as "sam2.newsletter.signup.bdd@example.com" and confirmed by email
    When "sam2.newsletter.signup.bdd@example.com" opens the mailing list link they already used
    Then the mailing list page answers 404
    And the mailing list page says "This link no longer works"
    And the mailing list page says "Start again"

  Scenario: a link stops working after 7 days
    When "Sam" asks to join the mailing list as "sam3.newsletter.signup.bdd@example.com"
    And the mailing list request for "sam3.newsletter.signup.bdd@example.com" was made 8 days ago
    And "sam3.newsletter.signup.bdd@example.com" presses the button behind their mailing list link
    Then the mailing list page answers 404
    And the mailing list page says "This link no longer works"
    And "sam3.newsletter.signup.bdd@example.com" is not on the mailing list

  Scenario: asking twice in a row sends one email, not two
    When "Sam" asks to join the mailing list as "sam4.newsletter.signup.bdd@example.com"
    And "Sam" asks to join the mailing list as "sam4.newsletter.signup.bdd@example.com"
    Then the mailing list form answers 200 with "check_email"
    And 1 mailing list confirm email has gone to "sam4.newsletter.signup.bdd@example.com"

  Scenario: an address that bounced is told the same, is sent nothing and is never added
    Given "sam5.newsletter.signup.bdd@example.com" is on the stop list because it bounced
    When "Sam" asks to join the mailing list as "sam5.newsletter.signup.bdd@example.com"
    Then the mailing list form answers 200 with "check_email"
    And 0 mailing list confirm emails have gone to "sam5.newsletter.signup.bdd@example.com"
    And no mailing list request is waiting for "sam5.newsletter.signup.bdd@example.com"
    And "sam5.newsletter.signup.bdd@example.com" is not on the mailing list

  Scenario: an address that starts bouncing after asking is thanked the same and never added
    When "Sam" asks to join the mailing list as "sam6.newsletter.signup.bdd@example.com"
    And "sam6.newsletter.signup.bdd@example.com" is on the stop list because it bounced
    And "sam6.newsletter.signup.bdd@example.com" presses the button behind their mailing list link
    Then the mailing list page answers 200
    And the mailing list page says "Thank you for joining us"
    And "sam6.newsletter.signup.bdd@example.com" is not on the mailing list

  Scenario: someone already on the list is thanked and nothing about them changes
    Given "Sam" has joined the mailing list as "sam7.newsletter.signup.bdd@example.com" and confirmed by email
    And the time "sam7.newsletter.signup.bdd@example.com" joined the newsletter list is noted
    When "Sammy" asks to join the mailing list as "sam7.newsletter.signup.bdd@example.com"
    Then the mailing list form answers 200 with "check_email"
    When "sam7.newsletter.signup.bdd@example.com" presses the button behind their mailing list link
    Then the mailing list page says "Thank you for joining us"
    And "sam7.newsletter.signup.bdd@example.com" is on the mailing list as "Sam", having signed up themselves
    And the time "sam7.newsletter.signup.bdd@example.com" joined the newsletter list has not changed

  Scenario: someone who unsubscribed and signs up again themselves is back on the list
    Given "Sam" has joined the mailing list as "sam8.newsletter.signup.bdd@example.com" and confirmed by email
    And "sam8.newsletter.signup.bdd@example.com" has since unsubscribed from the newsletter list
    When "Sam" asks to join the mailing list as "sam8.newsletter.signup.bdd@example.com"
    And "sam8.newsletter.signup.bdd@example.com" presses the button behind their mailing list link
    Then the mailing list page says "Thank you for joining us"
    And "sam8.newsletter.signup.bdd@example.com" is on the mailing list as "Sam", having signed up themselves

  Scenario: the form says which box needs another look
    When "" asks to join the mailing list as "not an address"
    Then the mailing list form answers 400 with the boxes "firstName" and "email" marked

  Scenario: a made up link adds nobody
    When someone opens the mailing list link "/newsletter/confirm?t=not-a-real-link"
    Then the mailing list page answers 404
    And the mailing list page says "This link no longer works"
