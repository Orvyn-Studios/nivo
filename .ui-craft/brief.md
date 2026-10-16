# Nivo — product design brief

Independent Windows desktop island by Orvyn. Tauri 2, Rust, TypeScript and Vite. The full user brief on 2026-10-16 supersedes the initial JavaScript scaffold.

Quiet, top-centred capsule: 112 × 34 DIP, expanding into the same 388 × 320 DIP surface. The containing native window adds 16 DIP padding. The visible top gap is configurable, initially 8 DIP. System typography, graphitic surfaces and a restrained silver-blue accent. No decorative continuous motion, demo tracks, fake agents, oversized tutorial or mascot in the foundation phase.

Preserve spatial continuity, cancel obsolete transitions, fade/translate content within the shared capsule. Use reduced motion whenever the OS requests it. The current sampled critically damped trajectory does not establish continuous velocity across interruptions; this remains a polish and measurement task. Native region currently follows destination geometry rather than each animation frame: test intermediate click handling explicitly.

Native buttons, visible focus, intentional click expansion, Escape collapse and focus restoration for user-driven closure. Incoming notifications must never focus a control. Compact hover is a subtle border response. Text content remains readable, including empty, unavailable and error states. Preferences scroll inside the surface and reveal only controls connected to implemented behavior.

First functional target: validated preferences, native window/tray, real timer and own notices. Real media, fullscreen, hotplug and optional startup require their own native acceptance gates. The development browser identifies itself, and no browser test substitutes for Windows acceptance.
