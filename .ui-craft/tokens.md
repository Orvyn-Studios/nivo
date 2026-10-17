# Nivo — design tokens

| Role | Value |
| --- | --- |
| Capsule | #0C0E12 |
| Secondary surface | #171B22 |
| Raised control | #20252E |
| Primary text | #F5F7FA |
| Secondary text | #A4ABB7 |
| Accent/focus | #B8D4FF |
| Border | white, 8% opacity |
| Typography | Segoe UI Variable, Segoe UI, sans-serif |
| Capsule | 112 × 34 DIP; radius 17 DIP |
| Contextual surface | semantic sizes from `src/geometry.ts`; maximum 388 × 320 DIP |
| Native padding | 16 DIP |
| Visible top gap | default 8 DIP |
| Main inset | 20 DIP; 16 on narrow viewports |
| Controls | at least 32 DIP high; focus outline 2 DIP |
| Motion | semantic expansion 210–310 ms; collapse 190 ms; finite spring tracks |

Canonical CSS colors/spacing are in `src/tokens.css`. Dimensions above describe the native envelope, not a fixed empty panel. Durations are tuning values, not frame-rate guarantees. Reduced motion settles immediately; no decorative idle loop. Interior depth replaces exterior shadow to preserve a precise interactive region. See `docs/REDESIGN.md`.
