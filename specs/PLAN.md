<!--
PLAN.md skeleton, Specification Stack artifact 3 of 5.
Authoring rules: Sections 2.2, 2.3 and 4 of SpecificationEngineeringPrompt-OneShot-v1.xml.
This file states HOW the system realizes SPEC.md within CONSTITUTION.md.
Design changes that alter any contract or boundary update this file and re-run
affected integration tests before merge.
-->

# PLAN

System: [system name]. Version [1.0]. Realizes SPEC.md version [1.0].

## 1. Component Architecture

| CMP id | Component | Responsibility | Boundaries (may call / may not call) | Realizes REQs |
| --- | --- | --- | --- | --- |
| CMP-001 | [name] | [single responsibility] | [calls X read-only; never touches Y] | REQ-F-001 |

[Optional: architecture diagram reference or ASCII sketch.]

## 2. Contextual Constraints of This Effort

| Component | Technology | Version pin | Rationale vs approved stack |
| --- | --- | --- | --- |
| [runtime] | [tech] | [exact or bounded pin] | [why, citing CONSTITUTION allowlist] |

Service boundaries: may create [list]; may modify [list]; may call [list, with access mode]; out of bounds [list].

## 3. Data Contracts

Every inbound and outbound payload, including the error envelope. Schemas name their draft.

### 3.1 [Interface name] input

```json
{"$schema": "https://json-schema.org/draft/2020-12/schema", "title": "[Name]", "type": "object", "required": ["[field]"], "properties": {"[field]": {"type": "[type]"}}}
```

### 3.2 [Interface name] output and error envelope

```json
{"$schema": "https://json-schema.org/draft/2020-12/schema", "title": "[Name]Error", "type": "object", "required": ["code", "message", "correlation_id"], "properties": {"code": {"type": "string", "enum": ["[ERROR_CODE]"]}, "message": {"type": "string"}, "correlation_id": {"type": "string"}}}
```

### 3.3 Cross-field validation rules

- VR-001: [predicate spanning fields or records, stated so it can be tested]

### 3.4 Integration boundaries

| Interface | Owner | Protocol | Auth | Rate limit | Timeout / retry | Versioning |
| --- | --- | --- | --- | --- | --- | --- |
| [name] | [team] | [HTTP/gRPC/queue] | [mode] | [limit] | [timeout, attempts, backoff] | [scheme] |

## 4. Persistence and Migrations

| Table/collection | Keys | Retention class (per SPEC 2.6 inventory) |
| --- | --- | --- |
| [name] | [pk, indexes] | [class, period] |

| Migration | Forward | Rollback | Data risk |
| --- | --- | --- | --- |
| M-001 | [change] | [exact reverse procedure] | [risk and mitigation] |

## 5. Risk Register

| RSK id | Risk | Likelihood | Impact | Mitigation | Owner |
| --- | --- | --- | --- | --- | --- |
| RSK-001 | [risk] | [L/M/H] | [L/M/H] | [mitigation, traced to a REQ or TASK where applicable] | [name] |

## 6. Open Technical Decisions

| Id | Decision needed | Options with consequences | Recommendation | Decide by |
| --- | --- | --- | --- | --- |
| OTD-001 | [question] | [A: ... / B: ...] | [rec + reason] | [gate or date] |

## Changelog

| Date | Change | Contracts affected | Author |
| --- | --- | --- | --- |
| [YYYY-MM-DD] | Initial plan | all | [name] |
