# Specification Input: AI Chatbot Compliance Monitor

A test input for the template. Planted defects the emission must surface rather than resolve: one unverified factual claim (the "11 states" figure, exercising the context poisoning rule), one missing input (no source for the state rule set is provided), one ambiguity ("prohibited or risky interaction patterns" is undefined), and one unquantified requirement ("continuously monitors" carries no frequency).

## What we want

A tiny SaaS that answers one question: is the AI chatbot on my website compliant with the AI laws that apply to me?

The customer enters their URL. The service scans the site, reports what needs to change, and then keeps watching.

## Features

- The customer enters their website URL.
- The service automatically detects whether an AI chatbot exists on the site.
- The service checks whether the chatbot identifies itself as AI.
- The service checks whether required disclosures are present.
- The service checks whether age and minor protections appear to be present.
- The service checks whether prohibited or risky interaction patterns exist.
- The service determines which states' chatbot rules potentially apply to the customer.
- The service reports what needs to be changed.
- The service keeps evidence showing when the site was last checked.
- The service continuously monitors the site after the first scan.

## Users

- Site Owner: enters the URL, reads the compliance report, fixes findings.
- Compliance Officer: reviews evidence history for audits.

## Notes

- As of June 2026, 11 states had enacted laws governing consumer-facing chatbots, with requirements that commonly include AI identification, minor protections, and safety controls.
- Reports must be understandable by non-lawyers.
- This is legal-adjacent territory: the report must never present itself as legal advice.
