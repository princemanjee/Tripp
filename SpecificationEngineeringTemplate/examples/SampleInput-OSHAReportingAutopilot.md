# Specification Input: OSHA Reporting Autopilot for Multi-Location Employers

A test input for the template. Planted defects the emission must surface rather than resolve: one context clash (two pricing models are stated as alternatives with no decision, exercising the clash rule), one missing input (the designated high-hazard NAICS industry list is referenced but not supplied, and the format of "current OSHA records" is unspecified), one ambiguity ("tracks the preparation process" is undefined), and one phased-scope question (day one generates a ready-to-submit package; automated submission comes later, and the boundary between the phases is not drawn).

## What we want

Answer one question for employers with many locations: are my locations required to file with OSHA, and are my filings ready?

Do not attempt to become an entire EHS platform. Determine each establishment's filing obligation, track preparation, and generate the exact CSV required for submission.

## Features

- The system takes industry (NAICS), number of employees per establishment, location, current OSHA records, and an existing HR or payroll export.
- The system determines each location's obligation, for example: Location A not required, Location B 300A required, Location C 300A plus 300/301 required.
- The system tracks the preparation process for each location.
- The system generates the exact CSV required for electronic submission.
- Multi-location is the killer feature: a company with 40 locations must not have to figure this out 40 times.
- Deadline awareness: the annual filing deadline is March 2, and OSHA runs a non-responder enforcement program.

## Users

- HR or Safety Lead: loads establishment data, watches obligation status, downloads filing packages.
- Location Manager: supplies missing records for their establishment.

## Notes

- Obligations vary by employee count and industry; establishments with 100 or more employees in designated high-hazard industries have additional 300/301 reporting obligations.
- Business model, undecided between: $20 to $50 per location per month plus a $250 to $1,000 annual filing package, or $499 per year for up to 10 locations.
- Day one does not automate submission: generate the compliant file and provide a ready-to-submit package, then automate the repetitive parts later.
