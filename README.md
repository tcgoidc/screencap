# Screencap

## Introduction

Screencap is a lightweight desktop screen capture and annotation tool built for fast, repeatable screenshot workflows. Instead of opening a large editor after every capture, it stays in the system tray, waits for a global shortcut, and opens a focused overlay directly on the active monitor so you can capture, mark up, and export in a few steps.

The project is designed for developers, testers, document writers, and anyone who frequently needs to grab part of the screen, highlight key areas, add short text notes, and immediately copy or save the result. The current implementation combines a Rust native backend for tray, shortcut, capture, clipboard, and file operations with a TypeScript/Vite overlay for selection and annotation editing.

Screencap is a Tauri v2 desktop screenshot utility with a Rust backend and a TypeScript/Vite overlay editor. It runs as a tray application, listens for a global shortcut, captures the active monitor, and opens a full-screen overlay where you can select an area, annotate it, copy it to the clipboard, or save it as a PNG.

The project is currently tuned for Windows and has release packaging in place for MSI and NSIS installers.

## Features

- Global shortcut trigger for capture.
- Tray-based app lifecycle with Settings and Quit actions.
- Full-screen overlay aligned to the monitor containing the cursor.
- Selection workflow with drag, resize handles, clear, and confirm actions.
- Annotation tools for rectangle, arrow, text, and blur.
- Editable text annotations with configurable:
  - font family
  - text size
  - text color
  - background color
  - border size
  - border color
- Annotation actions for move, resize, duplicate, edit text, send backward, and bring to front.
- Clipboard export and PNG file export.
- Persistent settings for shortcut and default annotation styling.
- Browser-safe frontend runtime wrapper for limited preview outside Tauri.
- Windows packaging workflow that produces MSI and NSIS installers.

## Stack

- Rust
- Tauri v2
- TypeScript 4.9
- Vite 2.9
- PowerShell for Windows capture fallback and local build environment support

## Project Layout

- `src-tauri/src/main.rs`: native app entry point, tray, hotkey registration, settings persistence, screen capture, clipboard, file save, and backend tests.
- `src/overlay.ts`: capture overlay UI, selection logic, annotation state, export rendering, and keyboard shortcuts.
- `src/main.ts`: settings window UI.
- `src/settings-contract.ts`: shared settings defaults and validation.
- `src/overlay-contract.ts`: pure overlay-side helpers used by integration tests.
- `src/styles.css`: application and overlay styling.
- `tests/`: lightweight TypeScript integration smoke tests.
- `scripts/tauri-cli.cjs`: Node 13-compatible Tauri CLI shim.
- `scripts/tauri-build.cjs`: release build wrapper with artifact verification.
- `RELEASE-CHECKLIST.md`: manual release QA checklist.

## Requirements

## Runtime

- Windows is the primary supported environment for current packaging and validation.

## Development

- Node.js 13.11.0 or compatible with the current pinned toolchain in this repo.
- npm
- Rust toolchain with Cargo
- WebView2 runtime on Windows, as required by Tauri

## Important Environment Notes

This repository was adjusted to work in an environment where:

- Node is older than current Tauri frontend defaults.
- Cargo may not be available on `PATH`.

Because of that, the repo includes wrapper scripts and older-compatible frontend tooling.

## Getting Started

## 1. Install dependencies

```powershell
npm install
```

## 2. Ensure Rust is available

If `cargo` is not on `PATH`, either add Cargo to `PATH` or invoke it with the correct local installation path for your machine.

```powershell
cargo --version
```

## 3. Run the app in development

```powershell
npm run tauri:dev
```

This starts the Vite frontend and launches the Tauri desktop shell.

## Available Scripts

- `npm run dev`: start the Vite dev server only.
- `npm run build`: type-check and build the frontend into `dist/`.
- `npm run preview`: preview the built frontend through Vite.
- `npm run test:integration`: run the TypeScript integration smoke tests.
- `npm run tauri:dev`: run the desktop app in development mode.
- `npm run tauri:build`: build the frontend, compile the Rust app, and produce installer artifacts.

## How It Works

