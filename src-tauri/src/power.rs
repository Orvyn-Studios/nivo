use serde::Serialize;
use std::sync::Mutex;
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerSnapshot {
    pub sequence: u64,
    pub present: Option<bool>,
    pub percent: Option<u8>,
    pub ac_online: Option<bool>,
    pub charging: Option<bool>,
    pub saving: bool,
    pub remaining_seconds: Option<u32>,
}
fn decode(flags: u8, percent: u8, ac: u8, saving: u8, remaining: u32) -> PowerSnapshot {
    let present = if flags == 255 {
        None
    } else {
        Some(flags & 128 == 0)
    };
    let has_battery = present == Some(true);
    PowerSnapshot {
        sequence: 0,
        present,
        percent: (has_battery && percent <= 100).then_some(percent),
        ac_online: match ac {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        },
        charging: has_battery.then_some(flags & 8 != 0),
        saving: saving == 1,
        remaining_seconds: (has_battery && remaining != u32::MAX && ac == 0).then_some(remaining),
    }
}
#[derive(Default)]
pub struct PowerService {
    snapshot: Mutex<PowerSnapshot>,
}
impl PowerService {
    pub fn refresh(&self) -> Result<PowerSnapshot, String> {
        #[cfg(windows)]
        let mut next = unsafe {
            use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
            let mut status = SYSTEM_POWER_STATUS::default();
            if GetSystemPowerStatus(&mut status) == 0 {
                return Err("Windows no pudo leer la alimentación.".into());
            }
            decode(
                status.BatteryFlag,
                status.BatteryLifePercent,
                status.ACLineStatus,
                status.SystemStatusFlag,
                status.BatteryLifeTime,
            )
        };
        #[cfg(not(windows))]
        let mut next = PowerSnapshot::default();
        let mut current = self
            .snapshot
            .lock()
            .map_err(|_| "Alimentación no disponible.".to_string())?;
        next.sequence = current.sequence;
        if *current != next {
            next.sequence += 1;
            *current = next;
        }
        Ok(current.clone())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absent_or_unknown_batteries_never_invent_charge_or_remaining_time() {
        for flags in [128, 255] {
            let value = decode(flags, 255, 255, 0, u32::MAX);
            assert!(
                value.percent.is_none()
                    && value.charging.is_none()
                    && value.remaining_seconds.is_none()
            );
        }
        let value = decode(8, 42, 1, 1, 3600);
        assert_eq!(value.percent, Some(42));
        assert_eq!(value.charging, Some(true));
        assert!(value.saving);
        assert!(value.remaining_seconds.is_none());
    }
    #[test]
    fn read_actual_windows_power_without_simulating_a_battery() {
        let value = PowerService::default().refresh().unwrap();
        assert!(value.percent.is_none_or(|value| value <= 100));
        println!(
            "NIVO_POWER_READ_ONLY {}",
            serde_json::to_string(&value).unwrap()
        );
    }
}
