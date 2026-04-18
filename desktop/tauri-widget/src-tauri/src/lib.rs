use std::sync::Mutex;
use std::time::Duration;

use tauri::Emitter;
use tauri::Manager;

/// Serialize widget window creation so one platform race never creates two `widget` labels.
struct WidgetCreationLock(Mutex<()>);

impl WidgetCreationLock {
    fn lock_guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Build system tray after menus exist. On Linux, calling this synchronously inside `setup`
/// races GTK initialization and can trigger `gtk_widget_get_scale_factor` / GTK_IS_WIDGET
/// assertions — defer with `defer_tray_on_linux`.
fn install_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let show_widget_item = tauri::menu::MenuItemBuilder::new("Show Widget")
        .id("show_widget")
        .build(app)
        .map_err(|e| e.to_string())?;
    let hide_widget_item = tauri::menu::MenuItemBuilder::new("Hide Widget")
        .id("hide_widget")
        .build(app)
        .map_err(|e| e.to_string())?;
    let open_app = tauri::menu::MenuItemBuilder::new("Open App")
        .id("open_app")
        .build(app)
        .map_err(|e| e.to_string())?;
    let quit = tauri::menu::MenuItemBuilder::new("Quit")
        .id("quit")
        .build(app)
        .map_err(|e| e.to_string())?;

    let menu = tauri::menu::MenuBuilder::new(app)
        .items(&[&show_widget_item, &hide_widget_item, &open_app, &quit])
        .build()
        .map_err(|e| e.to_string())?;

    let tray_icon = tauri::include_image!("icons/32x32.png");
    let tray = tauri::tray::TrayIconBuilder::new()
        .icon(tray_icon)
        .tooltip("Personal Analytics Dashboard")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_widget" => {
                let _ = show_widget(app);
            }
            "hide_widget" => {
                let _ = hide_widget(app);
            }
            "open_app" => {
                open_main_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    app.manage(TrayState(tray));
    Ok(())
}

#[cfg(target_os = "linux")]
fn defer_tray_on_linux(handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        let app_for_tray = handle.clone();
        if let Err(e) = handle.run_on_main_thread(move || {
            if let Err(err) = install_tray(&app_for_tray) {
                eprintln!("[tauri-widget] System tray unavailable: {}", err);
            }
        }) {
            eprintln!("[tauri-widget] Could not schedule tray on main thread: {}", e);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Do not create the widget webview during setup (see try_build_widget_window).
            app.manage(WidgetCreationLock(Mutex::new(())));
            app.manage(WidgetToken(std::sync::Mutex::new(None)));

            #[cfg(target_os = "linux")]
            {
                defer_tray_on_linux(app.handle().clone());
            }
            #[cfg(not(target_os = "linux"))]
            {
                if let Err(e) = install_tray(app.handle()) {
                    eprintln!("[tauri-widget] System tray unavailable: {}", e);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_widget_window,
            hide_widget_window,
            set_widget_token,
            get_widget_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[allow(dead_code)]
struct TrayState(tauri::tray::TrayIcon<tauri::Wry>);

struct WidgetToken(std::sync::Mutex<Option<String>>);

#[tauri::command]
fn set_widget_token(token: Option<String>, app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<WidgetToken>();
    let mut g = state.0.lock().map_err(|e| e.to_string())?;
    *g = token;
    drop(g);
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.emit("widget-token-updated", ());
    }
    Ok(())
}

#[tauri::command]
fn get_widget_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<WidgetToken>();
    let g = state.0.lock().map_err(|e| e.to_string())?;
    Ok(g.clone())
}

fn open_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

const WIDGET_CREATE_ATTEMPTS: usize = 4;

fn try_build_widget_window(app: &tauri::AppHandle) -> Result<(), String> {
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "widget",
        tauri::WebviewUrl::App("index.html?widget=1".into()),
    )
    .title("Today's plan")
    .inner_size(380.0, 320.0)
    .min_inner_size(300.0, 220.0)
    .resizable(false)
    .maximizable(false)
    .decorations(false)
    .always_on_top(true)
    .visible(false);

    #[cfg(target_os = "windows")]
    {
        builder = builder.skip_taskbar(true);
    }
    #[cfg(target_os = "linux")]
    {
        builder = builder.skip_taskbar(true);
    }

    let window = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    {
        std::thread::sleep(Duration::from_millis(48));
    }

    let _ = window.hide();
    Ok(())
}

fn ensure_widget_window(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("widget").is_some() {
        return Ok(());
    }

    let lock = app.state::<WidgetCreationLock>();
    let _guard = lock.lock_guard();

    if app.get_webview_window("widget").is_some() {
        return Ok(());
    }

    let mut last_err: Option<String> = None;

    for attempt in 0..WIDGET_CREATE_ATTEMPTS {
        if attempt > 0 {
            let ms = 50u64 * (1u64 << attempt);
            std::thread::sleep(Duration::from_millis(ms.min(600)));
        }

        match try_build_widget_window(app) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
            }
        }

        if app.get_webview_window("widget").is_some() {
            return Ok(());
        }
    }

    Err(last_err.unwrap_or_else(|| "Widget window failed to create".to_string()))
}

fn show_widget(app: &tauri::AppHandle) -> Result<(), String> {
    ensure_widget_window(app)?;

    let Some(w) = app.get_webview_window("widget") else {
        return Err("Widget window missing after ensure".to_string());
    };

    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_always_on_top(true);
    let _ = w.set_focus();

    Ok(())
}

fn hide_widget(app: &tauri::AppHandle) -> Result<(), String> {
    match app.get_webview_window("widget") {
        Some(w) => {
            let _ = w.hide();
            Ok(())
        }
        None => Ok(()),
    }
}

#[tauri::command]
async fn show_widget_window(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || show_widget(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn hide_widget_window(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || hide_widget(&app))
        .await
        .map_err(|e| e.to_string())?
}
