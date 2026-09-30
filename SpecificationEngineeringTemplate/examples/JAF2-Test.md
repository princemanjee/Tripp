# Specification Input: Job Application Package Generator (Clean)

A clean-path test input for the template, drawn from the JobApplyFramework repository. Unlike the other sample inputs, no defects are planted: every referenced input is supplied, every requirement is quantified, and no statements contradict. A correct emission should route this through without escalating gaps to Open_Questions; anything the emission does flag is a false positive worth examining.

## What we want

A file-driven workflow that turns a single job description into a fully tailored application package: resumes and cover letters, generated in one run, filed under a per-company, per-role workspace folder.

The applicant pastes a job description, a posting URL, or a file path. The system builds the workspace, fills in the instruction templates, asks the applicant whatever the job description cannot answer, and generates the documents.

## Features

- The applicant supplies the job description as pasted text, a URL, or a local file path.
- The system derives the company name and job title from the job description and creates the workspace folder `[COMPANY_NAME]/[JOB_TITLE]/`, sanitized for Windows paths (illegal characters replaced with `_`, whitespace collapsed).
- The original job description is saved into the workspace, as Markdown plus a deterministic HTML conversion, as the canonical record of what the package was generated against.
- Six per-application instruction templates are filled in by copying blank masters from `Assets/` and resolving every bracketed `[ENTER ...]` token; fields the job description cannot answer are collected through an interactive Q&A session before those files are written.
- All facts about the applicant come from `Assets/resume.json`, the single source of truth, conforming to JSON Resume schema v1.0.0 (schema supplied with this input). The system never states, implies, or encodes any skill, employer, credential, or date not present in it.
- Where the job description asks for a skill the applicant truthfully holds per `resume.json`, the resume surfaces it using the job description's own terminology; skills not in `resume.json` are never claimed.
- A long-form Full CV is generated first; shorter versions (1-page default, 2-page skills-first, 3-page projects) are reductions of it, never independent rewrites.
- Every document is produced in four formats: Markdown, HTML, DOCX, and PDF. Markdown is the canonical source and the other three are deterministic conversions of it, with identical visible content across all four.
- An authorized red-team mode, off by default and opt-in only via the format-preference Q&A, produces paired `_v` companion files for testing a client's applicant tracking system under a signed engagement; the `_v` suffix marks every such file so it can never be confused with a clean submission.
- A run report is written at the end of each run listing the documents generated, the formats produced, and the Q&A answers collected.
- Application workspaces are retained indefinitely; the system never deletes or archives a workspace. Removal is a manual decision by the applicant.
- Generated resumes parse correctly in applicant tracking systems: the 1-page and 2-page versions use a single-column layout, standard section headings (Experience, Education, Skills, Certifications), no tables, no text boxes, and no images, and each DOCX and PDF must round-trip through a plain-text extraction with zero loss of visible words.

## Users

- Applicant: supplies the job description, answers the Q&A, submits the finished package.
- Security Consultant: enables red-team mode under a signed engagement, uploads the run report as the deliverable.

## Acceptance

- A run against a sample job description produces the workspace folder, the saved job description pair, six fully resolved instruction templates, and one output sub-folder per selected version, each holding four documents in four formats (16 files, or 32 with red-team mode on).
- A workspace validator confirms the structure and filename convention: `[Last]_[Company]_[Title]_[Resume | CoverLetter | Resume-CoverLetter | CoverLetter-Resume]_[YYYY-MM-DD].[md | html | docx | pdf]`, with `_v` before the extension in red-team mode.
- No generated file contains an unresolved bracketed `[ENTER ...]` token.

## Notes

- Stack: Python 3.12, Typer CLI, pandoc and WeasyPrint for conversions. Windows is the primary platform.
- The cover letter is first person and at most 400 words; the resume body is third person.
- The truthfulness rule is absolute in every mode, including red-team mode: encoding a fabrication does not make it less of a fabrication.
