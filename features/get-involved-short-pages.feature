@events @db
Feature: The short pages under /get-involved/
  Drop-off points, Referrals, Volunteer, Your business, Your school and Your club or group. They are
  about helping NBCC rather than about events, so the events switch does not govern them. They live
  under /get-involved/ because /volunteer and /referrals are live forwards to the sign up sites.

  Scenario Outline: each page answers with its heading
    Given the events page is switched on
    When a visitor opens "<address>"
    Then the visitor gets status 200
    And the page shows "<heading>"

    Examples:
      | address                       | heading                                 |
      | /get-involved/drop-off-points | Drop-off points                         |
      | /get-involved/referrals       | Referrals                               |
      | /get-involved/volunteer       | Volunteer                               |
      | /get-involved/business        | make Christmas happen together.         |
      | /get-involved/schools         | Schools are at the heart of what we do. |
      | /get-involved/groups          | Do something brilliant, together.       |

  Scenario: the pages stay when the events switch is off, and the menu stops offering Get involved
    Given the events page is switched off
    When a visitor opens "/get-involved/volunteer"
    Then the visitor gets status 200
    And the page shows "Sign up to volunteer"
    And the page does not show 'href="/get-involved"'
    When a visitor opens "/get-involved"
    Then the visitor gets status 404

  Scenario: a Tell us form sends through the contact form's own path
    When a visitor opens "/get-involved/business"
    Then the page shows 'action="/api/contact"'
    And the page shows "/assets/js/contact-captcha.js"
    And the page shows "/assets/js/tell-us.js"

  Scenario: nothing unfinished reaches the public
    When a visitor opens "/get-involved/business"
    Then the page does not show "Payroll"
    And the page does not show "Fill Red Bags"
    And the page does not show "Photo to come"
    When a visitor opens "/get-involved/drop-off-points"
    Then the page does not show "What to bring"
    And the page does not show 'href="/fill'
