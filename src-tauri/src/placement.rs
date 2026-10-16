pub const PADDING: f64 = 16.0;
pub const COMPACT_SURFACE: (f64, f64) = (112.0, 34.0);
pub const EXPANDED_SURFACE: (f64, f64) = (388.0, 320.0);

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[derive(Debug, PartialEq)]
pub struct SurfaceRegion {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub diameter: i32,
}

// Desktop coordinates are physical. DIP dimensions are scaled exactly once.
pub fn fit(
    origin: (i32, i32),
    size: (u32, u32),
    scale: f64,
    expanded: bool,
    horizontal_position: f64,
    top_gap: u16,
) -> Result<Placement, &'static str> {
    let (width, height) = size;
    if width == 0 || height == 0 || !scale.is_finite() || !(0.25..=16.0).contains(&scale) {
        return Err("Geometría de monitor no válida.");
    }
    if !horizontal_position.is_finite()
        || !(0.0..=1.0).contains(&horizontal_position)
        || top_gap > 128
    {
        return Err("Posición de isla no válida.");
    }
    let surface = if expanded {
        EXPANDED_SURFACE
    } else {
        COMPACT_SURFACE
    };
    let w = (((surface.0 + PADDING * 2.0) * scale).round() as u32).min(width);
    let h = (((surface.1 + PADDING * 2.0) * scale).round() as u32).min(height);
    let left = i64::from(origin.0) + (f64::from(width - w) * horizontal_position).round() as i64;
    // top_gap measures the visible surface, rather than its transparent
    // padding. Padding may extend above the work area; the surface may not.
    let inset = ((PADDING * scale).round() as u32).min(h.saturating_sub(1) / 2);
    let gap = (f64::from(top_gap) * scale).round() as i64;
    let offset = (gap - i64::from(inset)).min(i64::from(height - h + inset));
    let top = i64::from(origin.1) + offset;
    Ok(Placement {
        x: i32::try_from(left).map_err(|_| "Desbordamiento de coordenadas de escritorio.")?,
        y: i32::try_from(top).map_err(|_| "Desbordamiento de coordenadas de escritorio.")?,
        width: w,
        height: h,
        scale,
    })
}

pub fn surface_region(
    placement: &Placement,
    expanded: bool,
) -> Result<SurfaceRegion, &'static str> {
    let pad = (PADDING * placement.scale).round() as u32;
    let left = pad.min(placement.width.saturating_sub(1) / 2);
    let top = pad.min(placement.height.saturating_sub(1) / 2);
    let right = placement.width - left;
    let bottom = placement.height - top;
    let radius = if expanded {
        28.0
    } else {
        COMPACT_SURFACE.1 / 2.0
    };
    let diameter = ((radius * 2.0 * placement.scale).round() as u32)
        .min(right - left)
        .min(bottom - top);
    Ok(SurfaceRegion {
        left: i32::try_from(left).map_err(|_| "Región fuera de rango.")?,
        top: i32::try_from(top).map_err(|_| "Región fuera de rango.")?,
        right: i32::try_from(right).map_err(|_| "Región fuera de rango.")?,
        bottom: i32::try_from(bottom).map_err(|_| "Región fuera de rango.")?,
        diameter: i32::try_from(diameter.max(1)).map_err(|_| "Región fuera de rango.")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supports_negative_monitor_origins() {
        let p = fit((-1920, 0), (1920, 1040), 1.0, false, 0.5, 8).unwrap();
        assert_eq!((p.x, p.y, p.width, p.height), (-1032, -8, 144, 66));
    }

    #[test]
    fn applies_mixed_dpi_once() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let p = fit((1920, -120), (3840, 2160), scale, true, 0.5, 8).unwrap();
            assert_eq!(p.width, (420.0 * scale).round() as u32);
            assert_eq!(p.height, (352.0 * scale).round() as u32);
            let inset = (16.0 * scale).round() as i32;
            assert_eq!(p.y + inset, -120 + (8.0 * scale).round() as i32);
            assert!(i64::from(p.x) + i64::from(p.width) <= 5760);
        }
    }

    #[test]
    fn clamps_small_work_areas_and_anchor_edges() {
        let p = fit((-200, -60), (100, 40), 1.5, true, 1.0, 128).unwrap();
        let region = surface_region(&p, true).unwrap();
        assert_eq!((p.x, p.width, p.height), (-200, 100, 40));
        assert!(p.y + region.top >= -60);
        assert!(p.y + region.bottom <= -20);
        let left = fit((0, 0), (1920, 1080), 1.0, false, 0.0, 8).unwrap();
        let right = fit((0, 0), (1920, 1080), 1.0, false, 1.0, 8).unwrap();
        assert_eq!(left.x, 0);
        assert_eq!(right.x + right.width as i32, 1920);
    }

    #[test]
    fn rejects_invalid_coordinates_and_preferences() {
        assert!(fit((0, 0), (0, 1080), 1.0, false, 0.5, 8).is_err());
        assert!(fit((0, 0), (1920, 1080), f64::NAN, false, 0.5, 8).is_err());
        assert!(fit((0, 0), (1920, 1080), 1.0, false, f64::NAN, 8).is_err());
        assert!(fit((0, 0), (1920, 1080), 1.0, false, 1.01, 8).is_err());
        assert!(fit((0, 0), (1920, 1080), 1.0, false, 0.5, 129).is_err());
        assert!(fit((i32::MAX, 0), (1920, 1080), 1.0, false, 0.5, 8).is_err());
    }

    #[test]
    fn hit_region_excludes_transparent_padding_and_rounds_at_dpi() {
        let p = fit((0, 0), (1920, 1080), 1.5, false, 0.5, 8).unwrap();
        assert_eq!(
            surface_region(&p, false).unwrap(),
            SurfaceRegion {
                left: 24,
                top: 24,
                right: 192,
                bottom: 75,
                diameter: 51,
            }
        );
        let p = fit((0, 0), (2, 2), 1.0, true, 0.5, 8).unwrap();
        let region = surface_region(&p, true).unwrap();
        assert!(region.right > region.left && region.bottom > region.top);
    }
}
