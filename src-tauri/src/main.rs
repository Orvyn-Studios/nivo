#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args()
        .nth(1)
        .is_some_and(|value| value.starts_with("chrome-extension://"))
    {
        nivo_lib::native_messaging_host();
        return;
    }
    nivo_lib::run();
}
