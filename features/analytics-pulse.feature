@analytics @db
Feature: Counting visits without cookies (TASK-479)
  Every public page carries a small script that sends page views, leaves and the clicks that
  matter to POST /api/pulse. The endpoint always answers 204 with nothing in it, and keeps
  nothing until an admin switches collecting on. It never keeps an IP address, a user agent or a
  query string, drops bots, and files any page that is not one of ours as "other".

  Scenario: the public pages carry the visit counter
    When a visitor opens the page "/donate"
    Then the page loads the visit counter

  Scenario: while collecting is switched off, nothing is kept
    Given site analytics collecting is switched off
    When a visitor's browser sends a page view of "/donate"
    Then the pulse answer is 204 with nothing in it
    And no page view was kept

  Scenario: once collecting is switched on, a page view is kept, without the address or browser
    Given site analytics collecting is switched on
    When a visitor's browser sends a page view of "/donate" from "https://www.bing.com/search?q=christmas"
    Then the pulse answer is 204 with nothing in it
    And the page view was kept with the path "/donate"
    And the kept page view came from "search" via "Bing"
    And nothing kept holds the visitor's IP address or browser

  Scenario: a query string never reaches the table
    Given site analytics collecting is switched on
    When a visitor's browser sends a page view of "/donate?token=bdd-secret-token&utm_campaign=x"
    Then the page view was kept with the path "/donate"
    And nothing kept mentions "bdd-secret-token"

  Scenario: a bot is not counted
    Given site analytics collecting is switched on
    When a bot sends a page view of "/about-us"
    Then the pulse answer is 204 with nothing in it
    And no page view was kept

  Scenario: a page that is not one of ours is filed as other
    Given site analytics collecting is switched on
    When a visitor's browser sends a page view of "/no-such-page-bdd"
    Then the page view was kept with the path "other"

  Scenario: the time on the page and the clicks that matter are kept against the view
    Given site analytics collecting is switched on
    When a visitor's browser sends a page view of "/"
    And the browser sends a leave after 42 seconds, scrolled 70 percent
    And the browser sends a click on a link to "www.example.org"
    Then the kept page view spent 42 seconds and was read 70 percent of the way down
    And one "outbound" click was kept, labelled "www.example.org"

  Scenario: something that is not a pulse is answered the same way and kept nowhere
    Given site analytics collecting is switched on
    When a browser sends 5000 bytes of nonsense to the pulse
    Then the pulse answer is 204 with nothing in it
    And no page view was kept
