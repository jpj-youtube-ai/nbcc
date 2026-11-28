@admin @admin-drop-offs
Feature: Workshop drop-offs in the admin
  Admin > Giving > Workshop drop-offs lists everyone who left their details on the workshop tablet.
  Anyone who can view Donations sees the list; removing one needs Donations edit.

  Background:
    Given an admin user "ann.dropoffs.admin.bdd@example.com" with role "admin" and password "do-pw-123"
    And an admin user "vic.dropoffs.admin.bdd@example.com" with role "viewer" and password "do-pw-123"

  Scenario: a drop-off shows in the list, a viewer cannot remove it, and an admin can
    Given somebody has dropped off "Three boxes of toys" at the workshop
    When I ask for the workshop drop-offs without a session
    Then the drop-offs answer is 401
    When "vic.dropoffs.admin.bdd@example.com" lists the workshop drop-offs
    Then the drop-offs answer is 200
    And the list has the drop-off of "Three boxes of toys"
    When "vic.dropoffs.admin.bdd@example.com" removes that drop-off
    Then the drop-offs answer is 403
    When "ann.dropoffs.admin.bdd@example.com" removes that drop-off
    Then the drop-offs answer is 200
    And that drop-off is gone
