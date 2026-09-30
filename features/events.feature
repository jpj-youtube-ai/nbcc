@events @db
Feature: The Events page, built in the admin and switched on and off from it (TASK-453)
  Staff build events in the admin. The page ships switched off: until an admin turns it on,
  /events is a real 404 and no page offers it in the menu or the site map. Switched on, it shows
  every live event soonest first, and nothing that is a draft, already over, or not due up yet.

  # ---- the switch ----

  Scenario: switched off, the page does not exist and nothing points at it
    Given the events page is switched off
    When a visitor opens "/events"
    Then the visitor gets status 404
    When a visitor opens "/"
    Then the menu does not offer Events
    When a visitor opens "/sitemap.xml"
    Then the site map does not list the events page

  Scenario: switched on, the page shows live events soonest first, with the face down card last
    Given the events page is switched on
    And a live event "Later night (bdd-events)" 12 days from now
    And a live event "Sooner night (bdd-events)" 10 days from now
    When a visitor opens "/events"
    Then the visitor gets status 200
    And "Sooner night (bdd-events)" comes before "Later night (bdd-events)" on the page
    And the last card on the page is the face down card

  Scenario: switched on, every page's menu offers Events straight after About
    Given the events page is switched on
    When a visitor opens "/"
    Then the menu offers Events straight after About
    When a visitor opens "/contact"
    Then the menu offers Events straight after About
    When a visitor opens "/supporters"
    Then the menu offers Events straight after About
    When a visitor opens "/sitemap.xml"
    Then the site map lists the events page

  Scenario: drafts, events already over and events not due up yet stay off the page
    Given the events page is switched on
    And a draft event "Still a draft (bdd-events)" 10 days from now
    And a live event "Over and done (bdd-events)" 1 day ago
    And an event "Not up yet (bdd-events)" 20 days from now scheduled to go up in 5 days
    And an event "Up today (bdd-events)" 20 days from now scheduled to go up today
    When a visitor opens "/events"
    Then the page does not show "Still a draft (bdd-events)"
    And the page does not show "Over and done (bdd-events)"
    And the page does not show "Not up yet (bdd-events)"
    And the page shows "Up today (bdd-events)"

  Scenario: a picture address that was never issued is a 404, and so is anything that is not one
    When a visitor opens "/media/events/0f8fad5b-d9cb-469f-a165-70867728950e"
    Then the visitor gets status 404
    When a visitor opens "/media/events/not-a-picture"
    Then the visitor gets status 404

  # ---- the admin API ----

  Scenario: the admin's events need a session
    When I list the admin events without a session
    Then the events admin status should be 401

  Scenario: an editor builds an event, and it is recorded who did
    Given an events staff member "e1.events.bdd@example.com" with role "editor"
    When "e1.events.bdd@example.com" saves a new draft event "Quiz night (bdd-events)" 30 days from now
    Then the events admin status should be 201
    And the audit log records "events.created" for "Quiz night (bdd-events)" by "e1.events.bdd@example.com"
    When "e1.events.bdd@example.com" renames that event to "Quiz night round two (bdd-events)"
    Then the events admin status should be 200
    And the audit log records "events.updated" for "Quiz night round two (bdd-events)" by "e1.events.bdd@example.com"
    When "e1.events.bdd@example.com" deletes that event
    Then the events admin status should be 200
    And the audit log records "events.deleted" for "Quiz night round two (bdd-events)" by "e1.events.bdd@example.com"

  Scenario: only an admin can switch the whole page on
    Given the events page is switched off
    And an events staff member "e2.events.bdd@example.com" with role "editor"
    And an events staff member "a2.events.bdd@example.com" with role "admin"
    When "e2.events.bdd@example.com" switches the events page on
    Then the events admin status should be 403
    When "a2.events.bdd@example.com" switches the events page on
    Then the events admin status should be 200
    And the audit log records the page being switched on by "a2.events.bdd@example.com"
    When a visitor opens "/events"
    Then the visitor gets status 200

  Scenario: a booking link that could run script is refused, and the field is named
    Given an events staff member "e3.events.bdd@example.com" with role "editor"
    When "e3.events.bdd@example.com" saves an event booking elsewhere at "javascript:alert(1)"
    Then the events admin status should be 400
    And the refusal names the field "bookingUrl"

  Scenario: an event cannot go live half finished, but can be saved as a draft
    Given an events staff member "e4.events.bdd@example.com" with role "editor"
    When "e4.events.bdd@example.com" publishes an event with no gist or venue
    Then the events admin status should be 400
    And the refusal says "Add the gist for the front of the card."
    When "e4.events.bdd@example.com" saves an event with no gist or venue as a draft
    Then the events admin status should be 201

  Scenario: the preview is the real card, for anyone who can see events
    Given an events staff member "v5.events.bdd@example.com" with role "viewer"
    When "v5.events.bdd@example.com" previews an event called "Preview night (bdd-events)"
    Then the events admin status should be 200
    And the preview card shows "Preview night (bdd-events)"

  Scenario: an uploaded picture is served back as itself, and only a picture is accepted
    Given an events staff member "e6.events.bdd@example.com" with role "editor"
    When "e6.events.bdd@example.com" uploads a text file as an event picture
    Then the events admin status should be 400
    When "e6.events.bdd@example.com" uploads a small PNG as an event picture
    Then the events admin status should be 201
    When a visitor opens the uploaded picture
    Then the visitor gets status 200
    And the picture is served as "image/png" and never sniffed

  # ---- the events production starts with ----

  # TASK-456: the migration that gives EmpowHer its leaflet swaps each field only while it still
  # holds the seed's words, so this is the proof that the swap lands on the seeded row. TASK-472 then
  # takes the picture off again, as Jaimie did on production, and the words stay.
  Scenario: EmpowHer says what the leaflet says, without the leaflet itself
    Given an events staff member "v7.events.bdd@example.com" with role "viewer"
    When "v7.events.bdd@example.com" opens the admin's events
    Then the events admin status should be 200
    And "empowher-2026" has no picture
    And "empowher-2026" is at "AD Autocare, Wallacetown Drive, Heathfield, Ayr"
    And "empowher-2026" is credited on the front as "Organised by"
    And "empowher-2026" names "*Ali Wright* from Now Radio’s Ali and Michael in the Morning, your host for the evening" first on the back
