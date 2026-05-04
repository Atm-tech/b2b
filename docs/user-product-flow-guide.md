# Aapoorti User Guide: Full Product Flow

This guide explains how users should run one complete product cycle in Aapoorti B2B, from master setup to purchase, receipt, stock, sales, payment, and delivery closure.

## Purpose

Use this guide when you want to:

- create and maintain product masters
- buy stock from suppliers
- receive and verify goods in warehouse
- make stock available for sales
- book customer sales orders
- collect or verify payment
- complete delivery and close the order trail

## Core Flow

1. Admin sets up users, warehouses, products, and business parties.
2. Purchaser creates purchase orders against suppliers.
3. Accounts or purchaser records payment details if payment is made or committed.
4. Delivery team or supplier completes inbound movement.
5. Warehouse records receipt check and creates accepted stock.
6. Sales books sales orders from available stock.
7. Warehouse and delivery team process outbound dispatch.
8. Payment is collected or verified.
9. Delivery is completed and ledger is settled.

## Roles And What They Own

- `Admin`: users, warehouses, products, settings, oversight
- `Purchaser`: suppliers, purchase orders, inbound coordination
- `Accounts`: payment verification, dispute handling, ledger review
- `Warehouse Manager`: receipt checks, stock visibility, dispatch readiness
- `Sales`: shop onboarding, sales orders, customer payment capture
- `Delivery Manager`: delivery planning, assignment, route execution
- `In Delivery` / `Out Delivery` / `Delivery`: assigned task execution
- `Collection Agent`: sales payment collection follow-up
- `Data Analyst`: reporting and stock/order visibility

## Screen Map

Main sections visible by role in the app:

- `Users`: create and manage logins
- `Warehouses`: create receiving and dispatch points
- `Products`: create product masters
- `Parties`: create suppliers and shops
- `Purchase`: create purchase orders
- `Purchases`: review purchase order groups
- `Sales`: create sales orders
- `SalesOrders`: review grouped sales orders
- `Payments`: submit, verify, dispute, and resolve payments
- `Receipts`: record inbound warehouse receipt checks
- `Stock`: view available, reserved, and blocked stock
- `Delivery`: create and update transport tasks
- `Current Delivery` / `New Assignment`: executor-side delivery workflow
- `Ledger`: pending, partial, and settled order values
- `Settings`: payment methods and delivery charge settings
- `Notes`: operational note trail

## Before Daily Operations

Complete this setup before the first live transaction:

1. Create all working users in `Users`.
2. Create all physical sites in `Warehouses`.
3. Create all suppliers and customer shops in `Parties`.
4. Create all sellable SKUs in `Products`.
5. Confirm payment methods and delivery charge rules in `Settings`.
6. Check that each user has the correct role and warehouse scope.

## Step 1: Create Warehouses

Use `Warehouses` to create each site where stock will be received or dispatched.

Required details:

- warehouse code or ID
- warehouse name
- city
- address
- type: `Warehouse` or `Yard`

Use separate records if physical receipt and dispatch happen at different locations.

## Step 2: Create Product Masters

Use `Products` before any purchase or sales entry.

Each product should include:

- `sku`
- product name
- division, department, section, category
- unit
- GST mode and rate
- default weight per unit
- tolerance in kg and percent
- allowed warehouse IDs
- pricing slabs
- optional business fields such as barcode, HSN, brand, supplier reference, size, MRP, and RSP

User rule:

- A product should only be allowed in warehouses where it can actually be received and sold.

Operational rule:

- Weight and tolerance must be realistic because receipt checks use them to flag mismatches.

## Step 3: Create Parties

Use `Parties` to create both:

- `Supplier`
- `Shop`

Capture accurate details:

- name
- GST number if applicable
- mobile number
- address and city
- delivery address and city if different
- contact person
- bank details where required
- map or location data if available

User rule:

- Do not create duplicate parties with slightly different spellings.

## Step 4: Create Purchase Orders

Use `Purchase` to raise inbound orders from suppliers.

For each purchase line, capture:

- supplier
- product SKU
- warehouse
- ordered quantity
- rate
- taxable amount, GST, and total
- expected weight
- delivery mode: `Dealer Delivery` or `Self Collection`
- payment mode
- cash timing if cash is used
- note

What happens after creation:

- a purchase order or grouped cart ID is created
- ledger tracking starts
- the order becomes part of the inbound workflow

### Purchase Status Meaning

