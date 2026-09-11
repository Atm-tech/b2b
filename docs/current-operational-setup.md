# Current operational setup

Confirmed on 11 September 2026:

- `c21` is the single active warehouse manager for the Wholesale Warehouse (`C21`). `gp` is inactive; its historical records remain intact.
- `out` handles both Out Delivery and Collection Agent work with one login. `c` is inactive. Existing passwords are unchanged.
- The combined delivery login exposes Home, Current Delivery, New Assignment and Payments in its bottom navigation. Sales Orders and Ledger remain available through the normal navigation.
- Existing transactions, assignments, inventory and balances have not been moved, deleted or reset.
- The user is currently testing the WhatsApp flow. This is an operational designation, not database isolation: test transactions still use the existing database. The user will specify how to separate historical and test records later. Do not infer an archive cutoff or reset balances.
- Account seeding inserts missing defaults only; restarting the API must preserve updated roles, passwords and inactive accounts.

The account changes above were applied directly to the configured database. Deploying the code alone does not consolidate accounts in another database.
