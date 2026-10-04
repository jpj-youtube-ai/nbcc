@fundraising @fundraising-team @invite-types @db
Feature: Invite types (Jaimie, B1 + I1)
  When staff invite someone from Admin > Fundraising they say what they are inviting them to do:
  raising money, a team, hosting an event, or a page in memory of someone. The invite keeps it, its
  email has the right words, and its link opens the sign up form at the right place, with the name
  and email filled in and nothing else answered for them. The in memory invite's wording is new, so
  it cannot be sent until an admin approves it. An invite from before, with no type, behaves as it
  always did. Every name and address here is invented.

  Scenario Outline: an invite's link opens the sign up form at the right place
    Given fundraising is switched on
    And a "<type>" invite to first name "Mary Ann" and surname "Sample" at "<email>" whose link we know
    When the sign up form asks for that invite
    Then the fundraising answer is 200
    And the form opens on "<opens on>" for first name "Mary Ann", surname "Sample" and "<email>", and nothing else

    Examples:
      | type    | email                              | opens on                 |
      | raising | raising.invtype.fr.bdd@example.com | raising                  |
      | team    | team.invtype.fr.bdd@example.com    | raising, as a team       |
      | event   | event.invtype.fr.bdd@example.com   | event                    |
      | memory  | memory.invtype.fr.bdd@example.com  | memory                   |
      | none    | none.invtype.fr.bdd@example.com    | no choice                |

  Scenario Outline: staff send an invite of a type, and a resend keeps it
    Given fundraising is switched on
    And a fundraising staff member "<staff>" with role "editor"
    When "<staff>" sends a "<type>" invite to first name "Sky" and surname "Sample" at "<email>"
    Then the fundraising answer is 201
    And the invite to "<email>" is kept as a "<type>" invite
    And a "fundraiseInvite" email with the subject "<subject>" went to "<email>"
    When "<staff>" resends the invite to "<email>"
    Then the fundraising answer is 200
    And the invite to "<email>" is kept as a "<type>" invite

    Examples:
      | type    | staff                         | email                            | subject                            |
      | raising | e1.invtype.fr.bdd@example.com | sky.r.invtype.fr.bdd@example.com | We'd love you to fundraise with us |
      | team    | e2.invtype.fr.bdd@example.com | sky.t.invtype.fr.bdd@example.com | We'd love you to fundraise with us |
      | event   | e3.invtype.fr.bdd@example.com | sky.e.invtype.fr.bdd@example.com | We'd love to help with your event  |

  Scenario: an in memory invite is refused until its wording is approved, then sent
    Given fundraising is switched on
    And a fundraising staff member "a4.invtype.fr.bdd@example.com" with role "admin"
    And a fundraising staff member "e4.invtype.fr.bdd@example.com" with role "editor"
    And the in memory invite wording is not approved
    When "e4.invtype.fr.bdd@example.com" sends a "memory" invite to first name "Morag" and surname "Sample" at "morag.invtype.fr.bdd@example.com"
    Then the fundraising answer is 409
    And the fundraising answer says "The in memory invite wording is waiting for sign off. Read it and approve it first."
    And there is no invite to "morag.invtype.fr.bdd@example.com"
    And no "fundraiseInvite" email went to "morag.invtype.fr.bdd@example.com"
    When "e4.invtype.fr.bdd@example.com" reads the "memory" invite wording
    Then the fundraising answer is 200
    And the invite wording has the subject "A page in memory of someone you love" and is waiting for sign off
    When "e4.invtype.fr.bdd@example.com" approves the in memory invite wording
    Then the fundraising answer is 403
    When "a4.invtype.fr.bdd@example.com" approves the in memory invite wording
    Then the fundraising answer is 200
    And History records "fundraising.invite_wording_approved" by "a4.invtype.fr.bdd@example.com"
    When "e4.invtype.fr.bdd@example.com" sends a "memory" invite to first name "Morag" and surname "Sample" at "morag.invtype.fr.bdd@example.com"
    Then the fundraising answer is 201
    And the invite to "morag.invtype.fr.bdd@example.com" is kept as a "memory" invite
    And a "fundraiseInvite" email with the subject "A page in memory of someone you love" went to "morag.invtype.fr.bdd@example.com"
    When "a4.invtype.fr.bdd@example.com" withdraws the in memory invite wording's approval
    Then the fundraising answer is 200
    And History records "fundraising.invite_wording_withdrawn" by "a4.invtype.fr.bdd@example.com"
    When "e4.invtype.fr.bdd@example.com" resends the invite to "morag.invtype.fr.bdd@example.com"
    Then the fundraising answer is 409

  Scenario: an invite sent from an admin page loaded before the drop-down still works
    Given fundraising is switched on
    And a fundraising staff member "e5.invtype.fr.bdd@example.com" with role "editor"
    When "e5.invtype.fr.bdd@example.com" sends an invite with no type to first name "Jo" and surname "Sample" at "jo.invtype.fr.bdd@example.com"
    Then the fundraising answer is 201
    And the invite to "jo.invtype.fr.bdd@example.com" is kept with no type
    And a "fundraiseInvite" email with the subject "We'd love you to fundraise with us" went to "jo.invtype.fr.bdd@example.com"

  Scenario: an invite of a type that is not one is refused
    Given a fundraising staff member "e6.invtype.fr.bdd@example.com" with role "editor"
    When "e6.invtype.fr.bdd@example.com" sends a "wedding" invite to first name "Jo" and surname "Sample" at "wed.invtype.fr.bdd@example.com"
    Then the fundraising answer is 400
    And there is no invite to "wed.invtype.fr.bdd@example.com"

  Scenario: the admin asks what they are inviting them to do, with nothing chosen
    When the admin page is read
    Then the invite form has a required drop-down "What are you inviting them to do?" with nothing chosen and the choices "Raising money", "A team", "Hosting an event" and "In memory"
