@fundraising @all-emails @db
Feature: All emails, in Admin > Fundraising
  Every email the website sends about fundraising, sponsor pledges, event tickets and the Festive
  Ball can be read in one place, exactly as it would arrive, with made-up names. Anyone who can see
  Fundraising can read them. The few emails that only go once an admin has approved their wording
  say where that is up to, and are approved with the same sign off as before: nothing new is held
  back, and nothing held starts to go. Every name and address here is invented.

  Scenario: nobody reads them without signing in
    When someone who is not signed in asks for the All emails list
    Then the fundraising answer is 401

  Scenario: a viewer reads the whole list, in its ten groups
    Given a fundraising staff member "v1.allemails.fr.bdd@example.com" with role "viewer"
    When "v1.allemails.fr.bdd@example.com" reads the All emails list
    Then the fundraising answer is 200
    And the All emails list has its ten groups in order
    And the All emails list has as many emails as it says, each with a name, a subject and who gets it
    And the All emails list carries no email itself
    When "v1.allemails.fr.bdd@example.com" reads the All emails count
    Then the fundraising answer is 200
    And the All emails count matches the list

  Scenario: a viewer opens an email, as it would arrive
    Given a fundraising staff member "v2.allemails.fr.bdd@example.com" with role "viewer"
    When "v2.allemails.fr.bdd@example.com" opens the All emails email "team-invite" in its "usual" version
    Then the fundraising answer is 200
    And the All emails email has a subject and shows only invented people
    And the All emails email has no sign off
    When "v2.allemails.fr.bdd@example.com" opens the All emails email "team-invite" in its "no-date" version
    Then the fundraising answer is 200
    When "v2.allemails.fr.bdd@example.com" opens the All emails email "team-invite" in its "made-up" version
    Then the fundraising answer is 404
    When "v2.allemails.fr.bdd@example.com" opens the All emails email "made-up" in its "usual" version
    Then the fundraising answer is 404

  Scenario: an email waiting for sign off says so, and only an admin approves it, with the sign off it always had
    Given a fundraising staff member "a3.allemails.fr.bdd@example.com" with role "admin"
    And a fundraising staff member "e3.allemails.fr.bdd@example.com" with role "editor"
    And the All emails wording "pledge_pay" is waiting for sign off
    When "e3.allemails.fr.bdd@example.com" reads the All emails list
    Then All emails says "pledge-pay" is "waiting"
    And All emails says "team-invite" has no sign off
    When "e3.allemails.fr.bdd@example.com" approves the All emails email "pledge-pay" where the list says to
    Then the fundraising answer is 403
    When "a3.allemails.fr.bdd@example.com" approves the All emails email "pledge-pay" where the list says to
    Then the fundraising answer is 200
    When "e3.allemails.fr.bdd@example.com" reads the All emails list
    Then All emails says "pledge-pay" is "approved"
    When "e3.allemails.fr.bdd@example.com" opens the All emails email "pledge-pay" in its "usual" version
    Then the fundraising answer is 200
    And the All emails email was approved by "a3.allemails.fr.bdd@example.com"

  Scenario: the nothing raised version of the thank you is signed off on its own
    Given a fundraising staff member "a4.allemails.fr.bdd@example.com" with role "admin"
    And the All emails wording "finished_zero" is waiting for sign off
    And the All emails wording "finished" is signed off
    When "a4.allemails.fr.bdd@example.com" reads the All emails list
    Then All emails says "touch-finished" is "waiting"
    And All emails says the version of "touch-finished" that is waiting is "nothing-raised"

  Scenario: the read-through changes show in the emails themselves
    Given a fundraising staff member "v5.readthrough.fr.bdd@example.com" with role "viewer"
    When "v5.readthrough.fr.bdd@example.com" opens the All emails email "signup-on-list" in its "usual" version
    Then the fundraising answer is 200
    And the All emails email says "As you asked, we won't show it on our website."
    And the All emails email does not say "If you asked us to show it"
    When "v5.readthrough.fr.bdd@example.com" opens the All emails email "signup-on-list" in its "staff-hid" version
    Then the fundraising answer is 200
    And the All emails email does not say "As you asked"
    When "v5.readthrough.fr.bdd@example.com" opens the All emails email "memory-live" in its "usual" version
    Then the fundraising answer is 200
    And the All emails email says "mailto:jodie@nbcc.scot"
    And the All emails email does not say "events@"
    When "v5.readthrough.fr.bdd@example.com" opens the All emails email "invite-memory" in its "usual" version
    Then the fundraising answer is 200
    And the All emails email says "mailto:jodie@nbcc.scot"
    And the All emails email does not say "events@"
    When "v5.readthrough.fr.bdd@example.com" opens the All emails email "paid-in-receipt" in its "usual" version
    Then the fundraising answer is 200
    And the All emails email says "is a Scottish Charitable Incorporated Organisation."
    And the All emails email does not say "charity-registration"
    When "v5.readthrough.fr.bdd@example.com" opens the All emails email "pledge-confirm" in its "usual" version
    Then the fundraising answer is 200
    And the All emails email says "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland"
    When "v5.readthrough.fr.bdd@example.com" opens the All emails email "staff-signup" in its "usual" version
    Then the fundraising answer is 200
    And the All emails email says "Get involved &gt; Sign ups"
