# Specification Input: Markdown Link Checker

A test input for the template. Planted defects the emission must surface rather than resolve: one missing input (the ignore file format is deferred to a sample file that is not supplied), one ambiguity ("large documentation sets are handled efficiently" defines neither large nor efficiently), and one unquantified requirement ("the report is easy to read" carries no measurable criterion). There is no compliance regime, no personal data, no network traffic, and nothing the tool deletes; it reads Markdown files and writes one report.

## What we want

A command-line tool that scans a folder of Markdown files and reports every link that does not resolve, so documentation authors and a CI job can catch broken links before they are published.

The author points the tool at a folder. It finds the Markdown files, extracts the links, checks each one that can be checked locally, and writes a report. The CI job runs the same command and fails the build when broken links are found.

## Features

- The tool accepts a root folder path and scans it recursively for files with the `.md` extension.
- Links are extracted from inline link syntax, reference-style link definitions, and image syntax.
- A relative link to a file is reported as broken when the target file does not exist relative to the linking file.
- A link to a heading anchor in the same file or in another local file is reported as broken when no heading in the target file produces that anchor. Anchors are derived from heading text the way common Markdown renderers derive them: lower-cased, punctuation removed, spaces replaced by hyphens.
- External links (`http` and `https`) are listed in the report as unchecked. The tool does not fetch them.
- Files and link patterns to skip are listed in a `.mdlinkignore` file at the root folder (see the sample `.mdlinkignore` for the format).
- The report is written as Markdown to a path the author chooses, and a short summary is printed to the terminal.
- The report is easy to read.
- The exit code is zero when no broken links are found and non-zero when at least one is found, so CI can fail the build.
- A `--quiet` flag suppresses the terminal summary and leaves only the exit code and the report file.
- Large documentation sets are handled efficiently.

## Users

- Documentation author: runs the tool locally on a folder, reads the report, fixes the links.
- CI job: runs the tool with `--quiet` on every push and fails the build on a non-zero exit code.

## Notes

- Stack: Python 3.12, Typer for the command-line interface, no third-party Markdown parser; link extraction is done with regular expressions.
- Windows and Linux paths both occur in the documentation sets; a link written with forward slashes should resolve on Windows.
- Case sensitivity of the file system is whatever the host provides; the tool does not try to correct for it.
