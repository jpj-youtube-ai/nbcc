@fundraising @fundraising-requests @db
Feature: Fundraising requests tracked to done (TASK-505)
  What an organiser asked us for on the sign up form is tracked in Admin > Fundraising: posters and
  leaflets To send then Sent, buckets and tins To send, With them, then Back. Viewers see where each
  is up to; editors move them on, one step at a time. Once something is sent it no longer counts as
  waiting on us, and a bucket counts as not back until it is. Every name and address here is
  invented.

  Scenario: staff mark posters sent and a bucket out then back, and what is waiting drops
    Given a fundraising staff member "e1.req.fr.bdd@example.com" with role "editor"
    And a fundraising staff member "v1.req.fr.bdd@example.com" with role "viewer"
    And an approved fundraiser "Ali's Bake Sale (bdd-fr)" asking for 10 posters and 1 collection bucket
    When "v1.req.fr.bdd@example.com" reads the fundraising requests
    Then the fundraising answer is 200
    And "Ali's Bake Sale (bdd-fr)" shows Requests to do
    And the posters for "Ali's Bake Sale (bdd-fr)" are "to_send"
    When "v1.req.fr.bdd@example.com" marks the posters for "Ali's Bake Sale (bdd-fr)" sent
    Then the fundraising answer is 403
    When "e1.req.fr.bdd@example.com" marks the posters for "Ali's Bake Sale (bdd-fr)" sent
    Then the fundraising answer is 200
    When "e1.req.fr.bdd@example.com" lends the collection buckets to "Ali's Bake Sale (bdd-fr)"
    Then the fundraising answer is 200
    When "e1.req.fr.bdd@example.com" reads the fundraising requests
    Then the posters for "Ali's Bake Sale (bdd-fr)" are "sent"
    And "Ali's Bake Sale (bdd-fr)" does not show Requests to do
    And the posters still to send have dropped by 10 and the collection buckets by 1
    And buckets or tins not back have gone up by 1
    When "e1.req.fr.bdd@example.com" marks the collection buckets for "Ali's Bake Sale (bdd-fr)" back
    Then the fundraising answer is 200
    When "e1.req.fr.bdd@example.com" reads the fundraising requests
    Then the collection buckets for "Ali's Bake Sale (bdd-fr)" are "back"
    And buckets or tins not back are as they were at the start
    And the history of "Ali's Bake Sale (bdd-fr)" records "fundraiser.request_updated"

  Scenario: a second press from the same screen changes nothing, and Undo goes back one step
    Given a fundraising staff member "e2.req.fr.bdd@example.com" with role "editor"
    And an approved fundraiser "Sky's Quiz (bdd-fr)" asking for 10 posters and 1 collection bucket
    When "e2.req.fr.bdd@example.com" marks the posters for "Sky's Quiz (bdd-fr)" sent
    Then the fundraising answer is 200
    When "e2.req.fr.bdd@example.com" marks the posters for "Sky's Quiz (bdd-fr)" sent
    Then the fundraising answer is 409
    When "e2.req.fr.bdd@example.com" undoes the posters for "Sky's Quiz (bdd-fr)"
    Then the fundraising answer is 200
    When "e2.req.fr.bdd@example.com" reads the fundraising requests
    Then the posters for "Sky's Quiz (bdd-fr)" are "to_send"
