# Specification Input: Job Application Package Generator

A test input for the template, drawn from the JobApplyFramework repository. Planted defects the emission must surface rather than resolve: one contradiction (the truthfulness rule forbids fabrication, but a feature demands the resume claim every skill the job description asks for), one missing input (resume.json is named as the single source of truth but its schema is not supplied), one ambiguity ("stale application workspaces are cleaned up" defines neither stale nor cleaned up), and one unquantified requirement ("ATS-friendly" carries no measurable criterion and names no vendors).

## What we want

A file-driven workflow that turns a single job description into a fully tailored application package: resumes and cover letters, generated in one run, filed under a per-company, per-role workspace folder.

The applicant pastes a job description, a posting URL, or a file path. The system builds the workspace, fills in the instruction templates, asks the applicant whatever the job description cannot answer, and generates the documents.

## Features

- The applicant supplies the job description as pasted text, a URL, or a local file path.
- The system derives the company name and job title from the job description and creates the workspace folder `[COMPANY_NAME]/[JOB_TITLE]/`, sanitized for Windows paths.
- The original job description is saved into the workspace as the canonical record of what the package was generated against.
- Six per-application instruction templates are filled in from blank masters; fields the job description cannot answer are collected through an interactive Q&A session.
- All facts about the applicant come from resume.json, the single source of truth (see resume.json for the schema). The system never invents skills, employers, credentials, or dates that are not in it.
- The generated resume highlights every skill the job description asks for, so it always passes keyword screening.
- A long-form Full CV is generated first; shorter versions (1-page, 2-page skills-first, 3-page projects) are reductions of it, never independent rewrites.
- Every document is produced in four formats: Markdown, HTML, DOCX, and PDF, with identical visible content.
- An authorized red-team mode, off by default and opt-in only, produces paired `_v` companion files for testing a client's applicant tracking system, under a signed engagement.
- A run report is written at the end of each run describing what was generated and what questions were asked.
- Stale application workspaces are cleaned up.
- The generated package must be ATS-friendly.

## Users

- Applicant: supplies the job description, answers the Q&A, submits the finished package.
- Security Consultant: enables red-team mode under a signed engagement, uploads the run report as the deliverable.

## Notes

- Stack: Python 3.12, Typer CLI, pandoc and WeasyPrint for conversions. Windows is the primary platform.
- The cover letter is first person and at most 400 words; the resume body is third person.
- The truthfulness rule is absolute in every mode, including red-team mode: encoding a fabrication does not make it less of a fabrication.
