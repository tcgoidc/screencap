# Screencap Release Checklist

Use this checklist against the current Windows release artifacts before treating a build as ready.

## Build Artifacts

- [ ] `npm run tauri:build` completes successfully.
- [ ] MSI artifact exists at `src-tauri/target/release/bundle/msi/Screencap_0.1.0_x64_en-US.msi`.
- [ ] NSIS artifact exists at `src-tauri/target/release/bundle/nsis/Screencap_0.1.0_x64-setup.exe`.
- [ ] No unexpected build warnings or packaging errors remain in the release log.

## Install And Launch

- [ ] Install the MSI package on a clean machine or VM.
- [ ] Install the NSIS package on a clean machine or VM.
- [ ] Launch the app from the installer-created shortcut.
- [ ] Confirm the app starts without a visible crash dialog.
- [ ] Confirm a tray icon appears and remains responsive.
- [ ] Confirm reopening the app does not create broken duplicate background processes.

## Settings And Tray Flow

- [ ] Open Settings from the tray menu.
- [ ] Change the global shortcut and save it.
- [ ] Restart the app and confirm the saved shortcut persists.
- [ ] Reset settings to defaults and confirm the default shortcut, tool, color, stroke width, and font size are restored.
- [ ] Open Settings from a left-click on the tray icon.
- [ ] Quit from the tray menu and confirm the background process exits cleanly.

## Capture Flow

- [ ] Trigger capture with the configured global shortcut.
- [ ] Trigger capture with the `Capture now` button in the overlay.
- [ ] Confirm the overlay loads a real monitor image instead of showing `No capture loaded`.
- [ ] Confirm the overlay can be dismissed with `Esc` and the Close button.
- [ ] Confirm repeated capture attempts work without restarting the app.
- [ ] Confirm capture still works after opening and closing Settings.

## Selection And Annotation Flow

- [ ] Drag a new selection and confirm dimensions update as expected.
- [ ] Resize the selection using the selection handles.
- [ ] Draw a rectangle annotation inside the selection.
- [ ] Draw an arrow annotation inside the selection.
- [ ] Add a text annotation and edit it inline.
- [ ] Add a blur annotation.
- [ ] Select an existing annotation and move it.
- [ ] Resize a selected non-text annotation.
- [ ] Duplicate a selected annotation with `Ctrl` or `Cmd` + `D`.
- [ ] Change stacking order with `Send backward` and `Bring to front`.
- [ ] Undo and clear actions behave correctly.

## Export Flow

- [ ] Press `Enter` on a valid selection and confirm the image is copied to the clipboard.
- [ ] Save a valid selection to disk and confirm the PNG opens correctly.
- [ ] Confirm saving can be cancelled without leaving the overlay in a broken state.
- [ ] Confirm clipboard export still works after annotations are added.

## Multi-Monitor And DPI

- [ ] Test on a single-monitor setup.
- [ ] Test on a dual-monitor setup.
- [ ] Confirm the overlay appears on the monitor containing the cursor.
- [ ] Confirm capture works when monitors use different scale factors, such as 100% and 200%.
- [ ] Disconnect and reconnect a secondary monitor while the app is running and confirm the app recovers cleanly.

## Platform Edge Cases

- [ ] On macOS, deny screen recording permission and confirm the app reports the issue gracefully.
- [ ] On macOS, grant screen recording permission and confirm capture succeeds afterward.
- [ ] On Windows, confirm the app still captures after minimizing and restoring other top-level windows.

## Uninstall

- [ ] Uninstall the MSI package and confirm shortcuts and installed files are removed.
- [ ] Uninstall the NSIS package and confirm shortcuts and installed files are removed.
- [ ] Reinstall after uninstall and confirm the app launches cleanly again.

## Release Decision

- [ ] All applicable checklist items passed on the target release platform.
- [ ] Any skipped items are documented with rationale.
- [ ] Known issues are recorded before distribution.
