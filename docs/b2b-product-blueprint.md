# Aapoorti B2B Product Blueprint

## Core Business Flow

1. Admin creates product masters with pack size, weight, tolerance, and allowed receiving points.
2. Purchaser raises purchase entries against supplier and selects quantity slabs with negotiated rates.
3. Purchase creates expected inventory, expected landed weight, and a pending payment trail.
4. Purchaser or accounts uploads payment reference details such as mode, bank reference, UTR, and proof image.
5. Supplier dispatches goods or Aapoorti self-pickup is arranged through the purchase delivery workflow.
6. Authorized receiver at the tagged receiving point records goods receipt and creates a GRC number.
7. Received quantity and actual weight are checked against expected tolerance. Any mismatch raises a visible exception.
8. Accepted stock moves into inventory and becomes sellable.
9. Salesman creates a sales order only from available inventory, captures customer and GST details, and records payment mode or collection pending.
10. Warehouse handover and last-mile delivery complete the sales delivery workflow, with proof or cash collection status logged.

## Key Roles

- Admin: product master, receiving points, tolerance policy, approvals, exception monitoring
- Purchaser: supplier selection, purchase negotiation, self-pickup coordination, payment initiation
- Accounts: payment proof validation, ledger-ready reference control, settlement traceability
- Warehouse Receiver: goods receipt, GRC creation, weight verification, discrepancy notes
- Salesman: customer onboarding, order booking, payment proof capture
- Delivery Manager / Delivery Executive: pickup, handover, collection confirmation, proof of delivery

## Functional Modules

### Product Master

- product code, name, category, unit
- quantity slabs and target purchase rates
- default weight per unit
- tolerance percentage and tolerance in kg
- receiving point eligibility

### Purchase

- supplier and receiving point tagging
- slab-wise pricing and total landed estimate
- purchase note trail
- expected inventory reservation

### Accounts and Payment

- payment mode
- reference number / UTR / cheque details
- screenshot or proof attachment
- payable, paid, pending, and ledger-ready status

### Receipt and Quality

- GRC number generation
- expected vs actual quantity
- expected vs actual consignment weight
- variance flags and approval workflow

### Inventory

- stock available by receiving point
- blocked stock under review
- source purchase traceability

### Sales

- customer details with GST
- stock allocation from inventory
- mode of payment capture
- outstanding collection indicator

### Delivery

- purchase delivery: vendor delivery or self pickup
- sales delivery: warehouse handover and route execution
- delivery notes and issue reporting

## Exception Rules

- quantity mismatch
- purchase rate mismatch
- weight variance outside tolerance
- payment proof missing after paid status
- goods received at wrong point
- unauthorized receipt or handover

## Mobile Direction

The web app should remain installable and responsive so it can later be wrapped as an APK or turned into a PWA without redesigning the workflow.
