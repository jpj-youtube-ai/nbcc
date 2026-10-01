@admin @analytics @analytics-admin @db
Feature: Admin > Analytics: where visitors come from and what they look at (TASK-482)
  The numbers and the collecting switch are behind their own permission, which admins hold by
  role. Switching counting on or off is recorded in the audit log against whoever did it. The
  page's figures come from the stored page views: visitors are counted once per day, and a visit
  ends after a gap of more than 30 minutes (a gap of exactly 30 minutes is still one visit).

  Background:
    Given an admin user "boss.analytics.admin.bdd@example.com" with role "admin" and password "analytics-pw-123"
    And an admin user "editor.analytics.admin.bdd@example.com" with role "editor" and password "analytics-pw-123"

  Scenario: the numbers need the analytics permission
    When I read the analytics without a session
    Then the analytics answer is 401
    When "editor.analytics.admin.bdd@example.com" reads the analytics for 30 days
    Then the analytics answer is 403
    When "editor.analytics.admin.bdd@example.com" switches counting "on"
    Then the analytics answer is 403
    When "boss.analytics.admin.bdd@example.com" reads the analytics for 30 days
    Then the analytics answer is 200

  Scenario: an admin switches counting on and off, and each change is audited
    When "boss.analytics.admin.bdd@example.com" switches counting "on"
    Then the analytics answer is 200
    And "boss.analytics.admin.bdd@example.com" sees counting is "on"
    And the audit log records counting switched "on" by "boss.analytics.admin.bdd@example.com"
    When "boss.analytics.admin.bdd@example.com" switches counting "off"
    Then "boss.analytics.admin.bdd@example.com" sees counting is "off"
    And the audit log records counting switched "off" by "boss.analytics.admin.bdd@example.com"

  Scenario: the numbers come from the stored page views
    Given "boss.analytics.admin.bdd@example.com" has read the analytics for 7 days
    When three invented visitors' page views from today are stored
    And "boss.analytics.admin.bdd@example.com" reads the analytics for 7 days
    Then the analytics answer is 200
    And today's figures grew by 3 visitors, 4 visits and 6 page views
    And "bdd-site.example" brought 4 visits
    And "Bddtown" had 3 visitors
    And someone is on the website right now
    When "boss.analytics.admin.bdd@example.com" checks who is on the website right now
    Then the analytics answer is 200
    And someone is on the website right now
