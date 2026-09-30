# VERSION_HISTORY

Follows the self-versioning protocol of `TemplateSpecs/ContextEngineringTemplatev4.xml` Appendix A: each version opens with a critique log recording dimensional scores and numbered revisions applied.

---

## v1.3 (2026-09-07) - Trigger T3 sharpened

Revision specified in `PRPs/specification-engineering-template.md` under "Revision 2026-09-07 (fourth)". Changed file: `SpecificationEngineeringTemplate-v1.xml` (trigger T3 rewritten, version 1.2 to 1.3). No module changed; `InstructionModule-v1.xml` stays at 1.2.

### Critique log (template scored against its own quality dimensions)

| Dimension | Score | Notes |
|---|---|---|
| Completeness | 94% | Unchanged. Seven example inputs, all with Level 4 emissions; the research PDF remains unread. |
| Testability | 93% | T3 now names what counts as evidence (an explicit marker), so a T3 decision can be disputed by pointing at the input. Under v1.2 the tie-break let T3 fire on any Ubiquitous feature, which made a T3 verdict unfalsifiable. |
| Intent Fidelity | 95% | No example's route changes: both JAF inputs still fire T3 on a marked rule, the acceptance input still routes Complex on T1, T2, and T4, the Standard-route input still fires nothing. The naming scheme still proceeds as a stated assumption. |
| Process Integrity | 100% | Revised through the PRP: defect recorded, decision stated, task amended, gates re-run, Level 4 run on the input that exhibited the defect before completion was reported. |

### Revisions applied

1. `complexity_routing` trigger T3 fires only on an explicit marker in the input (absolute, non-negotiable, guaranteed, in every mode, under no circumstances, or always or never applied to the system as a whole). A feature statement is triggered behaviour and does not fire T3. The absence of a marker is a determination, not a doubt, so the tie_break does not convert an unmarked feature into an invariant.

### Why

The v1.2 acceptance re-run fired T3 by tie-break on "Duplicate invoices are rejected". The route was Complex on three other triggers, so nothing changed, but a trigger that the tie-break can fire on any feature decides nothing. The acceptance reference pair now declares template version 1.3; the emission body is unchanged and the critique trail's T3 row cites the marker rule.

### Known gaps carried forward

- The research PDF listed in `INITIAL.md` is unreadable in this environment and its content is unverified against this package.

---

### Documentation addendum (2026-09-23, no version bump)

Specified in the PRP under "Revision 2026-09-23"; Task 2 amended. `README.md` only; no template file changed, so the package stays at 1.3. Three statements the package had outgrown were corrected. (1) The variation-test paragraph said "the four inputs" against seven; it is now count-neutral, because the seven intake validation rules are the fixed quantity and the inputs are not, and the sentence had gone stale once per input added. (2) The complexity-routing table explained each route with a prose "Use when" column, the same form v1.2 removed from the root document after two near-identical inputs routed differently on it; it now states the decision rule per route, names the five triggers and the `simple_condition`, and names the root document as authoritative so routing is not defined in two places. (3) `examples/GodelTerminal-CrawlInput.md` was on disk but in neither the structure listing nor the prose; it is now documented as the real-world demonstration input used for the end-to-end chain proof of 2026-08-14, which also reconciles the package's "seven example inputs" against the eight files in `examples/`. Gates G6 and G7 re-run on the README: 0 and 0. No Level 4 run: the README is operator documentation and is not loaded by any route.

---

## v1.2 (2026-09-07) - Routing as a decision procedure

Revision specified in `PRPs/specification-engineering-template.md` under "Revision 2026-09-07 (second)". Changed files: `SpecificationEngineeringTemplate-v1.xml` (dependency_map rewritten, version 1.1 to 1.2) and `modules/InstructionModule-v1.xml` (ROUTE stage, version 1.1 to 1.2).

### Critique log (template scored against its own quality dimensions)

| Dimension | Score | Notes |
|---|---|---|
| Completeness | 94% | Unchanged. All six example inputs have Level 4 emissions; the research PDF remains unread. |
| Testability | 92% | Routing was the last unscripted decision in the construction cycle. It is now five checkable triggers, a simple condition, a residual, and a tie-break, with the evaluation recorded in the emission where a reader can dispute it. Gate G-ROUTE-CRIT checks the structure; Level 4 checks that near-identical inputs route the same. |
| Intent Fidelity | 95% | The triggers were checked against all seven example inputs before adoption and reproduce five of the seven prior route decisions; the two they overturn are the JAF Standard runs, which the JAF2 Complex run had already contradicted. The naming scheme still proceeds as a stated assumption. |
| Process Integrity | 100% | Revised through the PRP: defect recorded, decision stated, task amended, gate added, all gates re-run, Level 4 run on both JAF inputs before completion was reported. |

### Revisions applied

1. `complexity_routing` in the root `dependency_map` is now a decision procedure: a `procedure` element stating the evaluation order and recording rule; triggers T1 (regulated or sensitive data), T2 (multi-domain), T3 (stated invariant), T4 (irreversible external effect), T5 (formal verification requested), any one of which routes Complex; a `simple_condition` that alone routes Simple; Standard as the residual; a `tie_break` that resolves doubt upward; a `rule` attribute on every `route`.
2. `construction_cycle` stage 2 (ROUTE) now evaluates every trigger in order against the Intake classification, records each as fired or not fired with its deciding evidence in the Process Summary, applies the tie_break, then loads the route's modules.

### Examples addendum (2026-09-07, no version bump)