- `Draft`: order is not ready for action
- `Order Placed - Pending Delivery`: supplier order is raised, goods not yet received
- `Pickup Assigned`: self-collection pickup has been assigned
- `In Pickup`: goods are being collected from supplier
- `Order Delivered - Warehouse Check`: material reached warehouse and awaits receipt check
- `Partially Received`: some quantity was accepted
- `Received`: full order accepted
- `Closed`: operationally complete

### Purchase Best Practice

- Group all lines from one supplier order under the same public order/cart ID when they belong to one commercial transaction.

## Step 5: Record Purchase Payment

Use `Payments` for supplier-side payment entries.

Capture:

- side: `Purchase`
- linked order ID
- amount
- payment mode
- reference number
- voucher number, UTR, or proof file if available
- verification note
- status such as `Pending`, `Submitted`, or `Verified`

### Purchase Payment Meaning

- `Pending`: payment not yet fully confirmed
- `Submitted`: proof or reference submitted for review
- `Verified`: accounts accepted the payment
- `Rejected`: proof is not acceptable
- `Disputed`: mismatch needs investigation
- `Resolved`: disputed payment has been cleared

### Special Case: Cash With Delivery

If supplier payment is handed through delivery:

1. Create a purchase delivery task with payment action `Deliver Payment`.
2. Mark cash handover on the delivery task when done.
3. Upload proof if available.
4. Accounts should verify the final payment status.

## Step 6: Create Inbound Delivery Task

Use `Delivery` when goods movement is not passive and must be tracked.

For supplier-side pickup or payment delivery, create a task with:

- side: `Purchase`
- linked order ID or grouped IDs
- mode: `Dealer Delivery` or `Self Collection`
- transport type: `Internal` or `External`
- assigned person
- pickup/drop time if known
- route hint
- vehicle and freight for external transport
- payment action if money is moving
- status

### Purchase Delivery Task Meaning

- `Planned`: pickup assigned
- `Picked`: picked from supplier
- `Handed Over`: handed to warehouse
- `Delivered`: movement completed

## Step 7: Record Receipt Check

Use `Receipts` when the material reaches warehouse.

Capture:

- purchase order ID
- warehouse
- receiver
- ordered quantity
- received quantity
- pending quantity
- actual weight
- container weight
- net weight
- expected weight
- variance
- whether receipt is partial
- whether the receipt is flagged
- notes
- proof name if weighing proof exists

What receipt check does:

- creates a `GRC` record
- compares expected and actual values
- identifies weight mismatch
- marks partial or flagged receipts
- feeds accepted stock into inventory flow

### Receipt Rules

- If quantity is lower than ordered, use `partialReceipt`.
- If weight variance crosses tolerance, mark and review it.
- If physical goods do not match the purchase line, do not silently receive them.

## Step 8: Review Stock

Use `Stock` after receipt confirmation.

Users should check:

- warehouse-wise available quantity
- reserved quantity
- blocked quantity
- SKU-wise stock position

Meaning:

- `Available`: usable for sales
- `Reserved`: committed to outgoing sales
- `Blocked`: held for review or exception

Do not create live sales commitments if stock is not available.

## Step 9: Create Sales Orders

Use `Sales` to book customer orders.

Capture:

- shop/customer
- product SKU
- warehouse
- quantity
- rate
- taxable amount, GST, and total
- payment mode
- cash timing if relevant
- delivery mode: `Self Collection` or `Delivery`
- delivery charge
- note

What happens after creation:

- stock allocation is tied to a warehouse
- sales order enters outbound workflow
- payment and delivery tracking begins

### Sales Status Meaning

- `Draft`: incomplete order
- `Booked`: sales order created
- `Ready for Dispatch`: warehouse docket is ready
- `Pending Pickup`: assigned, warehouse pickup pending
- `Out for Delivery`: picked from warehouse
- `Self Pickup`: customer pickup flow
- `Delivered`: delivered to customer
- `Closed`: fully completed

## Step 10: Record Sales Payment

Use `Payments` for customer-side payments.

Capture:

- side: `Sales`
- linked order ID
- amount
- payment mode
- cash timing if cash is used
- reference number
- proof details
- verification note

### Sales Payment Flow

- salesperson or operator can submit payment proof
- accounts verifies, rejects, disputes, or resolves it
- collection staff can follow up on unpaid amounts

### Collection Status Meaning

- `None`: no separate collection workflow started
- `Assigned`: collection assigned
- `Collected`: cash or payment obtained
- `Reconciled`: collection matched in system

