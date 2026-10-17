# Nivo - contextual desktop island

Tauri 2, Rust, TypeScript and Vite. The latest UI/UX brief replaces the dashboard with contexts while preserving actual Windows providers and opt-in adapters. Work from docs/REDESIGN.md and the established 60e1101 baseline.

The island is the product: no tabs, repeated branding, embedded preferences or fixed 320-DIP empty panel. Compact is 112 x 34 DIP. src/geometry.ts owns semantic sizes, bounded by the native envelope. Calm, music, HUDs, agents, downloads and Drop each have an appropriate composition. Preferences is a conventional independent window created only on explicit request.

Use graphite, soft white, subtle silver-blue and Segoe UI Variable. src/tokens.css is canonical. Icons have one vector language. The original white companion uses readable eyes and state-specific postures; finite gestures and bounded desktop cursor gaze, as requested in the follow-up. Suspend tracking when hidden, disabled or motion is reduced. Artwork and the companion share space without competing.

Preserve the existing attributed spring implementation. Precompute tracks, retain interruption velocity, animate the mask and opacity, never text scale or frame-by-frame layout. Native region samples use the same geometry with bounded/latest-only IPC. Refresh epochs after settings/display changes. No infinite idle loop. Respect OS reduced motion and visibility. Interior depth replaces external shadow; do not extend an invisible interactive rectangle to render decoration.

Spanish UI, keyboard, visible focus and clear unknown/disabled/error states. No fake media, tasks or percentages in production. Visual test fixtures must be identified in evidence. Review all captures and execute native checks; do not infer physical DPI, games, focus or presented FPS from a browser test. Keep topmost off until fullscreen acceptance.
