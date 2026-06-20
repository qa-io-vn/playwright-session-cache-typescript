Feature: Inventory access via a cached session

  These scenarios never type a username or password. They rely entirely on the
  session captured once by the setup project — proof the login page is skipped.

  Scenario: Land on inventory without logging in
    Given I open the inventory page
    Then I should see the products page

  Scenario: The protected page is fully rendered
    Given I open the inventory page
    Then I should see 6 products

  Scenario: Re-entry stays authenticated
    Given I open the inventory page
    Then I should see the products page
