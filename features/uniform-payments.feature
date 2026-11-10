@admin @uniform-payments
Feature: Uniform payments are kept apart from donations (TASK-604)
  School uniforms the charity supplies are bought through a Stripe payment link marked product =
  uniform. A uniform is a purchase, never a gift: it is kept as a uniform payment, counted under its
  own Uniform tile in Admin > Donations, listed only there, and never recorded as a donation. Measured
  as a change, so other payments in the test database cannot get in the way. Every buyer and member
  of staff here is invented, with an address ending "uniform.admin.bdd@example.com".

  Background:
    Given an admin user "una.uniform.admin.bdd@example.com" with role "viewer" and password "uniform-pw-123"

  Scenario: a uniform payment link checkout is counted under Uniform, and never as a donation
    Given "una.uniform.admin.bdd@example.com" has noted the Uniform totals
    When Stripe completes a uniform payment link checkout of 4000 pence
    Then the webhook took it as "uniform.paid"
    And Uniform has gone up by 4000 pence from 1 payment, this month and in all
    And the Donate page has not changed
    And no donor or donation was recorded for the buyer
    And "una.uniform.admin.bdd@example.com" finds the buyer listed under Uniform only

  Scenario: the same checkout sent again is counted once
    Given "una.uniform.admin.bdd@example.com" has noted the Uniform totals
    When Stripe completes a uniform payment link checkout of 2500 pence
    And Stripe sends the same uniform checkout again under another event
    Then the webhook took it as "uniform.already_paid"
    And Uniform has gone up by 2500 pence from 1 payment, this month and in all

  Scenario: a refund in Stripe comes off the Uniform figures
    When Stripe completes a uniform payment link checkout of 4000 pence
    And "una.uniform.admin.bdd@example.com" has noted the Uniform totals
    And Stripe refunds 1500 pence of that uniform payment
    Then the webhook took it as "uniform.refunded"
    And Uniform has gone down by 1500 pence in all