1. The app starts in the system tray.
2. A global shortcut emits a capture event.
3. The backend captures the display buffers for the available monitors.
4. The overlay opens on the monitor containing the cursor.
5. You drag to create a selection and optionally annotate it.
6. You can:
   - press `Enter` to copy the selection to the clipboard
   - press `Ctrl/Cmd+S` to save it as a PNG
   - click `Confirm` to copy and close the overlay
   - click `Save` to export to disk
   - click `Close` or press `Esc` to dismiss the overlay

## Overlay Controls

## Tool Switching

- `V`: Select
- `R`: Rectangle
- `A`: Arrow
- `T`: Text
- `B`: Blur

## Editing Shortcuts

- `Enter`: copy the current selection to the clipboard
- `Ctrl/Cmd+S`: save the selection to a PNG file
- `Delete` or `Backspace`: remove the selected annotation or clear the selection when appropriate
- `Ctrl/Cmd+D`: duplicate the selected annotation
- `Ctrl/Cmd+E`: edit the selected text annotation
- `Ctrl/Cmd+[` : send selected annotation backward
- `Ctrl/Cmd+]` : bring selected annotation to front
- `Esc`: close the overlay or cancel inline text editing depending on context

## Settings

The Settings window is opened from the tray menu and stores persistent defaults for:

- global shortcut
- default tool
- annotation color
- stroke width
- text size
- text font
- text background color
- text border color
- text border size

Settings are persisted through the Rust backend in the app configuration directory.

## Screen Capture Implementation

The native capture flow currently uses multiple layers for resilience:

- `xcap` monitor capture as the primary path
- monitor recovery logic when native enumeration is incomplete
- Windows PowerShell-based fallback capture for recovery scenarios

This design was added to handle real-world capture failures more gracefully on Windows.

## Browser Preview Behavior

The frontend can be previewed outside the Tauri shell, but desktop-only actions are intentionally degraded. The wrapper in `src/tauri-runtime.ts` prevents hard crashes when Tauri APIs are not available.

Use browser preview for layout and general UI checks, not for validating native capture, tray behavior, clipboard integration, or settings persistence.

## Testing

## Frontend integration tests

```powershell
npm run test:integration
```

These tests cover lightweight contract behavior such as:

- settings validation
- overlay selection and escape handling
- annotation stacking helpers
- capture payload validation

## Backend tests

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

The Rust tests cover settings validation, serialization, shortcut swapping helpers, PNG handling, and display-detection helper logic.

## Building Release Artifacts

```powershell
npm run tauri:build
```

This uses the local wrapper scripts to:

- build the frontend
- compile the Rust release binary
- generate MSI and NSIS installers
- verify that the expected artifacts were created

Expected output paths:

- `src-tauri/target/release/screencap.exe`
- `src-tauri/target/release/bundle/msi/Screencap_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Screencap_0.1.0_x64-setup.exe`

## Release Checklist

Before distributing a build, run through the manual checklist in `RELEASE-CHECKLIST.md`.

It covers:

- installer validation
- tray behavior
- capture flow
- annotation flow
- export flow
- multi-monitor and DPI behavior
- uninstall and reinstall checks

## Known Constraints

- The Tauri identifier is still set to `com.example.screencap` and should be changed before a production release.
- The app is currently validated primarily on Windows.
- Browser preview is not a substitute for native desktop validation.
- Older Node support is intentional in this repo; upgrading the frontend toolchain should be treated as a separate modernization task.

## Troubleshooting

## `No capture loaded`

- Trigger capture again with the configured hotkey or the `Capture now` button.
- Verify the app is running in the desktop shell rather than browser preview.
- On Windows, retry after closing overlays from other capture tools.

## Tray icon not visible or not updating

- Rebuild with `npm run tauri:build` and retest the latest executable.
- Confirm the packaged app includes the configured icon files from `src-tauri/icons/`.

## Settings fail to load or save

- Confirm the app is running in Tauri rather than plain browser preview.
- Reset settings from the UI and restart the app.

## Rust commands fail because Cargo is missing

- Add Cargo to `PATH`, or run Cargo using the correct installation path for your own environment.

## License

See `LICENSE`.