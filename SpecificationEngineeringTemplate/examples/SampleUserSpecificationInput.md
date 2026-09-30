# Specification Input: Invoice Intake Service

A realistic, deliberately imperfect user Specification Input for the worked example. It plants three defects the template must catch rather than resolve silently: one missing input (the vendor master schema is referenced but not supplied), one ambiguity ("old invoices are archived"), and one unquantified requirement ("processing must be fast").

## What we want

We need a service that accepts supplier invoices submitted as PDF or e-invoice XML, validates them against our vendor master data, and queues approved invoices for payment in the ERP.

## Features

- Suppliers upload invoices through the portal or send them by email.
- The service extracts invoice number, vendor, currency, line items, and totals.
- Invoices are validated against the vendor master data (see vendor-master.json for the schema).
- Duplicate invoices are rejected.
- Approved invoices are queued for payment in the ERP.
- Old invoices are archived.
- Processing must be fast.
- Finance Managers can approve invoices above the AP Clerk limit.

## Users

- Supplier: submits invoices.
- AP Clerk: reviews validation failures, approves invoices within their limit.
- Finance Manager: approves high-value invoices.

## Notes

- Stack: Python 3.12, FastAPI, PostgreSQL 16. Nothing else without sign-off.
- We are subject to SOX controls; keep an audit trail.
