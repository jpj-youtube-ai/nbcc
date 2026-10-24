Feature: The site's icon (TASK-575)
  A browser tab shows the NBCC elf, and a page saved to a phone's home screen shows the whole logo
  named "NBCC". Browsers and iPhones ask for some of these addresses by themselves.

  Scenario Outline: the icon files answer at the addresses browsers ask for
    When a browser asks for the site icon at "<path>"
    Then the icon answers 200 with the content type "<type>"

    Examples:
      | path                               | type                      |
      | /favicon.ico                       | image/x-icon              |
      | /apple-touch-icon.png              | image/png                 |
      | /apple-touch-icon-precomposed.png  | image/png                 |
      | /assets/icons/site.webmanifest     | application/manifest+json |
      | /assets/icons/icon-512.png         | image/png                 |

  Scenario: the home page names its icons
    When a browser asks for the site icon at "/"
    Then the page names "/assets/icons/site.webmanifest" and "/assets/icons/apple-touch-icon.png" in its head

  Scenario: the manifest names the site NBCC and keeps it a bookmark
    When a browser asks for the site icon at "/assets/icons/site.webmanifest"
    Then the manifest's short name is "NBCC" and it opens in the browser
