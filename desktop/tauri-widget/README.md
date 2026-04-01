# Personal Analytics Desktop (Tauri)

Cross-platform desktop app with a lightweight **widget mode** (frameless + always-on-top) and a **system tray** toggle.

## Widget mode

- **Main window** label: `main`
- **Widget window** label: `widget` (created by Rust code, hidden by default)
- **Tray menu**: Show/Hide Widget, Open App, Quit

You can also open/close the widget from the main UI buttons (they call `show_widget_window` / `hide_widget_window`).

## Prerequisites

- **Node.js**: to build the React UI
- **Rust toolchain**: to build the Tauri backend
- **Linux only**: WebKitGTK (and friends). See Tauri prerequisites: `https://tauri.app/start/prerequisites/`

## Run (dev)

```bash
cd desktop/tauri-widget
npm install
npm run tauri dev
```

## Build

```bash
cd desktop/tauri-widget
npm run tauri build
```

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
