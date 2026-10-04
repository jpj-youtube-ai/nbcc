@admin @get-involved
Feature: Admin > Get involved: NBCC's own events and community fundraising in one tab
  The admin's Events and Fundraising tabs are one tab, Get involved, with five sections: Sign-ups,
  Our events, Tickets and pledges, Emails and Settings. Nothing about what they do has changed, and
  the Festive Ball tab is as it was. The switch for the public page says the page's real name.

  Scenario: the menu has one Get involved entry, and the Festive Ball as before
    When the admin page is read
    Then the admin menu has a "Get involved" entry
    And the admin menu has a "Festive Ball" entry
    And the admin menu has no "Events" entry
    And the admin menu has no "Fundraising" entry

  Scenario: Get involved has its five sections, in order
    When the admin page is read
    Then Get involved offers the sections "Sign-ups", "Our events", "Tickets and pledges", "Emails" and "Settings"

  Scenario: the page switch calls the page Get involved
    When the admin page is read
    Then the admin page asks "Is the Get involved page on the website?"
    And the admin page nowhere says "Events page"
