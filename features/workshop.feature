Feature: Workshop drop-offs
  Somebody bringing something into the Elves' Workshop leaves their details on the tablet page at
  /workshop, gets a thank you, and can join the newsletter. Staff see the list in the admin.

  Scenario: a drop-off is saved, and a ticked box joins the newsletter as a workshop sign up
    When somebody drops off "Two bags of selection boxes" at the workshop and ticks the newsletter box
    Then the workshop answers 201
    And the drop-off is saved with what they brought
    And they are on the newsletter list, signed up at the workshop

  Scenario: a bot filling the hidden box is answered and nothing is saved
    When a bot fills the hidden box on the workshop form
    Then the workshop answers 200
    And no drop-off is saved for the bot

  Scenario: the tablet page is served, kept out of search engines
    When somebody opens the workshop page
    Then the workshop answers 200
    And the workshop page asks search engines not to list it
