# Specification Input: Tripp

The user Specification Input for Tripp version 1.0, gathered by interview on 2026-09-30. It is the input contract of `SpecificationEngineeringTemplate/modules/IntakeModule-v1.xml`: system name, intended final state, actors, and the features and constraints that bind the specification. Only what the owner stated goes in the sections below; anything assumed is recorded under Open Questions.

Status: INTERVIEW IN PROGRESS. Sections marked (pending) have not been answered yet.

## System name

Tripp

## Intended final state

(pending confirmation of the write-back below)

A password-protected portal, live on GitHub Pages and backed by Supabase, where the owner and one designated person leave each other private communications that nobody else can read.

## What we want

Stated by the owner on 2026-09-30:

- A location for private interaction between the owner and one other person.
- The two of them leave one another communications there, "like an alternative to direct messaging", "for our eyes only".
- It is "a secure place that is not known to anyone".
- Access is through a password-protected interface that unlocks a portal.
- The portal is live on GitHub Pages.
- Supabase is the backbone for data storage and security.

Context stated by the owner: the other person is the one who, in the event something happens to the owner, assumes all control and power of attorney over the owner's affairs with full proxy power.

## Users

- Owner: P. R. Manjee. Reads and leaves communications.
- The designated person: unnamed for now at the owner's request. Reads and leaves communications.
- Nobody else. Two users in total.

## Features

Decided by the owner on 2026-09-30:

- Sign-in is by password alone. There are no user names, no email addresses, and no registration process.
- There are exactly two passwords: one for the owner, one for the designated person.
- The owner sets both passwords, and only the owner can change them.
- Both people can leave text messages.
- Both people can leave file attachments.
- Messages are protected by login and database access rules ("login only"). Encryption in the browser before storage was offered and declined.

## Data

- Text messages and uploaded files, stored in Supabase.
- (pending) limits, retention, deletion.

## Notes

- Deployment target: a live site on GitHub Pages, ready for stakeholders. Stated by the owner on 2026-09-30.
- Timeline: version 1.0 built and deployed within a few hours of 2026-09-30 03:36 CDT. Stated by the owner.
- GitHub account is on the Free plan (stated by the owner), so GitHub Pages requires a public repository. The source code and the repository name are publicly visible.
- Accepted risk, owner's decision of 2026-09-30: with login-only protection, anyone who gains access to the Supabase account or dashboard can read the messages and files.

- Scope decision, owner's instruction of 2026-09-30 04:15 CDT: get something live now, with at least plain text, "interface, portal and function to relay messages"; features can be added later. Any off-the-shelf tool may be used.

## Out of scope for version 1.0

Moved out by the scope decision above; each remains wanted for a later version unless the owner says otherwise.

- File attachments (chosen by the owner earlier the same morning, then deferred by the scope decision).
- Seen markers, deleting messages, notifications.
- A safeguard against the free-tier pause described in OQ-3.

## Open Questions

- OQ-1: "Not known to anyone" against a public repository and a public URL. The page address and the code cannot be hidden on the Free plan. Working interpretation: the public page shows only a bare password prompt, and the code contains no secrets and no names. Not yet confirmed by the owner.
- OQ-2: Which Supabase account and project hold the data, and how the build gets access to it. Not yet answered.
- OQ-3: Supabase free-tier projects are paused after a period of inactivity. A paused project takes the portal offline until the account holder restores it. Not yet decided how to handle this.
