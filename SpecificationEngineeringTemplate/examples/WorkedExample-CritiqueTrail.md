# Critique Trail: Invoice Intake Service (worked example)

Process Artifact for `WorkedExample-EmittedPrompt.xml`, the reference emission from `examples/SampleUserSpecificationInput.md` under SpecificationEngineeringTemplate-v1.xml at template version 1.3. This is the acceptance reference for the critique trail: the five sections the Output Contract prescribes, the route decision as a trigger table, and the stage record. A real run's critique trail may differ in wording, in requirement count, and in the defects its draft happened to contain; it may not omit a section, a trigger row, or the stage record. The 2026-08-13 acceptance run in `output/` is a real example of such acceptable difference: it raised eight Open Questions where this curated reference raises the three that the input plants.

---

## Draft

The GENERATE pass produced a full prompt with all five PSpec elements and the nine-section anatomy.

- Intake classified the input's opening paragraph (which describes the sample's planted defects) as noise: commentary about the document, not a stakeholder need. No requirement traces to it.
- Intended final state, one sentence: a deployed service through which suppliers submit invoices as PDF or e-invoice XML via portal or email, validated against vendor master data, deduplicated, approved under role-based limits, queued for ERP payment, with a SOX-grade audit trail.
- Nine EARS requirements drafted across the INTK, VAL, APPR, QUE, AUD, PERF, and ARCH domains; two held in draft status because they rest on planted defects.
- The draft contained three defects of its own, caught in critique below.

## Critique

Scored against the Output Contract's calibrated anchors.

| Dimension | Draft score | Threshold | Verdict |
|---|---|---|---|
| Completeness | 82% | >= 90% | FAIL |
| Testability | 78% | >= 85% | FAIL |
| Intent Fidelity | 90% | >= 95% | FAIL |
| Process Integrity | in progress | 100% | pending |

Specific defects, one actionable fix each:

1. **Testability.** The draft gave the payment queue a retry cadence ("every 5 minutes up to 24 hours"). Neither number appears in the input; that is invented data. Fix: remove the cadence. REQ-QUE-001 states the queueing behaviour the input asks for and nothing the input does not.
2. **Intent Fidelity.** The draft turned "Old invoices are archived" into a 90-day rule. The threshold is fabricated. Fix: REQ-ARCH-001 held in draft status with a parameterized form; OQ-002 records the ambiguity.
3. **Testability, anti-gaming rule applied per requirement.** Cheapest wrong implementations found and closed: REQ-VAL-002 could pass by file-hash comparison and miss re-keyed duplicates, so its statement names the invoice number and vendor pair as the duplicate key, the most defensible reading of "duplicate invoices are rejected"; REQ-AUD-001 could pass with an editable log table, so the statement says append-only; REQ-APPR-001 was gameable at a total exactly equal to the limit, so its acceptance criterion names the one-cent-over case.
4. **Completeness.** The draft had no path for an extraction failure; a silent drop would break SOX traceability. Fix: REQ-VAL-003 added as an Unwanted Behaviour requirement routing the submission to the AP Clerk review queue with the failed fields named.
5. **Completeness.** "Nothing else without sign-off" clashes with features that Python, FastAPI, and PostgreSQL alone cannot deliver (PDF extraction, email intake, ERP transport). The draft had silently assumed libraries. Fix: the conflict_resolution_protocol resolved it for the explicit constraint over presumed intent; Contextual Constraints states the sign-off rule and the service boundary at the ERP payment queue, and library choice is left to the sign-off gate the target AI must pass in PLAN.md.
6. **Completeness.** vendor-master.json is cited but absent, and the draft had sketched plausible vendor fields into the VendorMaster contract. That is fabrication. Fix: the contract is marked UNRESOLVED with no fields, OQ-001 opened, REQ-VAL-001 specified at interface level only.
7. **Intent Fidelity.** "Processing must be fast" survived the draft as a pseudo-requirement. Fix: REQ-PERF-001 held in draft status; OQ-003 carries a parameterized measurable form awaiting the user's threshold.

## Revisions applied

1. Retry cadence removed from REQ-QUE-001.
2. REQ-ARCH-001 held in draft with a parameterized form; OQ-002 opened.
3. Duplicate key named in REQ-VAL-002; audit trail append-only in REQ-AUD-001; approval boundary pinned in the acceptance criterion of REQ-APPR-001.
4. REQ-VAL-003 added for the extraction-failure path.
5. Stack clash resolved for the explicit constraint; Contextual Constraints carries the sign-off rule and the service boundary.
6. VendorMaster contract marked UNRESOLVED with no fabricated fields; OQ-001 opened.
7. Performance claim moved into OQ-003 with REQ-PERF-001 in draft status.

## Final

Re-scored after revision (VALIDATE step, cycle 2 of a maximum 3):

