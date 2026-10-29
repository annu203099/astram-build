// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

#[derive(Default)]
struct DaemonState {
    child: Option<Child>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AgentProtectionOptions {
    #[serde(rename = "rootDir")]
    root_dir: Option<String>,
    #[serde(rename = "homeDir")]
    home_dir: Option<String>,
    #[serde(rename = "agentHosts")]
    agent_hosts: Option<Vec<String>>,
    #[serde(rename = "projectRoots")]
    project_roots: Option<Vec<String>>,
}

#[tauri::command]
async fn open_folder_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app
        .dialog()
        .file()
        .set_title("Select Project Directory for Astram Protection")
        .blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
async fn set_autostart(enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::env;
        if let Ok(exe_path) = env::current_exe() {
            let path_str = exe_path.to_string_lossy().to_string();
            let key = "AstramSecurityMicrokernel";
            let cmd = if enabled {
                format!(
                    "reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v {} /t REG_SZ /d \"\\\"{}\\\" --minimized\" /f",
                    key, path_str
                )
            } else {
                format!(
                    "reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v {} /f",
                    key
                )
            };
            let _ = Command::new("cmd").args(["/c", &cmd]).output();
        }
    }
    Ok(enabled)
}

fn spawn_daemon_if_needed(state: &Mutex<DaemonState>) {
    // Check if port 3080 is already active
    if let Ok(_) = std::net::TcpStream::connect("127.0.0.1:3080") {
        eprintln!("[astram-desktop] Daemon already running on 127.0.0.1:3080");
        return;
    }

    // Attempt to spawn node dist/index.js from server-daemon package
    eprintln!("[astram-desktop] Spawning Astram daemon sidecar...");
    let mut cmd = Command::new("node");
    cmd.args(["packages/server-daemon/dist/index.js"])
        .env("AEGIS_PORT", "3080");

    match cmd.spawn() {
        Ok(child) => {
            if let Ok(mut lock) = state.lock() {
                lock.child = Some(child);
            }
            eprintln!("[astram-desktop] Daemon spawned successfully");
        }
        Err(err) => {
            eprintln!("[astram-desktop] Warning: Could not spawn daemon sidecar: {}", err);
        }
    }
}

fn main() {
    let daemon_state = Mutex::new(DaemonState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(daemon_state)
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            set_autostart
        ])
        .setup(|app| {
            // Spawn background daemon sidecar
            let state = app.state::<Mutex<DaemonState>>();
            spawn_daemon_if_needed(&state);

            // Configure System Tray
            let open_item = MenuItem::with_id(app, "open", "Open Astram Command Center", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Astram", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("Astram Zero-Trust Security Microkernel")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        // Kill daemon child before exit
                        if let Some(state) = app.try_state::<Mutex<DaemonState>>() {
                            if let Ok(mut lock) = state.lock() {
                                if let Some(mut child) = lock.child.take() {
                                    let _ = child.kill();
                                }
                            }
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Minimize to tray on close
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Astram desktop application");
}

