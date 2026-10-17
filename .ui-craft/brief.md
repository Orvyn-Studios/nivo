# Nivo — product design brief

Independent Windows desktop island by Orvyn. Tauri 2, Rust, TypeScript and Vite. The full user brief on 2026-10-16 supersedes the initial JavaScript scaffold.

Learned constraint, 2026-10-17: the user ran the release executable and confirmed the capsule appears, but reported poor fluency and insufficient visual refinement. Prioritize the transition's rendering cost and spatial continuity before adding more widgets. The user explicitly wants Nivo's own optional companion implemented; it must use original vector geometry, respond to actual states and remain still at idle. Do not treat successful compilation as design acceptance.

Quiet, top-centred capsule: 112 × 34 DIP, expanding into the same 388 × 320 DIP surface. The containing native window adds 16 DIP padding. The visible top gap is configurable, initially 8 DIP. System typography, graphitic surfaces and a restrained silver-blue accent. No decorative continuous motion, demo tracks, fake agents or oversized tutorial. The original optional vector companion now reacts to local pointer input and real timer/music states.

Preserve spatial continuity, cancel obsolete transitions, fade/translate content within the shared capsule. Use reduced motion whenever the OS requests it. Springs retain sampled velocity when retargeted, adapted with attribution from Coucou's MIT code. Animate a mask instead of width/height; never scale text. Confirm perceptual continuity and rendering cost on Windows before claiming fluency. Native region currently follows destination geometry rather than each animation frame: test intermediate click handling explicitly.

Native buttons, visible focus, intentional click expansion, Escape collapse and focus restoration for user-driven closure. Incoming notifications must never focus a control. Compact hover is a subtle border response. Text content remains readable, including empty, unavailable and error states. Preferences scroll inside the surface and reveal only controls connected to implemented behavior.

First functional target: validated preferences, native window/tray, real timer and own notices. Real media, fullscreen, hotplug and optional startup require their own native acceptance gates. The development browser identifies itself, and no browser test substitutes for Windows acceptance.
