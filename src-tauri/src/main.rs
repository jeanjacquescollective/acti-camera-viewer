// Monitor desktop app: starts the Monitor server (server.js, built into
// monitor-server.exe) hidden in the background and shows its pages in a
// window. Other devices can still open http://<this-pc>:8080 while it runs.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::Write, path::Path, sync::Mutex, time::Duration};
use tauri::{
    webview::NewWindowResponse, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

struct Server(Mutex<Option<CommandChild>>);

fn main() {
    let app = tauri::Builder::default()
        // A second start just brings the open window to the front.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Monitor")
                .inner_size(1280.0, 820.0)
                .min_inner_size(480.0, 360.0)
                // Camera web pages and other links open in the normal browser.
                .on_new_window(|url, _| {
                    open_in_browser(&url);
                    NewWindowResponse::Deny
                })
                .build()?;

            // Settings live in %APPDATA%, the install folder isn't writable.
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let config = data_dir.join("cameras.json");
            seed_config(&config);

            match start_server(app.handle(), window.clone(), &config, &data_dir) {
                Ok(child) => *app.state::<Server>().0.lock().unwrap() = Some(child),
                Err(e) => show_error(&window, &format!("Could not start the Monitor server: {e}")),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Monitor");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
                // Let the server stop ffmpeg itself, then make sure everything is gone.
                let _ = child.write(b"quit\n");
                std::thread::sleep(Duration::from_millis(400));
                let _ = child.kill();
            }
        }
    });
}

fn start_server(
    app: &tauri::AppHandle,
    window: WebviewWindow,
    config: &Path,
    data_dir: &Path,
) -> Result<CommandChild, Box<dyn std::error::Error>> {
    let (mut rx, child) = app
        .shell()
        .sidecar("monitor-server")?
        .args(["--sidecar"])
        .env("CAMERAS_CONFIG", config)
        .set_process_group(true) // kill() also ends the server's ffmpeg processes
        .spawn()?;

    let mut log = fs::File::create(data_dir.join("monitor.log")).ok();
    tauri::async_runtime::spawn(async move {
        let mut opened = false;
        let mut tail: Vec<String> = Vec::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).trim_end().to_string();
                    if let Some(f) = log.as_mut() {
                        let _ = writeln!(f, "{text}");
                    }
                    if !opened {
                        if let Some(url) = text.trim().strip_prefix("MONITOR_URL ") {
                            if let Ok(url) = url.parse::<Url>() {
                                opened = window.navigate(url).is_ok();
                            }
                        }
                    }
                    if !text.trim().is_empty() {
                        tail.push(text.trim().to_string());
                        if tail.len() > 12 {
                            tail.remove(0);
                        }
                    }
                }
                CommandEvent::Terminated(status) => {
                    // Exit code 0 after MONITOR_URL means another Monitor serves the port: fine.
                    if !opened {
                        let code = status.code.map_or("unknown".into(), |c| c.to_string());
                        show_error(&window, &format!("The Monitor server stopped (exit code {code}).\n\n{}", tail.join("\n")));
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

// First start: take over a cameras.json that sits next to the app (e.g. copied
// from the old Monitor.exe folder). Otherwise the server creates a default one.
fn seed_config(config: &Path) {
    if config.exists() {
        return;
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        let old = dir.join("cameras.json");
        if old.exists() {
            let _ = fs::copy(old, config);
        }
    }
}

fn show_error(window: &WebviewWindow, text: &str) {
    let js = format!("showError({})", serde_json::to_string(text).unwrap_or_default());
    let _ = window.eval(&js);
}

fn open_in_browser(url: &Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = std::process::Command::new("explorer.exe").arg(url.as_str()).spawn();
    }
}
