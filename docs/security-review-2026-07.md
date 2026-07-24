# Security review — 2026-07

## Corrected

- Removed deployment aliases and scheduled jobs from the template default.
- Added release audit for tracked secrets and infrastructure artifacts.
- Added explicit authentication and workspace ownership checks to settings APIs.
- Scoped agent settings reads and writes to the owned workspace.
- Updated Next.js to 16.2.11.

## Validated

- `npm run audit:public-release`
- `npm test` (917 tests)
- `npm run build`

## Follow-up work

The template still has feature branches designed around a special workspace and
an all-zero placeholder UUID. These must become workspace settings or feature
flags before those optional pipelines can be considered fully generic.

`npm audit --omit=dev` still reports indirect vulnerabilities. The remaining
automated upgrade path requires breaking changes to the dependency graph, so it
should be handled in a dedicated compatibility update with full integration
testing.
