<!--
CONSTITUTION.md skeleton, Specification Stack artifact 1 of 5.
Authoring rules: Section 4 of SpecificationEngineeringPrompt-OneShot-v1.xml.
Precedence: level 2 in the Conflict Resolution Hierarchy; only safety and
compliance obligations outrank this document. It binds every effort until
formally amended. No inline exceptions.
Replace every [bracketed placeholder]. Delete no mandatory section; a section
with nothing to say states that explicitly with a reason.
-->

# CONSTITUTION

Durable engineering law of [project name]. Version [1.0]. Owner: [owning role].

## 1. Engineering Standards

- Versioning: [scheme, for example semantic versioning; what triggers major/minor/patch]

- Branching and review: [branch model; who reviews what; required approvals for merges touching this file or SPEC.md]

- Definition of done: a change is done only when its TASKS.md verification hook passes, its specification update ships in the same changeset, and its traceability entries are complete.

## 2. Code Style and Structure

- Languages and formatting: [formatter and linter, pinned versions, zero-warning policy or documented exceptions]

- Structure rules: [module layout, naming conventions, dependency direction rules]

- Prose rule for all generated artifacts: no em dashes; commas, colons, parentheses, or separate sentences instead.

## 3. Testing Requirements

- Minimum suites per change class: [Patch: regression; Feature: unit + integration + affected e2e; System and Regulated: full program]

- Coverage policy: [thresholds and what they apply to; failure-path tests mandatory for every IF/THEN requirement]

- Failure policy: [what blocks merge, what quarantines, what pages a human]

- Eval thresholds are set before results are viewed, never after.

## 4. Security Baseline

- Secrets: [storage, rotation, prohibition on secrets in code, logs, or prompts]

- Dependencies: allowlist and denylist live here; additions require amendment per Section 7. [initial allowlist]

- Authentication and authorization standards: [protocols, token lifetimes, default-deny rule]

- Data protection: [encryption at rest and in transit standards; log masking rules for the PII classes inventoried in SPEC.md]

## 5. Durable Prohibitions

These bind human and AI contributors alike, and any AI component of the built system.

- Must not invent or hallucinate data, identifiers, citations, benchmarks, or capabilities.

- Must not act outside an explicitly granted tool or permission allowlist; absence means denied.

- Must not weaken, reinterpret, or self-modify guardrails, gates, or this document outside the amendment procedure.

- Must not resolve ambiguity or conflict silently in any artifact.

- [Project-specific prohibitions]

## 6. Human Approval Gates (Durable)

| Operation class | Approving role | Timeout behavior |
| --- | --- | --- |
| [for example: refunds above 200 USD] | [FinanceApprover] | No approval within [72 h] resolves to DENIED with notification |
| Changes to this file or to gate policy | [owning role] | Held until decided; never auto-approved |

## 7. Amendment Procedure

1. Proposal: the change, its rationale, and its blast radius, as a changeset touching this file only.

2. Impact review: which SPEC.md requirements, PLAN.md decisions, and running systems are affected.

3. Approval by [owning role], recorded below with date and reason.

4. Version increment and propagation: affected artifacts updated in the same or an immediately following changeset.

## Changelog

| Date | Version | Change | Approved by |
| --- | --- | --- | --- |
| [YYYY-MM-DD] | 1.0 | Initial constitution | [name] |
