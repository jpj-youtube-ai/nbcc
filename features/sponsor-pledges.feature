@fundraising @fundraising-touch @sponsor-pledges @db
Feature: Sponsor now, pay after (sponsor pledges)
  On a sponsorship fundraiser's page a sponsor can promise an amount now and pay it after the event.
  A pledge is a promise, not money: it shows on the page apart from the money raised and never
  counts on the meter until it is paid. It counts for nothing until its sponsor confirms it from the
  one email sent when they pledge. The day after the event each sponsor is emailed a secure link to
  pay, once, and one reminder a week later, but only while the automatic emails are switched on and
  an admin has approved each email's wording. Paying makes an ordinary donation on the page, with the
  Gift Aid declaration made with the pledge. Every name and address here is invented.

  Scenario: a pledge shows nowhere until its sponsor confirms it by email, and never on the meter
    Given fundraising is switched on
    And a sponsorship fundraiser "Pips Pledge Walk (bdd-fr)" in 10 days, organised by "pip.pledge.fr.bdd@example.com"
    When "alex1.pledge.fr.bdd@example.com" pledges 1000 pence with Gift Aid on the page for "Pips Pledge Walk (bdd-fr)"
    Then the fundraising answer is 201
    And the pledge by "alex1.pledge.fr.bdd@example.com" on "Pips Pledge Walk (bdd-fr)" is "unconfirmed", with its Gift Aid declaration kept
    And exactly 1 "fundraisePledgeConfirm" email went to "alex1.pledge.fr.bdd@example.com"
    And the page for "Pips Pledge Walk (bdd-fr)" does not show "pledged £10"
    When "alex1.pledge.fr.bdd@example.com" opens the confirm link for their pledge on "Pips Pledge Walk (bdd-fr)"
    Then the pledge by "alex1.pledge.fr.bdd@example.com" on "Pips Pledge Walk (bdd-fr)" is "unconfirmed"
    When "alex1.pledge.fr.bdd@example.com" confirms their pledge on "Pips Pledge Walk (bdd-fr)"
    Then the fundraising answer is 200
    And the pledge by "alex1.pledge.fr.bdd@example.com" on "Pips Pledge Walk (bdd-fr)" is "open"
    And the page for "Pips Pledge Walk (bdd-fr)" shows 0 pence raised of 50000
    When a visitor opens the page for "Pips Pledge Walk (bdd-fr)"
    Then the visitor gets status 200
    And the page shows "Sponsor now, pay after"
    And the page shows "pledged by 1 sponsor, to be paid after"
    And the page shows "pledged £10"

  Scenario: a pledge nobody confirms is deleted after 7 days
    Given fundraising is switched on
    And a sponsorship fundraiser "Olas Pledge Jog (bdd-fr)" in 20 days, organised by "ola.pledge.fr.bdd@example.com"
    And "alex0.pledge.fr.bdd@example.com" pledges 1000 pence with Gift Aid on the page for "Olas Pledge Jog (bdd-fr)"
    And the pledge by "alex0.pledge.fr.bdd@example.com" on "Olas Pledge Jog (bdd-fr)" was made 6 days ago
    When the daily pledge tidy up runs
    Then the pledge by "alex0.pledge.fr.bdd@example.com" on "Olas Pledge Jog (bdd-fr)" is "unconfirmed"
    Given the pledge by "alex0.pledge.fr.bdd@example.com" on "Olas Pledge Jog (bdd-fr)" was made 7 days ago
    When the daily pledge tidy up runs
    Then there is no pledge by "alex0.pledge.fr.bdd@example.com" on "Olas Pledge Jog (bdd-fr)"
    And no "fundraisePledgeConfirm" email went to "alex0.pledge.fr.bdd@example.com"

  Scenario: the day after the event the pay email goes, once
    Given fundraising is switched on
    And the automatic emails are switched on
    And the pledge email wordings are approved
    And a sponsorship fundraiser "Rays Pledge Run (bdd-fr)" in 10 days, organised by "ray.pledge.fr.bdd@example.com"
    And "alex3.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Rays Pledge Run (bdd-fr)", and confirmed it
    When the daily pledge emails run
    Then no "fundraisePledgePay" email went to "alex3.pledge.fr.bdd@example.com"
    Given the event for "Rays Pledge Run (bdd-fr)" was yesterday
    When the daily pledge emails run
    Then exactly 1 "fundraisePledgePay" email went to "alex3.pledge.fr.bdd@example.com"
    When the daily pledge emails run
    Then exactly 1 "fundraisePledgePay" email went to "alex3.pledge.fr.bdd@example.com"

  Scenario: a pledge that was never confirmed gets no pay email
    Given fundraising is switched on
    And the automatic emails are switched on
    And the pledge email wordings are approved
    And a sponsorship fundraiser "Quins Pledge Run (bdd-fr)" in 10 days, organised by "quin.pledge.fr.bdd@example.com"
    And "alex2.pledge.fr.bdd@example.com" pledges 1000 pence with Gift Aid on the page for "Quins Pledge Run (bdd-fr)"
    And the event for "Quins Pledge Run (bdd-fr)" was yesterday
    When the daily pledge emails run
    Then no "fundraisePledgePay" email went to "alex2.pledge.fr.bdd@example.com"

  Scenario: nothing goes while the automatic emails are switched off
    Given fundraising is switched on
    And the automatic emails are switched off
    And the pledge email wordings are approved
    And a sponsorship fundraiser "Sals Pledge Swim (bdd-fr)" in 10 days, organised by "sal.pledge.fr.bdd@example.com"
    And "alex4.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Sals Pledge Swim (bdd-fr)", and confirmed it
    And the event for "Sals Pledge Swim (bdd-fr)" was yesterday
    When the daily pledge emails run
    Then no "fundraisePledgePay" email went to "alex4.pledge.fr.bdd@example.com"

  Scenario: wording that is not approved holds the email, and approving it lets it go
    Given fundraising is switched on
    And the automatic emails are switched on
    And a fundraising staff member "a1.pledge.fr.bdd@example.com" with role "admin"
    And a fundraising staff member "e1.pledge.fr.bdd@example.com" with role "editor"
    And a sponsorship fundraiser "Teds Pledge Trek (bdd-fr)" in 10 days, organised by "ted.pledge.fr.bdd@example.com"
    And "alex5.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Teds Pledge Trek (bdd-fr)", and confirmed it
    And the event for "Teds Pledge Trek (bdd-fr)" was yesterday
    When the daily pledge emails run
    Then no "fundraisePledgePay" email went to "alex5.pledge.fr.bdd@example.com"
    When "e1.pledge.fr.bdd@example.com" approves the "pledge_pay" pledge email wording
    Then the fundraising answer is 403
    When "a1.pledge.fr.bdd@example.com" approves the "pledge_pay" pledge email wording
    Then the fundraising answer is 200
    When the daily pledge emails run
    Then exactly 1 "fundraisePledgePay" email went to "alex5.pledge.fr.bdd@example.com"

  Scenario: staff cannot send the pay link before it is due
    Given fundraising is switched on
    And the automatic emails are switched on
    And the pledge email wordings are approved
    And a fundraising staff member "e2.pledge.fr.bdd@example.com" with role "editor"
    And a sponsorship fundraiser "Yens Pledge Paddle (bdd-fr)" in 10 days, organised by "yen.pledge.fr.bdd@example.com"
    And "alex11.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Yens Pledge Paddle (bdd-fr)", and confirmed it
    When "e2.pledge.fr.bdd@example.com" sends the pay link by hand for the pledge by "alex11.pledge.fr.bdd@example.com" on "Yens Pledge Paddle (bdd-fr)"
    Then the fundraising answer is 409
    And no "fundraisePledgePay" email went to "alex11.pledge.fr.bdd@example.com"
    Given the event for "Yens Pledge Paddle (bdd-fr)" was yesterday
    When "e2.pledge.fr.bdd@example.com" sends the pay link by hand for the pledge by "alex11.pledge.fr.bdd@example.com" on "Yens Pledge Paddle (bdd-fr)"
    Then the fundraising answer is 200
    And exactly 1 "fundraisePledgePay" email went to "alex11.pledge.fr.bdd@example.com"
    When "e2.pledge.fr.bdd@example.com" sends the pay link by hand for the pledge by "alex11.pledge.fr.bdd@example.com" on "Yens Pledge Paddle (bdd-fr)"
    Then the fundraising answer is 409
    And exactly 1 "fundraisePledgePay" email went to "alex11.pledge.fr.bdd@example.com"

  Scenario: paying a pledge makes a donation with its Gift Aid, and the meter moves
    Given fundraising is switched on
    And a sponsorship fundraiser "Unas Pledge Cycle (bdd-fr)" in 10 days, organised by "una.pledge.fr.bdd@example.com"
    And "alex6.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Unas Pledge Cycle (bdd-fr)", and confirmed it
    And the event for "Unas Pledge Cycle (bdd-fr)" was yesterday
    Then the page for "Unas Pledge Cycle (bdd-fr)" shows 0 pence raised of 50000
    When "alex6.pledge.fr.bdd@example.com" pays their pledge on "Unas Pledge Cycle (bdd-fr)" from the pay link, paid as "pi_fr_bdd_pledge_1"
    Then the fundraising answer is 200
    And the pledge by "alex6.pledge.fr.bdd@example.com" on "Unas Pledge Cycle (bdd-fr)" is "paid"
    And the donation paid as "pi_fr_bdd_pledge_1" is on "Unas Pledge Cycle (bdd-fr)" with Gift Aid, claimable, under the declaration made with the pledge
    And the page for "Unas Pledge Cycle (bdd-fr)" shows 1000 pence raised of 50000

  Scenario: a pledge paid twice is flagged, and the second payment carries no Gift Aid
    Given fundraising is switched on
    And a sponsorship fundraiser "Cals Pledge Canter (bdd-fr)" in 10 days, organised by "cal.pledge.fr.bdd@example.com"
    And "alex12.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Cals Pledge Canter (bdd-fr)", and confirmed it
    When "alex12.pledge.fr.bdd@example.com" opens two checkouts for their pledge on "Cals Pledge Canter (bdd-fr)" and both are paid, as "pi_fr_bdd_pledge_2a" and "pi_fr_bdd_pledge_2b"
    Then the pledge by "alex12.pledge.fr.bdd@example.com" on "Cals Pledge Canter (bdd-fr)" is "paid"
    And that pledge is flagged as paid twice
    And the donation paid as "pi_fr_bdd_pledge_2b" has no Gift Aid and no declaration
    And "alex12.pledge.fr.bdd@example.com" cannot start another payment for that pledge

  Scenario: a sponsor cannot pay less than they pledged
    Given fundraising is switched on
    And a sponsorship fundraiser "Vics Pledge Climb (bdd-fr)" in 10 days, organised by "vic.pledge.fr.bdd@example.com"
    And "alex7.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Vics Pledge Climb (bdd-fr)", and confirmed it
    When "alex7.pledge.fr.bdd@example.com" tries to pay 500 pence for their pledge on "Vics Pledge Climb (bdd-fr)"
    Then the fundraising answer is 400
    And the pledge by "alex7.pledge.fr.bdd@example.com" on "Vics Pledge Climb (bdd-fr)" is "open"

  Scenario: one reminder a week after the pay email, and then nothing
    Given fundraising is switched on
    And the automatic emails are switched on
    And the pledge email wordings are approved
    And a sponsorship fundraiser "Wyns Pledge Row (bdd-fr)" in 10 days, organised by "wyn.pledge.fr.bdd@example.com"
    And "alex8.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Wyns Pledge Row (bdd-fr)", and confirmed it
    And the event for "Wyns Pledge Row (bdd-fr)" was 8 days ago, and the pay email to "alex8.pledge.fr.bdd@example.com" went 7 days ago
    When the daily pledge emails run
    Then exactly 1 "fundraisePledgeReminder" email went to "alex8.pledge.fr.bdd@example.com"
    When the daily pledge emails run
    Then exactly 1 "fundraisePledgeReminder" email went to "alex8.pledge.fr.bdd@example.com"

  Scenario: the cancel link asks first, then cancels the pledge quietly
    Given fundraising is switched on
    And the automatic emails are switched on
    And the pledge email wordings are approved
    And a sponsorship fundraiser "Zaks Pledge Hike (bdd-fr)" in 10 days, organised by "zak.pledge.fr.bdd@example.com"
    And "alex9.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Zaks Pledge Hike (bdd-fr)", and confirmed it
    When "alex9.pledge.fr.bdd@example.com" opens the cancel link for their pledge on "Zaks Pledge Hike (bdd-fr)"
    Then the fundraising answer is 200
    And the pledge by "alex9.pledge.fr.bdd@example.com" on "Zaks Pledge Hike (bdd-fr)" is "open"
    When "alex9.pledge.fr.bdd@example.com" confirms they cannot pay their pledge on "Zaks Pledge Hike (bdd-fr)"
    Then the fundraising answer is 200
    And the pledge by "alex9.pledge.fr.bdd@example.com" on "Zaks Pledge Hike (bdd-fr)" is "cancelled"
    Given the event for "Zaks Pledge Hike (bdd-fr)" was yesterday
    When the daily pledge emails run
    Then no "fundraisePledgePay" email went to "alex9.pledge.fr.bdd@example.com"

  Scenario: an unpaid pledge loses its personal details 90 days after its pay email, and the email log forgets it
    Given fundraising is switched on
    And the automatic emails are switched on
    And the pledge email wordings are approved
    And a sponsorship fundraiser "Dees Pledge Dip (bdd-fr)" in 10 days, organised by "dee.pledge.fr.bdd@example.com"
    And "alex13.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Dees Pledge Dip (bdd-fr)", and confirmed it
    And the event for "Dees Pledge Dip (bdd-fr)" was yesterday
    When the daily pledge emails run
    Then exactly 1 "fundraisePledgePay" email went to "alex13.pledge.fr.bdd@example.com"
    Given the pay email for the pledge by "alex13.pledge.fr.bdd@example.com" on "Dees Pledge Dip (bdd-fr)" went 89 days ago
    When the daily pledge tidy up runs
    Then the pledge by "alex13.pledge.fr.bdd@example.com" on "Dees Pledge Dip (bdd-fr)" is "open"
    Given the pay email for the pledge by "alex13.pledge.fr.bdd@example.com" on "Dees Pledge Dip (bdd-fr)" went 90 days ago
    When the daily pledge tidy up runs
    Then that pledge is "expired", keeps its 1000 pence, and has no name, email, message or address
    And no "fundraisePledgePay" email went to "alex13.pledge.fr.bdd@example.com"
    And no "fundraisePledgeConfirm" email went to "alex13.pledge.fr.bdd@example.com"

  Scenario: the organiser sees names and totals, never an email, marks one paid in cash and undoes it
    Given fundraising is switched on
    And a sponsorship fundraiser "Bebs Pledge Dash (bdd-fr)" in 10 days, organised by "beb.pledge.fr.bdd@example.com"
    And "alex10.pledge.fr.bdd@example.com" has pledged 1000 pence with Gift Aid on the page for "Bebs Pledge Dash (bdd-fr)", and confirmed it
    And "alex14.pledge.fr.bdd@example.com" pledges 2000 pence with Gift Aid on the page for "Bebs Pledge Dash (bdd-fr)"
    And the organiser of "Bebs Pledge Dash (bdd-fr)" is signed in to their private area
    When the signed in organiser reads the pledges for "Bebs Pledge Dash (bdd-fr)"
    Then the fundraising answer is 200
    And the organiser sees 1 pledge of 1000 pence by "Alex Example", and no email address
    When the signed in organiser marks that pledge on "Bebs Pledge Dash (bdd-fr)" as paid in cash
    Then the fundraising answer is 200
    And the pledge by "alex10.pledge.fr.bdd@example.com" on "Bebs Pledge Dash (bdd-fr)" is "cash"
    And that pledge has no home address
    When the signed in organiser says that pledge on "Bebs Pledge Dash (bdd-fr)" was not paid in cash after all
    Then the fundraising answer is 200
    And the pledge by "alex10.pledge.fr.bdd@example.com" on "Bebs Pledge Dash (bdd-fr)" is "open"
    When the signed in organiser hides that pledge on "Bebs Pledge Dash (bdd-fr)" from their page
    Then the fundraising answer is 200
    And the page for "Bebs Pledge Dash (bdd-fr)" does not show "pledged £10"