Specified in the PRP under "Revision 2026-09-07 (third)". `examples/WorkedExample-EmittedPrompt.xml` now declares `template_version="1.2"`; its body is unchanged because the acceptance input routes Complex and v1.1 and v1.2 changed nothing about a Complex-route emission. `examples/WorkedExample-CritiqueTrail.md` added as the second half of the acceptance reference: the five Process Artifact sections, with the Process Summary carrying the five-trigger route table (T1, T2, T4 fired on quoted input lines) and the stage record. Level 4 step 4 now compares a run's critique trail against it. Also added the same day: `examples/SampleInput-MarkdownLinkChecker.md`, the Standard-route input.

### Why

`JAF2-Test.md` routed Complex on 2026-08-13 and `JAF-Test.md` routed Standard on 2026-09-06 and 2026-09-07, on the same subject, stack, and Notes. The v1.1 route descriptions were prose the agent had to interpret, and it interpreted them both ways. Under v1.2 both inputs fire T3 on the same Notes line.

### Known gaps carried forward

- No example input exercises the Standard route under the v1.2 triggers; all seven fire at least one. Standard-route behaviour (v1.1) is therefore proven only by the two JAF runs made under v1.0 and v1.1 routing. **Closed 2026-09-07, same day:** `examples/SampleInput-MarkdownLinkChecker.md` added, fires no trigger, routed Standard in a fresh-context Level 4 run and exercised both Standard-route stage forms (emission in `output/`).
- The research PDF listed in `INITIAL.md` is unreadable in this environment and its content is unverified against this package.

---

## v1.1 (2026-09-07) - Standard-route stage reference

Revision specified in `PRPs/specification-engineering-template.md` under "Revision 2026-09-07". Changed files: `modules/InstructionModule-v1.xml` (version attribute 1.0 to 1.1) and `SpecificationEngineeringTemplate-v1.xml` (package version 1.0 to 1.1). Filenames keep `-v1`; minor revisions live in the version attribute, which gate G10 matches on the major digit.

### Critique log (template scored against its own quality dimensions)

| Dimension | Score | Notes |
|---|---|---|
| Completeness | 94% | Level 4 has now run against all six example inputs (the last, `JAF-Test.md`, on 2026-09-06). The research PDF remains unread. |
| Testability | 90% | The defect below was found by a functional run, not a scripted gate, so a scripted gate now exists for it (G-ROUTE). The second finding from the same run, unstable routing between near-identical inputs, has no gate yet and is open in `TASK.md`. |
| Intent Fidelity | 95% | The fix changes no behaviour on the Complex route; it makes explicit on the Standard route what the loaded modules already required. The naming scheme still proceeds as a stated assumption. |
| Process Integrity | 100% | Revised through the PRP: defect recorded, decision stated, task amended, gate added, all gates re-run before completion was reported. |

### Revisions applied

1. `construction_cycle` stage 3 (REFINE) is now route-dependent. The Complex-route text is unchanged. The Standard-route text, using only the modules that route loads, derives Unwanted Behaviour requirements for reachable failure conditions, resolves contradictions through the `conflict_resolution_protocol` with the losing interpretation recorded in Open_Questions, and rewrites vague statements into EARS.
2. `construction_cycle` stage 5 (FORMALIZE) is now route-dependent. The Complex-route text is unchanged. The Standard-route text runs a mechanical substitute (ID present, statement matches the declared EARS keyword form, exactly one linked acceptance criterion) and records FORMALIZE as route-excluded in the Process Summary.

### Why

Every Level 4 run before 2026-09-06 routed Complex, so the Instruction module's unconditional references to the Verification module never met a route that had not loaded it. The `JAF-Test.md` run routed Standard and had to improvise the two stages; its critique recorded exactly what it did, and that record is what the Standard-route text now codifies.

### Known gaps carried forward

- Routing criterion: `JAF2-Test.md` routed Complex on 2026-08-13 and `JAF-Test.md` routed Standard on 2026-09-06 with the same subject and stack. The route descriptions in the `dependency_map` admit both readings.
- The research PDF listed in `INITIAL.md` is unreadable in this environment and its content is unverified against this package.

---

## v1.0 (2026-08-13) - Baseline

Derived from `TemplateSpecs/ContextEngineringTemplatev4.xml` through `PRPs/specification-engineering-template.md`, incorporating the author directive of 2026-08-13: eight-section specification anatomy, EARS-only functional logic, multi-phase verification pipeline (refinement, auto-formalization, health metrics), and the five-artifact Specification Stack mapped to ISO/IEC/IEEE 29148.

### Critique log (template scored against its own quality dimensions)

| Dimension | Score | Notes |
|---|---|---|
| Completeness | 92% | Six payload modules, three fallbacks, worked example pair, all corpus content encoded. `research/MediumArticleSpecificationEngineering.pdf` remains unread (no text layer); treated as superseded by the author directive but not verified against it. |
| Testability | 88% | Every scored dimension carries a threshold and 60/80/95 anchors; the anti-gaming rule is encoded on Testability. The Level 4 functional test (fresh-session run against the sample input) has not yet been performed. |
| Intent Fidelity | 95% | Every module traces to `INITIAL.md`, the `TemplateSpecs/` corpus, or the author directive of 2026-08-13. The naming scheme (template vs emitted instance) proceeds as a stated assumption the author has not confirmed. |
| Process Integrity | 100% | Generated through the repository's PRP flow with all scripted validation gates run before completion was reported. |

### Revisions applied

1. Baseline. No prior version.

### Known gaps carried forward

- Level 4 functional test pending: load the template in a fresh session against `examples/SampleUserSpecificationInput.md` and compare the emission to `examples/WorkedExample-EmittedPrompt.xml`.
- The research PDF listed in `INITIAL.md` is unreadable in this environment and its content is unverified against this package.
