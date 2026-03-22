// Use GUI subsystem on Windows so opening by double-click won't spawn a terminal.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
  fncviewer_lib::run();
}
