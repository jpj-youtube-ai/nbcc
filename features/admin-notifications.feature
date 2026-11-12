@admin @notifications
Feature: Phone notifications are behind the admin session (TASK-NNN)
  Turning notifications on, listing your phones and changing your settings all need a signed-in
  admin. Nobody else can reach them, and trying does not disturb the site.

  # The scenario this feature exists for.
  #
  # Three of these handlers once answered 401 themselves after authorizeAny had ALREADY sent one.
  # The second response throws ERR_HTTP_HEADERS_SENT inside an async handler, which is an
  # unhandled rejection, which ends the Node process — and the public site shares that process.
  # So an anonymous request with no credentials took the whole of nbcc.scot down.
  #
  # Note what is checked. The 401 alone passed against the broken code, because the 401 was sent.
  # The fault was everything that happened after it, which only "the site is still answering"
  # can see.
  Scenario Outline: An anonymous request is refused and leaves the site standing
    When I <method> the admin path "<path>" without a token
    Then the admin response status should be 401
    And the site is still answering

    Examples:
      | method | path                               |
      | GET    | /api/admin/push/key                |
      | GET    | /api/admin/push/subscription       |
      | POST   | /api/admin/push/subscription       |
      | DELETE | /api/admin/push/subscription       |
      | GET    | /api/admin/push/prefs              |
      | PUT    | /api/admin/push/prefs              |
