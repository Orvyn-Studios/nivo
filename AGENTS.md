# Nivo by Orvyn

- Independent Windows Dynamic Island application. Never import StarOptimizer runtime or rename Nova.
- Tauri 2 + Rust + TypeScript + Vite, confirmed by the user's Nivo product brief. Keep the frontend framework-free unless a measured need justifies adding one.
- Work on `feature/nivo-mvp`; keep native integrations, UI state and presentation separate.
- Canonical repository: `https://github.com/SnoW-099/nivo.git`. Keep every Nivo change in this independent repository and use `origin` for this URL. The user authorized uploading development work here; do not push to StarOptimizer, modify `main`, or publish releases without separate authorization.
- Native media/notification data must come from Windows APIs. Browser preview is explicitly labelled and must never invent active sessions or notifications.
- No telemetry, remote scripts, filesystem/shell bridge, notification permission requests, autostart or security changes in the initial scaffold.
- Keep commands finite and allowlisted, with capabilities limited to the island webview. Preserve CSP.
- Zero continuous JS animation loops or polling in idle. Respect reduced motion and hidden documents.
- Node 24 or later is required for native TypeScript stripping in domain tests. Run `npm test` and `npm run typecheck`; stripping types is not static type checking. Run native Rust and visual tests when prerequisites permit. Report blocked checks; do not describe a scaffold or browser preview as a tested Windows app.
- Verify focus, Alt+Tab, transparency, tray exit, multimonitor/DPI and fullscreen suppression before any distribution. Do not enable topmost until fullscreen suppression is verified.
- Spanish UI. Follow `.ui-craft/brief.md` and `.ui-craft/tokens.md`.
- No release or remote repository creation until requested. Commit coherent local milestones.
