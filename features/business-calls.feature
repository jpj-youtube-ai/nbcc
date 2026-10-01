@admin @business-calls
Feature: A reminder to phone each business that gives monthly (TASK-491)
  Jaimie phones each business that gives monthly every three months while they are still giving,
  to thank them and ask if there is anything we can do. Admin > Business supporters says who is due,
  records the call, and keeps the number to ring. Every business, name and number here is invented.

  Background:
    Given an admin user "boss.calls.admin.bdd@example.com" with password "boss-pw-123"

  Scenario: a business giving since the spring is due a call, and marking it called clears it
    Given a business "Heather Bakery Calls Bdd" with email "heather.calls.bdd@example.com" has given monthly since "2026-03-01"
    When I list the business supporters as "boss.calls.admin.bdd@example.com" with password "boss-pw-123"
    Then the business with email "heather.calls.bdd@example.com" is due a call
    When I mark the business with email "heather.calls.bdd@example.com" as called with the note "Very happy, wants a ball table" as "boss.calls.admin.bdd@example.com" with password "boss-pw-123"
    Then the admin response status should be 200
    When I list the business supporters as "boss.calls.admin.bdd@example.com" with password "boss-pw-123"
    Then the business with email "heather.calls.bdd@example.com" is not due a call
    And the business with email "heather.calls.bdd@example.com" was last called by "boss.calls.admin.bdd@example.com" with the note "Very happy, wants a ball table"
    And the History of the business with email "heather.calls.bdd@example.com" includes "fulfilment.called"

  Scenario: a business whose monthly gift is still being retried is still due
    Given a business "Pine Joinery Calls Bdd" with email "pine.calls.bdd@example.com" has given monthly since "2026-03-01"
    And the monthly gift of the business with email "pine.calls.bdd@example.com" is "past_due"
    When I list the business supporters as "boss.calls.admin.bdd@example.com" with password "boss-pw-123"
    Then the business with email "pine.calls.bdd@example.com" is due a call

  Scenario: a business that cancelled, or lapsed, is never due
    Given a business "Rowan Florist Calls Bdd" with email "rowan.calls.bdd@example.com" has given monthly since "2026-03-01"
    And the business with email "rowan.calls.bdd@example.com" cancelled its monthly gift
    And a business "Birch Garage Calls Bdd" with email "birch.calls.bdd@example.com" has given monthly since "2026-03-01"
    And the monthly gift of the business with email "birch.calls.bdd@example.com" is "lapsed"
    When I list the business supporters as "boss.calls.admin.bdd@example.com" with password "boss-pw-123"
    Then the business with email "rowan.calls.bdd@example.com" is not due a call
    And the business with email "birch.calls.bdd@example.com" is not due a call

  Scenario: the phone number is checked, saved, and recorded in History
    Given a business "Alder Print Calls Bdd" with email "alder.calls.bdd@example.com" has given monthly since "2026-03-01"
    When I set the phone of the business with email "alder.calls.bdd@example.com" to "call reception" as "boss.calls.admin.bdd@example.com" with password "boss-pw-123"
    Then the admin response status should be 400
    When I set the phone of the business with email "alder.calls.bdd@example.com" to "+44 (0)131 496 0000" as "boss.calls.admin.bdd@example.com" with password "boss-pw-123"
    Then the admin response status should be 200
    When I list the business supporters as "boss.calls.admin.bdd@example.com" with password "boss-pw-123"
    Then the business with email "alder.calls.bdd@example.com" has the phone "+44 (0)131 496 0000"
    And the History of the business with email "alder.calls.bdd@example.com" includes "fulfilment.phone"

  Scenario: the migration copies a number from Contact businesses into an empty phone only
    Given a business "Hazel Cafe Calls Bdd" with email "hazel.calls.bdd@example.com" has given monthly since "2026-03-01"
    And Contact businesses holds the phone "0131 496 0123" for the business with email "hazel.calls.bdd@example.com"
    And a business "Elm Books Calls Bdd" with email "elm.calls.bdd@example.com" has given monthly since "2026-03-01"
    And the business with email "elm.calls.bdd@example.com" already has the phone "0131 496 0999"
    And Contact businesses holds the phone "0131 496 0456" for the business with email "elm.calls.bdd@example.com"
    And a business "Oak Deli Calls Bdd" with email "oak.calls.bdd@example.com" has given monthly since "2026-03-01"
    And Contact businesses holds the phone "ask for Sam" for the business with email "oak.calls.bdd@example.com"
    When the TASK-491 phone backfill runs
    Then the backfilled phone of the business with email "hazel.calls.bdd@example.com" is "0131 496 0123"
    And the backfilled phone of the business with email "elm.calls.bdd@example.com" is "0131 496 0999"
    And the backfilled phone of the business with email "oak.calls.bdd@example.com" is empty
    And the backfill logged a phone copy for the business with email "hazel.calls.bdd@example.com"
