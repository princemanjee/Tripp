<!--
EVALS.md skeleton, Specification Stack artifact 5 of 5.
Authoring rules: Sections 2.8 and 4 of SpecificationEngineeringPrompt-OneShot-v1.xml.
Discipline: thresholds are set BEFORE results are viewed; every production
failure adds a taxonomy entry and a regression case in the same changeset as
its fix; the adversarial suite only grows.
-->

# EVALS

System: [system name]. Proves conformance to SPEC.md version [1.0].

## 1. Dataset Registry

| Dataset | Purpose | Provenance | Size | Location | Update policy |
| --- | --- | --- | --- | --- | --- |
| golden | Expected-behavior exemplars | [source] | [n] | [path/uri] | [policy] |
| edge | Boundary and taxonomy-driven cases | Phase A edge sweep | [n] | [path/uri] | grows with refinement |
| adversarial | Injection, abuse, bypass attempts | Phase B rejected traces + red team | [n] | [path/uri] | only grows |
| regression | Every historical defect, reproduced | incident/defect records | [n] | [path/uri] | grows per fix, never pruned |

## 2. Failure Taxonomy

| Class id | Failure class | Symptoms | Linked incidents/defects | Guarding REQs |
| --- | --- | --- | --- | --- |
| FT-001 | [for example: silent dependency timeout] | [observable symptoms] | [refs] | REQ-E-001 |

## 3. Thresholds

Set per metric per component or model version, before any run is viewed. Breach consequence is explicit.

| EV id | Metric | Component/model | Threshold | On breach |
| --- | --- | --- | --- | --- |
| EV-001 | [for example: AC pass rate] | [component] | 100% | block merge |
| EV-002 | [for example: adversarial suite pass rate] | [component] | 100% | block merge, page [role] |
| EV-003 | [for example: recommendation agreement vs golden set] | [model vX] | [>= target] | quarantine model version |

## 4. Scenario Traces (from Phase B)

Accepted traces are executable expectations; rejected traces are permanent adversarial cases proving prohibited behavior stays unreachable.

| Trace id | Kind | Scenario (concrete values) | Expected outcome | Case ref |
| --- | --- | --- | --- | --- |
| T-ACC-001 | accepted | [state and action] | [prescribed response] | [test path] |
| T-REJ-001 | rejected | [state that must never yield the behavior] | [behavior does not occur; attempt logged where specified] | [test path] |

## 5. Run Log

| Date | Artifact versions (SPEC/PLAN/model) | Suites run | Results | Verdict |
| --- | --- | --- | --- | --- |
| [YYYY-MM-DD] | [refs] | [suites] | [pass/fail counts, links] | [PASS or itemized] |

## 6. Promotion Rules

- A component or model version advances only when: [all EV thresholds met on the current datasets; no open CONFLICT or GAP verdicts; coverage and freshness within Section 3 Phase C targets].

- Rollback trigger: [breach conditions that force reverting to the prior version].

## Changelog

| Date | Change | Author |
| --- | --- | --- |
| [YYYY-MM-DD] | Initial evals plan | [name] |
