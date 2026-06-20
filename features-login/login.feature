Feature: Login flow (NOT cached — fresh session every scenario)

  These run in the `login` project, which has no storageState and no setup
  dependency, so every scenario starts logged-out and exercises the real form.

  Background:
    Given I am on the login page

  Scenario: Valid credentials reach the inventory
    When I log in with "standard_user" and "secret_sauce"
    Then I should land on the inventory page

  Scenario: Wrong password is rejected
    When I log in with "standard_user" and "wrong_password"
    Then I should see the login error "do not match"

  Scenario: Locked-out user is blocked
    When I log in with "locked_out_user" and "secret_sauce"
    Then I should see the login error "locked out"

  Scenario: Missing username is required
    When I log in with "" and "secret_sauce"
    Then I should see the login error "Username is required"
