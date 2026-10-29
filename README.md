# SRPH AI Coach — web app

In-browser racing-telemetry coach for **Assetto Corsa Competizione** (MoTeC `.ld`) and
**iRacing** (`.ibt`).

Upload a session file and get measured lap analysis: times & consistency, per-corner
braking point / entry speed / peak deceleration, pedal & steering smoothness,
racing-line repeatability — plus A/B cross-session comparison against the bundled
reference laps.

## Using it

- Open this page in any modern browser (Chrome / Edge / Firefox).
- Drag a `.ld` or `.ibt` file onto the page (or use **Load telemetry**).
- All analysis runs **locally in your browser** — uploaded files never leave your machine.
- No API key is needed for core analysis. Optional: configure your own LLM endpoint in
  Settings to enable the built-in coach chat (the key is stored only in your browser's
  localStorage and sent only to that endpoint).

## First time? Getting your telemetry

[How to get your `.ld` file from Assetto Corsa Competizione](telemetry-setup.html) —
enabling MoTeC logging, where sessions are saved, and tips for logging data the
analysis can actually use.

## Bundled track data

Suzuka Circuit and Nürburgring Nordschleife ship with embedded reference laps, braking
zones and track boundaries. Any other track gets full driver-input analysis on upload.
