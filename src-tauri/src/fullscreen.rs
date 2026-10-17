//! Geometry policy only: monitor coverage is an observation, not proof of a
//! renderer's exclusive-fullscreen mode or compatibility with a particular game.
//! All inputs use physical desktop pixels, including negative monitor origins.

pub const EDGE_TOLERANCE_PX: i64 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhysicalRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl PhysicalRect {
    pub fn is_valid(self) -> bool {
        self.right > self.left && self.bottom > self.top
    }

    fn edges(self) -> [i64; 4] {
        [
            i64::from(self.left),
            i64::from(self.top),
            i64::from(self.right),
            i64::from(self.bottom),
        ]
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FullscreenObservation {
    pub covered: bool,
    pub monitor_rect: PhysicalRect,
}

#[derive(Clone, Copy, Debug)]
pub struct WindowGeometry {
    pub window_rect: PhysicalRect,
    pub frame_rect: PhysicalRect,
    pub monitor_rect: PhysicalRect,
    pub maximized: bool,
    pub has_standard_frame: bool,
}

/// `None` means the geometry is inconsistent/unknown, never "not fullscreen".
/// The monitor rectangle is rcMonitor, not rcWork: a maximized app above the
/// taskbar must not hide Nivo. Even with an auto-hidden taskbar, a conventional
/// maximized window remains a normal window; borderless maximized apps can cover
/// the monitor. A two-physical-pixel edge tolerance permits rounding without
/// mistaking a large, partially off-screen or monitor-spanning window for it.
pub fn classify(geometry: WindowGeometry) -> Option<FullscreenObservation> {
    let WindowGeometry {
        window_rect,
        frame_rect,
        monitor_rect,
        maximized,
        has_standard_frame,
    } = geometry;
    if !window_rect.is_valid() || !frame_rect.is_valid() || !monitor_rect.is_valid() {
        return None;
    }
    // DWM removes invisible resize borders. Its visible frame must still lie
    // within the outer window, allowing this policy's two-pixel tolerance.
    if i64::from(frame_rect.left) < i64::from(window_rect.left) - EDGE_TOLERANCE_PX
        || i64::from(frame_rect.top) < i64::from(window_rect.top) - EDGE_TOLERANCE_PX
        || i64::from(frame_rect.right) > i64::from(window_rect.right) + EDGE_TOLERANCE_PX
        || i64::from(frame_rect.bottom) > i64::from(window_rect.bottom) + EDGE_TOLERANCE_PX
    {
        return None;
    }
    let same_edges = frame_rect
        .edges()
        .into_iter()
        .zip(monitor_rect.edges())
        .all(|(frame, monitor)| (frame - monitor).abs() <= EDGE_TOLERANCE_PX);
    Some(FullscreenObservation {
        covered: same_edges && !(maximized && has_standard_frame),
        monitor_rect,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: PhysicalRect = PhysicalRect {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
    };

    fn window(frame_rect: PhysicalRect) -> WindowGeometry {
        WindowGeometry {
            window_rect: frame_rect,
            frame_rect,
            monitor_rect: MONITOR,
            maximized: false,
            has_standard_frame: false,
        }
    }

    #[test]
    fn recognizes_borderless_coverage_at_physical_resolutions_and_negative_origins() {
        for (width, height) in [(1920, 1080), (2560, 1440), (3840, 2160)] {
            let monitor = PhysicalRect {
                left: -width,
                top: -120,
                right: 0,
                bottom: height - 120,
            };
            let geometry = WindowGeometry {
                monitor_rect: monitor,
                ..window(monitor)
            };
            assert_eq!(
                classify(geometry),
                Some(FullscreenObservation {
                    covered: true,
                    monitor_rect: monitor,
                })
            );
        }
    }

    #[test]
    fn distinguishes_work_area_from_full_monitor() {
        let geometry = window(PhysicalRect {
            bottom: 1040,
            ..MONITOR
        });
        assert!(!classify(geometry).unwrap().covered);
    }

    #[test]
    fn conventional_maximized_window_is_not_fullscreen_even_with_auto_hidden_taskbar() {
        let geometry = WindowGeometry {
            maximized: true,
            has_standard_frame: true,
            ..window(MONITOR)
        };
        assert!(!classify(geometry).unwrap().covered);
        let borderless = WindowGeometry {
            has_standard_frame: false,
            ..geometry
        };
        assert!(classify(borderless).unwrap().covered);
    }

    #[test]
    fn compares_visible_dwm_frame_instead_of_invisible_resize_borders() {
        let geometry = WindowGeometry {
            window_rect: PhysicalRect {
                left: -8,
                top: -8,
                right: 1928,
                bottom: 1088,
            },
            ..window(MONITOR)
        };
        assert!(classify(geometry).unwrap().covered);
    }

    #[test]
    fn tolerance_is_two_physical_pixels_on_every_edge() {
        for delta in [-3, -2, 0, 2, 3] {
            for edge in 0..4 {
                let mut frame = MONITOR;
                match edge {
                    0 => frame.left += delta,
                    1 => frame.top += delta,
                    2 => frame.right += delta,
                    _ => frame.bottom += delta,
                }
                assert_eq!(classify(window(frame)).unwrap().covered, delta.abs() <= 2);
            }
        }
    }

    #[test]
    fn rejects_oversized_or_monitor_spanning_windows_as_fullscreen() {
        let geometry = window(PhysicalRect {
            right: 3840,
            ..MONITOR
        });
        assert!(!classify(geometry).unwrap().covered);
        assert!(
            !classify(window(PhysicalRect {
                left: 100,
                top: 80,
                right: 1000,
                bottom: 700,
            }))
            .unwrap()
            .covered
        );
    }

    #[test]
    fn inconsistent_or_degenerate_geometry_stays_unknown() {
        for rect in [
            PhysicalRect {
                right: 0,
                ..MONITOR
            },
            PhysicalRect {
                bottom: -1,
                ..MONITOR
            },
        ] {
            assert_eq!(classify(window(rect)), None);
            assert_eq!(
                classify(WindowGeometry {
                    monitor_rect: rect,
                    ..window(MONITOR)
                }),
                None
            );
        }
        assert_eq!(
            classify(WindowGeometry {
                window_rect: PhysicalRect {
                    right: 1900,
                    ..MONITOR
                },
                ..window(MONITOR)
            }),
            None
        );
    }

    #[test]
    fn comparisons_do_not_overflow_signed_desktop_coordinates() {
        let extreme = PhysicalRect {
            left: i32::MIN,
            top: i32::MIN,
            right: i32::MAX,
            bottom: i32::MAX,
        };
        assert!(
            classify(WindowGeometry {
                monitor_rect: extreme,
                ..window(extreme)
            })
            .unwrap()
            .covered
        );
        assert!(!classify(window(extreme)).unwrap().covered);
    }
}
