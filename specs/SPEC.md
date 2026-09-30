<!--
SPEC.md skeleton, Specification Stack artifact 2 of 5.
Authoring rules: Sections 2 and 4 of SpecificationEngineeringPrompt-OneShot-v1.xml.
This file is the behavioral truth of the system. Functional logic appears ONLY
in the six EARS patterns. Every register change re-triggers Phase B on the
affected subset; the verdict summary must always describe the current register.
-->

# SPEC

System: [system name, used verbatim as the <system name> in every EARS statement]. Version [1.0].

## 1. Objective

### 1.1 Business problem

[Who suffers, when, at what cost. One falsifiable paragraph.]

### 1.2 User roles

| Actor | Type (human/system) | Needs from this capability |
| --- | --- | --- |
| [Actor] | [human] | [need] |

### 1.3 Expected value

| Metric | Baseline | Target | Horizon |
| --- | --- | --- | --- |
| [metric] | [current] | [target] | [date or quarter] |

### 1.4 Non-goals

- NG-001: [Something a reasonable reader would have assumed was included, explicitly excluded, with one line of reason.]

## 2. Use Cases and Scenarios

| UC id | Actor | Scenario (EARS-driven narrative) | Realized by REQs |
| --- | --- | --- | --- |
| UC-001 | [actor] | [short scenario] | REQ-F-001, REQ-E-001 |

## 3. Requirement Register

Patterns: Ubiquitous; WHEN (Event); WHILE (State); WHERE (Optional); IF/THEN (Unwanted Behavior, mandatory for every error path); WHILE+WHEN (Complex). Vague qualifiers are prohibited inside pattern slots.

| Id | Pattern | Statement | Rationale | Source | Priority | Verification | AC refs | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-F-001 | [pattern] | [EARS statement] | [why] | [origin] | P1 | Test | AC-001 | ACTIVE |
| REQ-E-001 | Unwanted Behavior | IF [trigger], THEN the [system name] shall [safe response]. | [why] | [origin] | P1 | Test | AC-002 | ACTIVE |
| REQ-N-001 | [pattern] | [EARS statement with measurable bound] | [why] | [origin] | P2 | Analysis | AC-003 | ACTIVE |

Status values: ACTIVE, DEPRECATED(successor id). Ids are immutable; deprecated rows are kept.

## 4. Acceptance Criteria

Given maps from WHILE/WHERE; When maps from WHEN/IF; Then maps from shall-responses.

| AC id | Verifies | Given | When | Then (observable, with exact values or bounds) | Instrument | Fails if |
| --- | --- | --- | --- | --- | --- | --- |
| AC-001 | REQ-F-001 | [setup] | [action] | [outcome] | [harness/log query/metric] | [failing observation] |

## 5. Ambiguity Ledger

| Id | Source text | Interpretations | Recommendation | Status |
| --- | --- | --- | --- | --- |
| AMB-001 | "[exact input phrase]" | [reading A / reading B, each with consequence] | [recommended reading, reason] | OPEN or RESOLVED(decision, by, date) or ACCEPTED-RISK(rationale, by, date) |

## 6. Phase B Verdict Summary

| Date | Register version | CHECK_MODE | Conflicts | Gaps | Waivers |
| --- | --- | --- | --- | --- | --- |
| [date] | [git ref] | SOLVER or ENUMERATION(n states) or MANUAL | [0 or itemized CONFLICT(Ri, Rj, witness)] | [0 or itemized GAP(witness)] | [none or waiver + rationale + approver] |

## 7. Traceability Matrix

Empty cells are defects with the standing of failing tests.

| REQ | OBJ | CMP (PLAN.md) | TASK | AC | EV |
| --- | --- | --- | --- | --- | --- |
| REQ-F-001 | OBJ-001 | CMP-001 | TASK-001 | AC-001 | EV-001 |

## Changelog

| Date | Change | REQ ids touched | Author |
| --- | --- | --- | --- |
| [YYYY-MM-DD] | Initial specification | all | [name] |