## Step 11: Prepare Outbound Delivery

For delivered sales orders, the warehouse and delivery team must move stock outward.

Outbound items can use:

- delivery dockets
- consignments
- delivery tasks

Use `Delivery` to create sales-side tasks with:

- side: `Sales`
- linked order ID or grouped IDs
- mode: `Delivery`
- assigned person
- transport type
- vehicle and freight where needed
- route hint
- payment action: usually `Collect Payment` if customer payment is pending
- cash collection required if money must be collected on route
- status

### Sales Delivery Task Meaning

- `Planned`: assigned, accept pending
- `Picked`: accepted, reach warehouse
- `Handed Over`: picked from warehouse
- `Delivered`: delivered

### Docket Status Meaning

- `Pending Packing`: warehouse packing
- `Ready`: SO docket ready
- `Tagged`: bundled for outbound
- `Pending Pickup`: assigned, warehouse pickup pending
- `Out for Delivery`: picked from warehouse
- `Delivered`: delivered

## Step 12: Complete Delivery And Payment Closure

When the driver or delivery user finishes the job:

1. Update the delivery task status.
2. Mark cash handover if payment was collected.
3. attach proof names where available
4. update payment records if customer cash or bank proof is received
5. let accounts verify or resolve the payment

The order is operationally complete when:

- stock has moved correctly
- delivery is complete
- payment is verified or reconciled
- ledger pending amount is zero

## How Users Should Read Workflow Status

Grouped order views show combined operational status.

For purchase:

- warehouse side status + payment side status
- example: `Received / Payment Completed`

For sales:

- fulfillment status + payment status
- example: `Picked from warehouse / Payment Partial`

For delivery:

- task status + assigned person
- example: `Assigned, accept pending to Ravi`

## Daily Operating Checklist

### Admin

1. Check user access and warehouse mapping.
2. Review exceptions in payments, receipts, and delivery.
3. Confirm master data hygiene.

### Purchaser

1. Create supplier orders accurately.
2. Ensure expected weight and payment mode are correct.
3. Track pending inbound delivery and receipt.

### Accounts

1. Review newly submitted payments.
2. Mark `Verified`, `Rejected`, `Disputed`, or `Resolved`.
3. Watch ledger entries with pending balances.

### Warehouse Manager

1. Process all receipts on arrival.
2. Check flagged and partial receipts.
3. Review available and reserved stock before dispatch.

### Sales

1. Book orders only against valid party and stock flow.
2. Capture payment details accurately.
3. Follow up on pending delivery and payment.

### Delivery Team

1. Accept assigned tasks.
2. Update pickup and drop actions on time.
3. Record proof and cash handover correctly.

## Common Mistakes To Avoid

- creating products without allowed warehouses
- entering duplicate supplier or shop names
- booking sales without checking stock
- skipping payment reference details
- receiving goods without weight verification
- closing tasks without proof or handover status
- using the wrong order ID while creating payment or delivery records

## Exception Handling

Escalate and document in `Notes` when any of these happen:

- payment proof rejected
- payment disputed
- supplier delivered less quantity
- received weight is outside tolerance
- stock appears blocked or missing
- wrong warehouse selected
- delivery marked complete but customer did not receive goods
- cash collected but not reconciled

## Recommended Real-World Sequence

For a normal buy-and-sell cycle, follow this exact order:

1. Create warehouse.
2. Create product.
3. Create supplier and shop.
4. Create purchase order.
5. Record supplier payment if applicable.
6. Create inbound delivery task if pickup is needed.
7. Record receipt check when goods arrive.
8. Confirm stock is available.
9. Create sales order.
10. Create outbound delivery task if dispatch is needed.
11. Record customer payment or collection.
12. Mark delivery complete.
13. Verify payment and confirm ledger settlement.

## What “Done” Looks Like

A product flow is complete when all of the following are true:

- the product exists in master data
- the item was purchased against a supplier
- the material was received and checked
- stock became available in warehouse
- the item was sold to a shop
- delivery was completed or customer collected it
- payment is verified or reconciled
- no unresolved flags remain in receipt, payment, or delivery

## Suggested Training Order For New Users

Train users in this order:

1. `Products` and `Parties`
2. `Purchase` and `Payments`
3. `Receipts` and `Stock`
4. `Sales` and `SalesOrders`
5. `Delivery`
6. `Ledger` and `Notes`

