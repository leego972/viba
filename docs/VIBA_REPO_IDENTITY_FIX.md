# VIBA Repository Identity Fix

Date: 2026-06-28

## Problem

The active source repository is leego972/viba. Some older notes and examples may still use the previous project label.

That creates setup confusion and can send future maintenance work to the wrong place.

## Correct current identity

- Current repository: leego972/viba
- Current branch: main
- Current production domain: viba.guru

## Replit task

Search current docs and configuration examples for stale repository identity references.

Replace stale current setup references with leego972/viba.

Do not rename package folders in this pass. The frontend workspace path may still be named bridge-ai if that is the current package layout.

## Files to inspect

- README.md
- docs folder
- API server Doctor route
- maintenance and self-check notes
- Railway and Replit environment notes

## Acceptance criteria

- Current setup docs use leego972/viba.
- Current Doctor defaults use leego972/viba unless environment variables override them.
- Historical notes remain only when clearly historical.
- No workspace folder is renamed.
- Typecheck and build pass before merge.
