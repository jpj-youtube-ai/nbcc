@fundraising @events @db
Feature: NBCC sells an event's tickets for its organiser
  An organiser holding an event can choose "NBCC sells the tickets for me" when all the ticket money
  comes to NBCC. They propose the kinds of ticket; staff approve each one before it goes on sale.
  People buy on the event's own page, in a Get tickets section apart from the give form: Stripe takes
  the payment, the webhook confirms it, and the buyer is emailed their tickets. A checkout holds its
  places, so the last ticket is never sold twice. Ticket money is never a gift and never has Gift
  Aid. An organiser can only ask for a refund; an admin makes it.

  Scenario: an organiser proposes tickets with their sign up, and staff approve them before any is on sale
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a1.et.fr.bdd@example.com" with role "admin"
    When someone signs up the event "The Ticketed Ceilidh (bdd-fr)" with NBCC selling "Adult" tickets at 1200 pence
    Then the fundraising answer is 200
    And the "Adult" ticket for "The Ticketed Ceilidh (bdd-fr)" is stored as "proposed"
    When "a1.et.fr.bdd@example.com" keeps the short name of "The Ticketed Ceilidh (bdd-fr)"
    And "a1.et.fr.bdd@example.com" approves "The Ticketed Ceilidh (bdd-fr)"
    And a visitor opens the event page for "The Ticketed Ceilidh (bdd-fr)"
    Then the visitor gets status 200
    And the page shows "Get tickets"
    And the page shows "Tickets go on sale soon. Check back here."
    When "buyer.et.fr.bdd@example.com" tries to buy 1 "Adult" ticket for "The Ticketed Ceilidh (bdd-fr)"
    Then the ticket answer is 409
    When "a1.et.fr.bdd@example.com" approves the "Adult" ticket for "The Ticketed Ceilidh (bdd-fr)"
    Then the "Adult" ticket for "The Ticketed Ceilidh (bdd-fr)" is stored as "approved"
    When a visitor opens the event page for "The Ticketed Ceilidh (bdd-fr)"
    Then the page shows "How many would you like?"
    And the page shows "Tickets are not donations, so Gift Aid does not apply."
    And the page shows "Make a donation"

  Scenario: sharing with another cause, NBCC cannot sell the tickets
    Given fundraising is switched on
    When someone sharing with another cause signs up the event "The Shared Ceilidh (bdd-fr)" with NBCC selling the tickets
    Then the fundraising answer is 400
    And the sign up is refused because the ticket money must all come to NBCC

  Scenario: buying tickets: Stripe confirms, the tickets are issued and emailed, and it is never a gift
    Given the events page is switched on
    And fundraising is switched on
    And an approved event "The Ticket Quiz (bdd-fr)" selling 50 "Adult" tickets at 1000 pence through NBCC
    When "robin.et.fr.bdd@example.com" tries to buy 2 "Adult" tickets for "The Ticket Quiz (bdd-fr)"
    Then the ticket answer is 200
    And the ticket answer gives a Stripe checkout address
    And "robin.et.fr.bdd@example.com" has a "pending" booking for 2 tickets
    When Stripe confirms the ticket checkout of "robin.et.fr.bdd@example.com", paid as "pi_fr_bdd_et_1"
    Then "robin.et.fr.bdd@example.com" has a "paid" booking for 2 tickets
    And an "eventTickets" email went to "robin.et.fr.bdd@example.com"
    And no donation was recorded for the payment "pi_fr_bdd_et_1"
    When Stripe sends the same confirmation again
    Then exactly 1 "eventTickets" email went to "robin.et.fr.bdd@example.com"
    When a visitor opens the event page for "The Ticket Quiz (bdd-fr)"
    Then the page shows "£20 from tickets, £0 in gifts"

  Scenario: the last tickets are held by a checkout, sold out when paid, and given back when a checkout expires
    Given the events page is switched on
    And fundraising is switched on
    And an approved event "The Small Quiz (bdd-fr)" selling 2 "Adult" tickets at 1000 pence through NBCC
    When "first.et.fr.bdd@example.com" tries to buy 2 "Adult" tickets for "The Small Quiz (bdd-fr)"
    Then the ticket answer is 200
    When "second.et.fr.bdd@example.com" tries to buy 1 "Adult" ticket for "The Small Quiz (bdd-fr)"
    Then the ticket answer is 409
    And the ticket answer says "Sorry, these tickets have sold out."
    When Stripe expires the ticket checkout of "first.et.fr.bdd@example.com"
    And "second.et.fr.bdd@example.com" tries to buy 2 "Adult" tickets for "The Small Quiz (bdd-fr)"
    Then the ticket answer is 200
    When Stripe confirms the ticket checkout of "second.et.fr.bdd@example.com", paid as "pi_fr_bdd_et_2"
    And a visitor opens the event page for "The Small Quiz (bdd-fr)"
    Then the page shows "Sold out"
    When "third.et.fr.bdd@example.com" tries to buy 1 "Adult" ticket for "The Small Quiz (bdd-fr)"
    Then the ticket answer is 409

  Scenario: an organiser asks for a refund, an admin makes it, and the counts and money follow
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a2.et.fr.bdd@example.com" with role "admin"
    And a fundraising staff member "e2.et.fr.bdd@example.com" with role "editor"
    And an approved event "The Refund Quiz (bdd-fr)" selling 10 "Adult" tickets at 1000 pence through NBCC
    And "sam.et.fr.bdd@example.com" has bought 2 "Adult" tickets for "The Refund Quiz (bdd-fr)", paid as "pi_fr_bdd_et_3"
    And the organiser of "The Refund Quiz (bdd-fr)" is signed in to their private area
    When the signed in organiser asks for a refund of the booking of "sam.et.fr.bdd@example.com" because "They are ill and cannot come."
    Then the fundraising answer is 202
    And an "eventTicketsRefundAsked" email went to the events inbox
    When "e2.et.fr.bdd@example.com" refunds 1 ticket on the booking of "sam.et.fr.bdd@example.com"
    Then the fundraising answer is 403
    When "a2.et.fr.bdd@example.com" refunds 1 ticket on the booking of "sam.et.fr.bdd@example.com"
    Then the fundraising answer is 200
    And the booking of "sam.et.fr.bdd@example.com" has 1000 pence refunded and 1 ticket left
    And an "eventTicketsRefund" email went to "sam.et.fr.bdd@example.com"
    And the refund asked for on the booking of "sam.et.fr.bdd@example.com" is "refunded"
    # The same click twice: the booking is no longer as that screen showed it, so Stripe is not asked again.
    When "a2.et.fr.bdd@example.com" sends that same refund again
    Then the fundraising answer is 409
    And the fundraising answer says "This booking has changed. Refresh and check before refunding."
    And exactly 1 refund has been made on the booking of "sam.et.fr.bdd@example.com"
    And the booking of "sam.et.fr.bdd@example.com" has 1000 pence refunded and 1 ticket left
    # A fresh look, but against the request that has already been refunded.
    When "a2.et.fr.bdd@example.com" refunds 1 ticket on the booking of "sam.et.fr.bdd@example.com" against the request already refunded
    Then the fundraising answer is 409
    And the fundraising answer says "That refund request has been dealt with already. Refresh and check before refunding."
    And exactly 1 refund has been made on the booking of "sam.et.fr.bdd@example.com"
    # Stripe's own events about it change nothing: the booking already agrees with Stripe.
    When Stripe reports 1000 pence refunded on the payment "pi_fr_bdd_et_3"
    Then the booking of "sam.et.fr.bdd@example.com" has 1000 pence refunded and 1 ticket left
    And exactly 1 "eventTicketsRefund" email went to "sam.et.fr.bdd@example.com"
    When a visitor opens the event page for "The Refund Quiz (bdd-fr)"
    Then the page shows "£10 from tickets, £0 in gifts"

  Scenario: the guest list for the door, and the CSV for staff
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "v3.et.fr.bdd@example.com" with role "viewer"
    And a fundraising staff member "e3.et.fr.bdd@example.com" with role "editor"
    And an approved event "The Door Quiz (bdd-fr)" selling 10 "Adult" tickets at 1000 pence through NBCC
    And "alex.et.fr.bdd@example.com" has bought 3 "Adult" tickets for "The Door Quiz (bdd-fr)", paid as "pi_fr_bdd_et_4"
    When "v3.et.fr.bdd@example.com" opens the guest list for "The Door Quiz (bdd-fr)"
    Then the fundraising answer is 200
    And the ticket page shows "3 Adult"
    And the ticket page shows "3 tickets in 1 booking"
    And the ticket page does not show "alex.et.fr.bdd@example.com"
    # A buyer's email and phone are for editors and admins: someone who may only look gets the
    # names and the tickets, in the CSV as on the screen.
    When "v3.et.fr.bdd@example.com" downloads the ticket CSV for "The Door Quiz (bdd-fr)"
    Then the fundraising answer is 200
    And the ticket page shows "3"
    And the ticket page does not show "alex.et.fr.bdd@example.com"
    When "e3.et.fr.bdd@example.com" downloads the ticket CSV for "The Door Quiz (bdd-fr)"
    Then the fundraising answer is 200
    And the ticket page shows "alex.et.fr.bdd@example.com"
    Given the organiser of "The Door Quiz (bdd-fr)" is signed in to their private area
    When the signed in organiser opens the guest list for "The Door Quiz (bdd-fr)"
    Then the ticket page shows "3 Adult"
    And the ticket page does not show "alex.et.fr.bdd@example.com"

  Scenario: two buyers at the same moment can never both take the last ticket
    Given the events page is switched on
    And fundraising is switched on
    And an approved event "The Last Ticket Quiz (bdd-fr)" selling 1 "Adult" tickets at 1000 pence through NBCC
    When "one.et.fr.bdd@example.com" and "two.et.fr.bdd@example.com" both try to buy 1 "Adult" ticket for "The Last Ticket Quiz (bdd-fr)" at the same moment
    Then exactly one of them is given a checkout, and the other is told the tickets have sold out
    And only 1 ticket is held or sold for "The Last Ticket Quiz (bdd-fr)"

  Scenario: a payment that lands after its places were given to someone else is recorded, flagged, and staff are told
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a4.et.fr.bdd@example.com" with role "admin"
    And an approved event "The Late Payment Quiz (bdd-fr)" selling 2 "Adult" tickets at 1000 pence through NBCC
    When "slow.et.fr.bdd@example.com" tries to buy 2 "Adult" tickets for "The Late Payment Quiz (bdd-fr)"
    Then the ticket answer is 200
    When Stripe expires the ticket checkout of "slow.et.fr.bdd@example.com"
    And "quick.et.fr.bdd@example.com" has bought 2 "Adult" tickets for "The Late Payment Quiz (bdd-fr)", paid as "pi_fr_bdd_et_5"
    And Stripe confirms the ticket checkout of "slow.et.fr.bdd@example.com", paid as "pi_fr_bdd_et_6"
    Then the booking of "slow.et.fr.bdd@example.com" is paid, and flagged as paid late with the event 2 over its limit
    And an "eventTickets" email went to "slow.et.fr.bdd@example.com"
    And an "eventTicketsToCheck" email went to the events inbox
    And "a4.et.fr.bdd@example.com" sees the booking of "slow.et.fr.bdd@example.com" flagged "Paid late: this event is now 2 over its limit"

  Scenario: staff cannot make a ticketed event share, sell tickets for one that shares, or drop the limit below what is taken
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a5.et.fr.bdd@example.com" with role "admin"
    And an approved event "The Staff Rules Quiz (bdd-fr)" selling 10 "Adult" tickets at 1000 pence through NBCC
    And "dana.et.fr.bdd@example.com" has bought 2 "Adult" tickets for "The Staff Rules Quiz (bdd-fr)", paid as "pi_fr_bdd_et_7"
    When "a5.et.fr.bdd@example.com" makes "The Staff Rules Quiz (bdd-fr)" share with another cause
    Then the fundraising answer is 409
    And the fundraising answer says "NBCC sells this event's tickets, so it can't share with another cause."
    When "a5.et.fr.bdd@example.com" sets the ticket limit for "The Staff Rules Quiz (bdd-fr)" to 1
    Then the fundraising answer is 409
    And the fundraising answer says "2 tickets are already sold or being bought, so the limit cannot be less than that."
    Given an approved event "The Shared Door Quiz (bdd-fr)" that shares with another cause, with pay on the door
    When "a5.et.fr.bdd@example.com" changes how people get in to "The Shared Door Quiz (bdd-fr)" to NBCC selling the tickets
    Then the fundraising answer is 409
    And the fundraising answer says "This event shares what it raises with another cause, so NBCC can't sell its tickets."

  Scenario: free tickets that still need booking are booked at once, with no Stripe, and the organiser can cancel one
    Given the events page is switched on
    And fundraising is switched on
    And an approved event "The Free Family Day (bdd-fr)" selling 5 "Family" tickets at 0 pence through NBCC
    When "fay.et.fr.bdd@example.com" tries to buy 2 "Family" tickets for "The Free Family Day (bdd-fr)"
    Then the ticket answer is 200
    And the ticket answer sends them straight to the thank you, with no Stripe checkout
    And "fay.et.fr.bdd@example.com" has a "paid" booking for 2 tickets
    And an "eventTickets" email went to "fay.et.fr.bdd@example.com"
    When a visitor opens the event page for "The Free Family Day (bdd-fr)"
    Then the page shows "Free"
    Given the organiser of "The Free Family Day (bdd-fr)" is signed in to their private area
    When the signed in organiser cancels the booking of "fay.et.fr.bdd@example.com"
    Then the fundraising answer is 200
    And "fay.et.fr.bdd@example.com" has a "cancelled" booking for 2 tickets
    And an "eventTicketsCancelled" email went to "fay.et.fr.bdd@example.com"
    And only 0 ticket is held or sold for "The Free Family Day (bdd-fr)"

  Scenario: ticket sales close when the host chose, not only when the event starts
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a6.et.fr.bdd@example.com" with role "admin"
    And an approved event "The Early Close Quiz (bdd-fr)" selling 10 "Adult" tickets at 1000 pence through NBCC
    When "a6.et.fr.bdd@example.com" sets ticket sales for "The Early Close Quiz (bdd-fr)" to close the day before
    Then the fundraising answer is 200
    When a visitor opens the event page for "The Early Close Quiz (bdd-fr)"
    Then the page shows "Sales close at midnight the day before."
    When "a6.et.fr.bdd@example.com" sets ticket sales for "The Early Close Quiz (bdd-fr)" to close at "2199-01-01T10:00"
    Then the fundraising answer is 400
    And the fundraising answer says "Ticket sales need to close before the event starts."
    When "a6.et.fr.bdd@example.com" sets ticket sales for "The Early Close Quiz (bdd-fr)" to close at "2020-01-01T10:00"
    Then the fundraising answer is 400
    And the fundraising answer says "Choose a time that hasn't passed yet."
    When "a6.et.fr.bdd@example.com" sets ticket sales for "The Early Close Quiz (bdd-fr)" to close at "2099-06-01T10:00"
    Then the fundraising answer is 200
    Given the closing time chosen for "The Early Close Quiz (bdd-fr)" has now passed
    When "late.et.fr.bdd@example.com" tries to buy 1 "Adult" ticket for "The Early Close Quiz (bdd-fr)"
    Then the ticket answer is 409
    And the ticket answer says "Ticket sales have closed."
    When a visitor opens the event page for "The Early Close Quiz (bdd-fr)"
    Then the page shows "Ticket sales have closed."

  Scenario: a buyer who starts again is never refused for their own checkout, and free bookings are capped
    Given the events page is switched on
    And fundraising is switched on
    And an approved event "The Start Again Quiz (bdd-fr)" selling 10 "Adult" tickets at 1000 pence through NBCC
    When "again.et.fr.bdd@example.com" tries to buy 2 "Adult" tickets for "The Start Again Quiz (bdd-fr)"
    Then the ticket answer is 200
    When "again.et.fr.bdd@example.com" tries to buy 3 "Adult" tickets for "The Start Again Quiz (bdd-fr)"
    Then the ticket answer is 200
    And "again.et.fr.bdd@example.com" has a "pending" booking for 3 tickets
    And only 3 ticket is held or sold for "The Start Again Quiz (bdd-fr)"
    Given an approved event "The Free Cap Day (bdd-fr)" selling 50 "Family" tickets at 0 pence through NBCC
    When "cap.et.fr.bdd@example.com" tries to buy 11 "Family" tickets for "The Free Cap Day (bdd-fr)"
    Then the ticket answer is 409
    And the ticket answer says "You can book up to 10 free tickets at a time. Need more? Email events@nbcc.scot."
    When "cap.et.fr.bdd@example.com" tries to buy 1 "Family" ticket for "The Free Cap Day (bdd-fr)"
    And "cap.et.fr.bdd@example.com" tries to buy 1 "Family" ticket for "The Free Cap Day (bdd-fr)"
    Then the ticket answer is 200
    When "cap.et.fr.bdd@example.com" tries to buy 1 "Family" ticket for "The Free Cap Day (bdd-fr)"
    Then the ticket answer is 429
    And the ticket answer says "You already have 2 free bookings for this event. Need more? Email events@nbcc.scot."

  Scenario: Stripe is the source of truth for refunds: its events finish one our side could not, and never twice
    Given the events page is switched on
    And fundraising is switched on
    And a fundraising staff member "a8.et.fr.bdd@example.com" with role "admin"
    And an approved event "The Lost Answer Quiz (bdd-fr)" selling 10 "Adult" tickets at 1000 pence through NBCC
    And "nia.et.fr.bdd@example.com" has bought 2 "Adult" tickets for "The Lost Answer Quiz (bdd-fr)", paid as "pi_fr_bdd_et_8"
    When "a8.et.fr.bdd@example.com" refunds 1 ticket on the booking of "nia.et.fr.bdd@example.com"
    Then the fundraising answer is 200
    And the booking of "nia.et.fr.bdd@example.com" has 1000 pence refunded and 1 ticket left
    And exactly 1 "eventTicketsRefund" email went to "nia.et.fr.bdd@example.com"
    # Stripe made that refund. Suppose our side had never finished it (the answer was lost).
    Given the refund on the booking of "nia.et.fr.bdd@example.com" was never finished here
    Then the booking of "nia.et.fr.bdd@example.com" has 0 pence refunded and 2 ticket left
    # Any refund event only says which payment: Stripe is asked, and the booking made to agree. The
    # event's own amount (wrong here, on purpose) is never used.
    When Stripe says a refund of 77 pence changed on the payment "pi_fr_bdd_et_8"
    Then the booking of "nia.et.fr.bdd@example.com" has 1000 pence refunded and 1 ticket left
    And exactly 1 refund has been made on the booking of "nia.et.fr.bdd@example.com"
    And exactly 2 "eventTicketsRefund" email went to "nia.et.fr.bdd@example.com"
    # Again, late and out of order, with totals that are not true: nothing changes, nobody is emailed.
    When Stripe says a refund of 2000 pence changed on the payment "pi_fr_bdd_et_8"
    And Stripe reports 2000 pence refunded on the payment "pi_fr_bdd_et_8"
    Then the booking of "nia.et.fr.bdd@example.com" has 1000 pence refunded and 1 ticket left
    And exactly 1 refund has been made on the booking of "nia.et.fr.bdd@example.com"
    And exactly 2 "eventTicketsRefund" email went to "nia.et.fr.bdd@example.com"
