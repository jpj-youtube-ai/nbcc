Feature: The admin installs on a phone as its own app

  Pinned to a home screen, the admin is a separate app from the public site: its own maroon icon,
  its own name, and a manifest that says standalone. The manifest being served, and served as a
  manifest, is what the phone acts on, so it is checked here rather than only as a file on disk.

  Scenario: the manifest is served, and served as a manifest
    When I request the site path "/assets/admin-icons/admin.webmanifest"
    Then the site response status should be 200
    And the site response content type should contain "manifest"
    And the site response should contain "\"display\": \"standalone\""
    And the site response should contain "\"start_url\": \"/admin\""
    And the site response should contain "NBCC Admin"

  Scenario: the home screen icon is served
    When I request the site path "/assets/admin-icons/apple-touch-icon.png"
    Then the site response status should be 200
    And the site response content type should contain "image/png"

  Scenario: the admin page points a phone at them
    When I request the site path "/admin"
    Then the site response status should be 200
    And the site response should contain "/assets/admin-icons/admin.webmanifest"
    And the site response should contain "apple-mobile-web-app-title"

  Scenario: the service worker is served from the root, so it can control the admin
    When I request the site path "/admin-sw.js"
    Then the site response status should be 200
    And the site response content type should contain "javascript"
    And the site response should contain "notificationclick"