| Dimension | Final score | Threshold | Verdict |
|---|---|---|---|
| Completeness | 93% | >= 90% | PASS. Every input line traces to a requirement, a constraint, or an Open Question; three Open Questions surfaced; the residual is the absent vendor master schema. |
| Testability | 90% | >= 85% | PASS. Every emitted requirement carries a bounded acceptance condition or is held in draft with a linked Open Question; the three planted vague items are not left gameable. |
| Intent Fidelity | 96% | >= 95% | PASS. No section introduces scope the input does not support; non-goals exclude payment execution and vendor master maintenance. |
| Process Integrity | 100% | 100% | PASS. All six construction stages ran in their Complex-route form; self_refine ran GENERATE, CRITIQUE, REVISE, VALIDATE; convergence reached in cycle 2. |

Convergence heuristic observed: a third cycle's candidate critiques changed only surface wording. Iteration stopped per the convergence guidance.

## Process Summary

### Stage 1, INTAKE

Required content present: Specification Input, intended final state (derived), system name (Invoice Intake Service), actors (Supplier, AP Clerk, Finance Manager). Optional content: approved stack supplied; compliance regime supplied (SOX); existing artifacts absent; model runtime preferences absent, so HP carries the contract defaults. Validation rules that fired: missing input (vendor-master.json), context clash (approved stack versus features), context distraction (the opening paragraph).

### Stage 2, ROUTE

Every trigger in the dependency map's complexity_routing, evaluated in order against the Intake classification:

| Trigger | Result | Deciding input line |
|---|---|---|
| T1 Regulated or sensitive data | Fired | Notes: "We are subject to SOX controls; keep an audit trail." A named compliance regime and an audit obligation. |
| T2 Multi-domain | Fired | Technical/Software (Notes: "Python 3.12, FastAPI, PostgreSQL 16") and Regulated Industry (T1 is defined as the same condition). Two signals. |
| T3 Stated invariant | Not fired | No line carries a marker (absolute, non-negotiable, guaranteed, in every mode, under no circumstances, always or never applied to the system as a whole). "Duplicate invoices are rejected" is a feature statement, which is triggered behaviour; the absence of a marker is a determination, so the tie_break is not applied. |
| T4 Irreversible external effect | Fired | Features: "Approved invoices are queued for payment in the ERP." A payment handoff to an external system. |
| T5 Formal verification requested | Not fired | No line asks for proofs, invariants, formal properties, or machine-checkable requirements. |

Simple condition: does not hold (a system with behaviour to specify; EARS requirements are written). Tie-break: not needed; T1 and T4 fire on quoted lines, T3 and T5 clearly do not.

Route: **Complex** (any trigger fired; three did). Modules loaded: Intake, Context, Instruction, Requirements, Verification, Output Contract, all primary variants. No fallback loaded.

### Stage 3, REFINE (Complex-route form)

The refinement phase of the Verification module ran in full. Abductive edge-case discovery worked backward from each actor's path and produced the extraction-failure path (REQ-VAL-003) and the over-limit boundary case in the acceptance criterion of REQ-APPR-001. Contradiction resolution found one pair, the approved-stack constraint against the features that need libraries outside it, and resolved it through the conflict_resolution_protocol with the explicit constraint winning. EARS rewriting expelled the two statements that resist all six patterns without invented values ("old invoices are archived", "processing must be fast") into draft-status requirements with linked Open Questions.

### Stage 4, POPULATE

Nine anatomy sections filled in order; every requirement carries id, pattern, priority, verification method, source, and rationale; Open_Questions is the ninth section and holds three entries, one per planted defect.

### Stage 5, FORMALIZE (Complex-route form)

The auto-formalization phase of the Verification module ran: two invariants (no stored invoice shares a vendor and invoice-number pair with another; no payment-queue entry exists for a total above the clerk limit without a Finance Manager approval record), a state variable set (submitted, extracted, validated, in review, approved, queued), one constants clause (the AP Clerk approval limit, supplied by configuration), and one liveness property (every validated and approved invoice reaches the queue). The consistency check found no pair of requirements that can fire together with conflicting responses. The completeness enumeration found the archived state unreachable by any prescribed transition, which is OQ-002 seen from the logical side.

### Stage 6, EMIT

Prompt assembled with all five PSpec elements and the Specification Stack instructions; self_refine applied as recorded above. Emitted artifacts: the Specification Engineering Prompt and this critique trail, under the Output Contract's emission rules. The Specification Stack itself is produced later by the target AI running the emitted prompt in the target repository.

### Defects planted in the input

All three were caught and routed per protocol, none resolved silently: the missing vendor master schema became blocking OQ-001 with the VendorMaster contract left unresolved, the archival ambiguity became OQ-002 with REQ-ARCH-001 held in draft, and the unquantified performance statement became OQ-003 with REQ-PERF-001 held in draft. The escalation rule was checked: no ambiguity would lead to fundamentally different specifications, so no clarifying question was required before emission.
