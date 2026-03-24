use tauri::Manager;
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            ensure_widget_window(app.handle())?;
            app.manage(WidgetToken(std::sync::Mutex::new(None)));

            let show_widget_item = tauri::menu::MenuItemBuilder::new("Show Widget")
                .id("show_widget")
                .build(app)?;
            let hide_widget_item = tauri::menu::MenuItemBuilder::new("Hide Widget")
                .id("hide_widget")
                .build(app)?;
            let open_app = tauri::menu::MenuItemBuilder::new("Open App")
                .id("open_app")
                .build(app)?;
            let quit = tauri::menu::MenuItemBuilder::new("Quit")
                .id("quit")
                .build(app)?;

            let menu = tauri::menu::MenuBuilder::new(app)
                .items(&[&show_widget_item, &hide_widget_item, &open_app, &quit])
                .build()?;

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
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Keep the tray icon alive for the app lifetime.
            // (Dropping it can remove it on some platforms.)
            app.manage(TrayState(tray));

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

fn ensure_widget_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    if app.get_webview_window("widget").is_some() {
        return Ok(());
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        "widget",
        tauri::WebviewUrl::App("index.html?widget=1".into()),
    )
    .title("Widget")
    .inner_size(380.0, 320.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .visible(false)
    .build()?;

    // If a platform ignores `visible(false)` at creation time,
    // hide it immediately after building.
    let _ = window.hide();

    Ok(())
}

fn show_widget<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    ensure_widget_window(app)?;
    if let Some(w) = app.get_webview_window("widget") {
        w.show()?;
        w.set_focus()?;
    }
    Ok(())
}

fn hide_widget<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("widget") {
        w.hide()?;
    }
    Ok(())
}

#[tauri::command]
fn show_widget_window(app: tauri::AppHandle) -> Result<(), String> {
    show_widget(&app).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn hide_widget_window(app: tauri::AppHandle) -> Result<(), String> {
    hide_widget(&app).map_err(|e| e.to_string())?;
    Ok(())
}
