#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::collections::HashSet;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
use std::process::Command;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    image::Image,
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size,
    State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use xcap::Monitor;

const MAIN_WINDOW_LABEL: &str = "main";
const OVERLAY_WINDOW_LABEL: &str = "overlay";
const HOTKEY_EVENT: &str = "hotkey://capture";
const DEFAULT_SHORTCUT: &str = "CmdOrCtrl+Shift+A";
const SETTINGS_FILE_NAME: &str = "settings.json";
const DEFAULT_TEXT_FONT_FAMILY: &str = "Segoe UI";
const DEFAULT_TEXT_BACKGROUND_COLOR: &str = "#0f1726";
const DEFAULT_TEXT_BORDER_COLOR: &str = "#f8fafc";
const DEFAULT_TEXT_BORDER_SIZE: u8 = 0;
const SCREEN_CAPTURE_PERMISSION_MESSAGE: &str =
    "screen capture permission is not granted. Open System Settings > Privacy & Security > Screen Recording and allow Screencap.";
const PNG_METADATA_APP_NAME: &str = "TCGO Screen Capture";
const PNG_METADATA_CREDITS: &str = "Powered by TCGOIDC, LTD";
const PNG_METADATA_RELEASE_DATE: &str = "2026-05-28";
const PNG_METADATA_REPOSITORY_URL: &str = "https://github.com/tcgoidc/screencap";
const PNG_EXIF_DATE_TIME: &str = "2026:05:28 00:00:00";
const EXIF_TAG_IMAGE_DESCRIPTION: u16 = 0x010E;
const EXIF_TAG_SOFTWARE: u16 = 0x0131;
const EXIF_TAG_DATE_TIME: u16 = 0x0132;
const EXIF_TAG_ARTIST: u16 = 0x013B;
const EXIF_TAG_COPYRIGHT: u16 = 0x8298;
const TIFF_TYPE_ASCII: u16 = 2;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

struct AppState {
    active_shortcut: Mutex<Shortcut>,
    settings: Mutex<AppSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    shortcut: String,
    default_tool: String,
    annotation_color: String,
    stroke_width: u8,
    font_size: u8,
    #[serde(default = "default_text_font_family")]
    text_font_family: String,
    #[serde(default = "default_text_background_color")]
    text_background_color: String,
    #[serde(default = "default_text_border_color")]
    text_border_color: String,
    #[serde(default = "default_text_border_size")]
    text_border_size: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureFrame {
    display_id: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
    data_url: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsFallbackFrame {
    display_id: i32,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    data_url: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            shortcut: DEFAULT_SHORTCUT.to_string(),
            default_tool: "select".to_string(),
            annotation_color: "#5ce1a6".to_string(),
            stroke_width: 4,
            font_size: 24,
            text_font_family: default_text_font_family(),
            text_background_color: default_text_background_color(),
            text_border_color: default_text_border_color(),
            text_border_size: default_text_border_size(),
        }
    }
}

fn default_text_font_family() -> String {
    DEFAULT_TEXT_FONT_FAMILY.to_string()
}

fn default_text_background_color() -> String {
    DEFAULT_TEXT_BACKGROUND_COLOR.to_string()
}

fn default_text_border_color() -> String {
    DEFAULT_TEXT_BORDER_COLOR.to_string()
}

fn default_text_border_size() -> u8 {
    DEFAULT_TEXT_BORDER_SIZE
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let settings_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config directory: {error}"))?;

    fs::create_dir_all(&settings_dir)
        .map_err(|error| format!("failed to create app config directory: {error}"))?;

    Ok(settings_dir.join(SETTINGS_FILE_NAME))
}

fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;

    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read settings file: {error}"))?;

    parse_settings(&contents)
}

fn persist_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let serialized = serialize_settings(settings)?;

    fs::write(path, serialized).map_err(|error| format!("failed to persist settings file: {error}"))
}

fn swap_active_shortcut(
    current_shortcut: &Shortcut,
    next_shortcut: &Shortcut,
    register_shortcut: &mut impl FnMut(Shortcut) -> Result<(), String>,
    unregister_shortcut: &mut impl FnMut(Shortcut) -> Result<(), String>,
) -> Result<bool, String> {
    if current_shortcut == next_shortcut {
        return Ok(false);
    }

    register_shortcut(next_shortcut.clone())?;

    if let Err(error) = unregister_shortcut(current_shortcut.clone()) {
        return match unregister_shortcut(next_shortcut.clone()) {
            Ok(()) => Err(format!("failed to unregister previous shortcut: {error}")),
            Err(rollback_error) => Err(format!(
                "failed to unregister previous shortcut: {error}; rollback failed for new shortcut: {rollback_error}"
            )),
        };
    }

    Ok(true)
}

fn reset_settings_payload() -> AppSettings {
    AppSettings::default()
}

fn settings_with_updated_shortcut(settings: &AppSettings, accelerator: String) -> AppSettings {
    AppSettings {
        shortcut: accelerator,
        ..settings.clone()
    }
}

fn resolve_startup_settings(load_result: Result<AppSettings, String>) -> (AppSettings, Shortcut, bool) {
    match load_result {
        Ok(settings) => match validate_settings(&settings) {
            Ok(shortcut) => (settings, shortcut, false),
            Err(_) => (AppSettings::default(), default_shortcut(), true),
        },
        Err(_) => (AppSettings::default(), default_shortcut(), true),
    }
}

fn parse_settings(contents: &str) -> Result<AppSettings, String> {
    let settings = serde_json::from_str::<AppSettings>(contents)
        .map_err(|error| format!("failed to parse settings file: {error}"))?;

    validate_settings(&settings)
        .map_err(|error| format!("invalid settings file: {error}"))?;

    Ok(settings)
}

fn serialize_settings(settings: &AppSettings) -> Result<String, String> {
    validate_settings(settings)
        .map_err(|error| format!("refusing to persist invalid settings: {error}"))?;

    serde_json::to_string_pretty(settings)
        .map_err(|error| format!("failed to serialize settings: {error}"))
}

fn validate_settings(settings: &AppSettings) -> Result<Shortcut, String> {
    if !matches!(settings.default_tool.as_str(), "select" | "rectangle" | "arrow" | "text" | "blur") {
        return Err(format!("invalid default tool '{}': expected select, rectangle, arrow, text, or blur", settings.default_tool));
    }

    if !(2..=10).contains(&settings.stroke_width) {
        return Err(format!("invalid stroke width {}: expected 2-10", settings.stroke_width));
    }

    if !(16..=48).contains(&settings.font_size) {
        return Err(format!("invalid font size {}: expected 16-48", settings.font_size));
    }

    if !is_hex_color(&settings.annotation_color) {
        return Err(format!("invalid annotation color '{}': expected a hex RGB value like #5ce1a6", settings.annotation_color));
    }

    if !is_supported_text_font(&settings.text_font_family) {
        return Err(format!("invalid text font family '{}': expected one of Segoe UI, Georgia, Consolas, or Trebuchet MS", settings.text_font_family));
    }

    if !is_hex_color(&settings.text_background_color) {
        return Err(format!("invalid text background color '{}': expected a hex RGB value like #0f1726", settings.text_background_color));
    }

    if !is_hex_color(&settings.text_border_color) {
        return Err(format!("invalid text border color '{}': expected a hex RGB value like #f8fafc", settings.text_border_color));
    }

    if settings.text_border_size > 8 {
        return Err(format!("invalid text border size {}: expected 0-8", settings.text_border_size));
    }

    settings
        .shortcut
        .parse::<Shortcut>()
        .map_err(|error| format!("invalid shortcut '{}': {error}", settings.shortcut))
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.chars().skip(1).all(|character| character.is_ascii_hexdigit())
}

fn is_supported_text_font(value: &str) -> bool {
    matches!(value, "Segoe UI" | "Georgia" | "Consolas" | "Trebuchet MS")
}

fn decode_png_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded_payload = data_url
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "invalid PNG data URL payload".to_string())?;

    BASE64
        .decode(encoded_payload)
        .map_err(|error| format!("failed to decode image payload: {error}"))
}

fn decode_exported_png(data_url: &str) -> Result<Vec<u8>, String> {
    let png_bytes = decode_png_data_url(data_url)?;

    image::load_from_memory(&png_bytes)
        .map_err(|error| format!("failed to decode exported image: {error}"))?;

    Ok(png_bytes)
}

fn encode_png_with_app_metadata(data_url: &str) -> Result<Vec<u8>, String> {
    let png_bytes = decode_exported_png(data_url)?;
    let rgba_image = image::load_from_memory(&png_bytes)
        .map_err(|error| format!("failed to decode exported image: {error}"))?
        .to_rgba8();
    let (width, height) = rgba_image.dimensions();
    let mut encoded_png = Vec::new();

    let mut encoder = png::Encoder::new(&mut encoded_png, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .add_text_chunk("Software".to_string(), PNG_METADATA_APP_NAME.to_string())
        .map_err(|error| format!("failed to add PNG metadata: {error}"))?;
    encoder
        .add_text_chunk("Version".to_string(), env!("CARGO_PKG_VERSION").to_string())
        .map_err(|error| format!("failed to add PNG metadata: {error}"))?;
    encoder
        .add_text_chunk("Comment".to_string(), PNG_METADATA_CREDITS.to_string())
        .map_err(|error| format!("failed to add PNG metadata: {error}"))?;
    encoder
        .add_text_chunk("Creation Time".to_string(), PNG_METADATA_RELEASE_DATE.to_string())
        .map_err(|error| format!("failed to add PNG metadata: {error}"))?;
    encoder
        .add_text_chunk("Source".to_string(), PNG_METADATA_REPOSITORY_URL.to_string())
        .map_err(|error| format!("failed to add PNG metadata: {error}"))?;

    {
        let mut writer = encoder
            .write_header()
            .map_err(|error| format!("failed to initialize PNG writer: {error}"))?;
        writer
            .write_chunk(png::chunk::eXIf, &build_png_exif_metadata())
            .map_err(|error| format!("failed to write PNG EXIF metadata: {error}"))?;
        writer
            .write_image_data(rgba_image.as_raw())
            .map_err(|error| format!("failed to encode PNG image: {error}"))?;
    }

    Ok(encoded_png)
}

fn build_png_exif_metadata() -> Vec<u8> {
    let entries = [
        (
            EXIF_TAG_IMAGE_DESCRIPTION,
            format!(
                "{PNG_METADATA_APP_NAME} | {PNG_METADATA_CREDITS} | {PNG_METADATA_REPOSITORY_URL}"
            ),
        ),
        (
            EXIF_TAG_SOFTWARE,
            format!("{PNG_METADATA_APP_NAME} {}", env!("CARGO_PKG_VERSION")),
        ),
        (EXIF_TAG_DATE_TIME, PNG_EXIF_DATE_TIME.to_string()),
        (EXIF_TAG_ARTIST, "TCGOIDC, LTD".to_string()),
        (EXIF_TAG_COPYRIGHT, PNG_METADATA_CREDITS.to_string()),
    ];
    let entry_count = u16::try_from(entries.len()).expect("expected EXIF entry count to fit in u16");
    let ifd_offset = 8u32;
    let ifd_data_offset = ifd_offset + 2 + u32::from(entry_count) * 12 + 4;
    let mut exif = Vec::new();
    let mut string_data = Vec::new();
    let mut next_value_offset = ifd_data_offset;

    exif.extend_from_slice(b"II");
    exif.extend_from_slice(&42u16.to_le_bytes());
    exif.extend_from_slice(&ifd_offset.to_le_bytes());
    exif.extend_from_slice(&entry_count.to_le_bytes());

    for (tag, value) in entries {
        let mut bytes = value.into_bytes();
        bytes.push(0);

        exif.extend_from_slice(&tag.to_le_bytes());
        exif.extend_from_slice(&TIFF_TYPE_ASCII.to_le_bytes());
        exif.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        exif.extend_from_slice(&next_value_offset.to_le_bytes());

        string_data.extend_from_slice(&bytes);
        next_value_offset += bytes.len() as u32;
    }

    exif.extend_from_slice(&0u32.to_le_bytes());
    exif.extend_from_slice(&string_data);
    exif
}

#[cfg(target_os = "macos")]
fn screen_capture_access_granted() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
fn screen_capture_access_granted() -> bool {
    true
}

#[cfg(target_os = "macos")]
fn open_screen_capture_preferences() -> Result<(), String> {
    let status = Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .status()
        .map_err(|error| format!("failed to open macOS screen recording preferences: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "failed to open macOS screen recording preferences: exit status {status}"
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn open_screen_capture_preferences() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn ensure_screen_capture_access(prompt: bool) -> Result<bool, String> {
    if screen_capture_access_granted() {
        return Ok(true);
    }

    if prompt {
        open_screen_capture_preferences()?;
    }

    Ok(false)
}

fn ensure_detected_displays(monitors_count: usize, displays_count: usize) -> Result<(), String> {
    if displays_count > 0 {
        return Ok(());
    }

    Err(format!(
        "native screen capture returned no displays (tauri monitors: {monitors_count}, screenshot displays: {displays_count})"
    ))
}

fn midpoint_for_monitor_geometry(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> Result<(i32, i32), String> {
    let half_width = i32::try_from(size.width / 2)
        .map_err(|_| format!("monitor width {} exceeded i32 midpoint range", size.width))?;
    let half_height = i32::try_from(size.height / 2)
        .map_err(|_| format!("monitor height {} exceeded i32 midpoint range", size.height))?;

    Ok((position.x.saturating_add(half_width), position.y.saturating_add(half_height)))
}

fn resolve_xcap_monitors(monitors: &[tauri::Monitor]) -> Result<Vec<Monitor>, String> {
    let screens = Monitor::all().map_err(|error| format!("failed to enumerate displays: {error}"))?;

    if !screens.is_empty() {
        return Ok(screens);
    }

    let mut discovered_ids = HashSet::new();
    let mut fallback_screens = Vec::new();

    for monitor in monitors {
        let (mid_x, mid_y) = midpoint_for_monitor_geometry(*monitor.position(), *monitor.size())?;
        let screen = Monitor::from_point(mid_x, mid_y)
            .map_err(|error| format!("failed to resolve display from point ({mid_x}, {mid_y}): {error}"))?;
        let display_id = screen
            .id()
            .map_err(|error| format!("failed to resolve fallback display id: {error}"))?;

        if discovered_ids.insert(display_id) {
            fallback_screens.push(screen);
        }
    }

    Ok(fallback_screens)
}

fn resolve_monitor_scale_factor(
    monitors: &[tauri::Monitor],
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> f64 {
    monitors
        .iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();

            position.x == x && position.y == y && size.width == width && size.height == height
        })
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0)
}

fn capture_with_xcap(monitors: &[tauri::Monitor]) -> Result<Vec<CaptureFrame>, String> {
    let screens = resolve_xcap_monitors(monitors)?;

    ensure_detected_displays(monitors.len(), screens.len())?;

    screens
        .into_iter()
        .map(|screen| {
            let display_id = screen
                .id()
                .map_err(|error| format!("failed to resolve display id: {error}"))?;
            let x = screen
                .x()
                .map_err(|error| format!("failed to resolve display x for {display_id}: {error}"))?;
            let y = screen
                .y()
                .map_err(|error| format!("failed to resolve display y for {display_id}: {error}"))?;
            let width = screen
                .width()
                .map_err(|error| format!("failed to resolve display width for {display_id}: {error}"))?;
            let height = screen
                .height()
                .map_err(|error| format!("failed to resolve display height for {display_id}: {error}"))?;
            let image = screen
                .capture_image()
                .map_err(|error| format!("failed to capture display {display_id}: {error}"))?;

            let mut png_bytes = Vec::new();
            DynamicImage::ImageRgba8(image)
                .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
                .map_err(|error| format!("failed to encode display {display_id}: {error}"))?;

            Ok(CaptureFrame {
                display_id: i32::try_from(display_id)
                    .map_err(|_| format!("display id {display_id} exceeded i32 range"))?,
                width,
                height,
                scale_factor: resolve_monitor_scale_factor(monitors, x, y, width, height),
                data_url: format!("data:image/png;base64,{}", BASE64.encode(png_bytes)),
            })
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn capture_with_windows_powershell(monitors: &[tauri::Monitor]) -> Result<Vec<CaptureFrame>, String> {
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$frames = @()
$displayId = 1
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  $screen = $_
  $bounds = $screen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
  $frames += [PSCustomObject]@{
    displayId = $displayId
    x = $bounds.X
    y = $bounds.Y
    width = $bounds.Width
    height = $bounds.Height
    dataUrl = 'data:image/png;base64,' + [Convert]::ToBase64String($stream.ToArray())
  }
  $stream.Dispose()
  $displayId += 1
}
$frames | ConvertTo-Json -Compress
"#;

    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
        .output()
        .map_err(|error| format!("failed to launch Windows fallback capture: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Windows fallback capture exited with status {}", output.status)
        } else {
            format!("Windows fallback capture failed: {stderr}")
        });
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("Windows fallback capture produced invalid UTF-8: {error}"))?;
    let frames: Vec<WindowsFallbackFrame> = serde_json::from_str(stdout.trim())
        .map_err(|error| format!("failed to parse Windows fallback capture payload: {error}"))?;

    ensure_detected_displays(monitors.len(), frames.len())?;

    Ok(frames
        .into_iter()
        .map(|frame| CaptureFrame {
            display_id: frame.display_id,
            width: frame.width,
            height: frame.height,
            scale_factor: resolve_monitor_scale_factor(
                monitors,
                frame.x,
                frame.y,
                frame.width,
                frame.height,
            ),
            data_url: frame.data_url,
        })
        .collect())
}

#[cfg(not(target_os = "windows"))]
fn capture_with_windows_powershell(_monitors: &[tauri::Monitor]) -> Result<Vec<CaptureFrame>, String> {
    Err("Windows fallback capture is unavailable on this platform".to_string())
}

#[tauri::command]
fn copy_image_to_clipboard(app: AppHandle, data_url: String) -> Result<(), String> {
    let png_bytes = decode_exported_png(&data_url)?;
    let rgba_image = image::load_from_memory(&png_bytes)
        .map_err(|error| format!("failed to decode exported image: {error}"))?
        .to_rgba8();
    let width = rgba_image.width();
    let height = rgba_image.height();
    let clipboard_image = Image::new_owned(rgba_image.into_raw(), width, height);

    app.clipboard()
        .write_image(&clipboard_image)
        .map_err(|error| format!("failed to write image to clipboard: {error}"))
}

#[tauri::command]
fn save_image_file(data_url: String, path: String) -> Result<(), String> {
    let png_bytes = encode_png_with_app_metadata(&data_url)?;

    fs::write(&path, png_bytes).map_err(|error| format!("failed to save image to '{path}': {error}"))
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http and https URLs are supported".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|error| format!("failed to open url '{url}': {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|error| format!("failed to open url '{url}': {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|error| format!("failed to open url '{url}': {error}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("opening urls is not supported on this platform".to_string())
}

#[tauri::command]
fn capture_screen(app: AppHandle) -> Result<Vec<CaptureFrame>, String> {
    if !screen_capture_access_granted() {
        return Err(SCREEN_CAPTURE_PERMISSION_MESSAGE.to_string());
    }

    let overlay = app.get_webview_window(OVERLAY_WINDOW_LABEL);
    let overlay_was_visible = overlay
        .as_ref()
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if overlay_was_visible {
        if let Some(window) = overlay.as_ref() {
            window
                .hide()
                .map_err(|error| format!("failed to hide overlay before capture: {error}"))?;
        }

        // Give the compositor a moment to remove the always-on-top overlay before capturing.
        thread::sleep(Duration::from_millis(75));
    }

    let capture_result = (|| {
        let monitors = app
            .available_monitors()
            .map_err(|error| format!("failed to enumerate monitors: {error}"))?;
        capture_with_xcap(&monitors).or_else(|xcap_error| {
            capture_with_windows_powershell(&monitors).map_err(|fallback_error| {
                format!(
                    "xcap capture failed: {xcap_error}; Windows fallback capture failed: {fallback_error}"
                )
            })
        })
    })();

    if overlay_was_visible {
        if let Some(window) = overlay.as_ref() {
            let _ = sync_overlay_to_cursor_monitor(&app);
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    capture_result
}

#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window(OVERLAY_WINDOW_LABEL)
        .ok_or_else(|| "overlay window is not available".to_string())?;

    overlay.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state
        .settings
        .lock()
        .map_err(|_| "failed to lock settings state".to_string())
        .map(|settings| settings.clone())
}

fn apply_settings(app: &AppHandle, state: &State<'_, AppState>, settings: AppSettings) -> Result<AppSettings, String> {
    let new_shortcut = validate_settings(&settings)?;
    let shortcut_manager = app.global_shortcut();
    let previous_shortcut = state
        .active_shortcut
        .lock()
        .map_err(|_| "failed to lock shortcut state".to_string())?
        .clone();
    let mut register_shortcut = |shortcut| register_capture_shortcut(app, shortcut);
    let mut unregister_shortcut = |shortcut| {
        shortcut_manager
            .unregister(shortcut)
            .map_err(|error| format!("failed to unregister shortcut: {error}"))
    };

    let shortcut_changed = swap_active_shortcut(
        &previous_shortcut,
        &new_shortcut,
        &mut register_shortcut,
        &mut unregister_shortcut,
    )?;

    if let Err(error) = persist_settings(app, &settings) {
        if shortcut_changed {
            return match swap_active_shortcut(
                &new_shortcut,
                &previous_shortcut,
                &mut register_shortcut,
                &mut unregister_shortcut,
            ) {
                Ok(_) => Err(format!("{error}; reverted shortcut update")),
                Err(rollback_error) => Err(format!(
                    "{error}; failed to revert shortcut update: {rollback_error}"
                )),
            };
        }

        return Err(error);
    }

    if let Ok(mut active_shortcut) = state.active_shortcut.lock() {
        *active_shortcut = new_shortcut;
    }

    if let Ok(mut stored_settings) = state.settings.lock() {
        *stored_settings = settings.clone();
    }

    Ok(settings)
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: AppSettings) -> Result<AppSettings, String> {
    apply_settings(&app, &state, settings)
}

#[tauri::command]
fn reset_settings(app: AppHandle, state: State<'_, AppState>) -> Result<AppSettings, String> {
    apply_settings(&app, &state, reset_settings_payload())
}

#[tauri::command]
fn update_hotkey(app: AppHandle, state: State<'_, AppState>, accelerator: String) -> Result<(), String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "failed to lock settings state".to_string())?
        .clone();

    apply_settings(&app, &state, settings_with_updated_shortcut(&settings, accelerator))?;

    Ok(())
}

fn register_capture_shortcut(app: &AppHandle, shortcut: Shortcut) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, {
            let app = app.clone();
            move |_app, pressed_shortcut, event| {
                if pressed_shortcut == &shortcut && event.state() == ShortcutState::Pressed {
                    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                        let _ = main_window.hide();
                    }

                    if let Some(overlay) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
                        let _ = sync_overlay_to_cursor_monitor(&app);
                        let _ = overlay.show();
                        let _ = overlay.set_focus();
                    }

                    let _ = app.emit(HOTKEY_EVENT, ());
                }
            }
        })
        .map_err(|error| format!("failed to register shortcut: {error}"))
}

fn cursor_monitor_geometry(app: &AppHandle) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>, f64), String> {
    let cursor_position = app.cursor_position().ok();
    let primary_monitor = app
        .primary_monitor()
        .map_err(|error| format!("failed to determine primary monitor: {error}"))?;

    let monitor = app
        .available_monitors()
        .map_err(|error| format!("failed to enumerate monitors: {error}"))?
        .into_iter()
        .find(|monitor| {
            let Some(cursor) = cursor_position else {
                return false;
            };

            let position = monitor.position();
            let size = monitor.size();
            let min_x = f64::from(position.x);
            let min_y = f64::from(position.y);
            let max_x = min_x + f64::from(size.width);
            let max_y = min_y + f64::from(size.height);

            cursor.x >= min_x && cursor.x < max_x && cursor.y >= min_y && cursor.y < max_y
        })
        .or(primary_monitor)
        .ok_or_else(|| "no monitor is available for overlay placement".to_string())?;

    Ok((*monitor.position(), *monitor.size(), monitor.scale_factor()))
}

fn sync_overlay_to_cursor_monitor(app: &AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window(OVERLAY_WINDOW_LABEL)
        .ok_or_else(|| "overlay window is not available".to_string())?;
    let (position, size, scale_factor) = cursor_monitor_geometry(app)?;

    overlay
        .set_position(Position::Physical(position))
        .map_err(|error| format!("failed to move overlay window: {error}"))?;
    overlay
        .set_size(Size::Logical(LogicalSize::new(
            f64::from(size.width) / scale_factor,
            f64::from(size.height) / scale_factor,
        )))
        .map_err(|error| format!("failed to resize overlay window: {error}"))?;

    Ok(())
}

fn ensure_overlay_window(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window(OVERLAY_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let (position, size, scale_factor) = cursor_monitor_geometry(app.handle())
        .unwrap_or((PhysicalPosition::new(0, 0), PhysicalSize::new(1920, 1080), 1.0));

    WebviewWindowBuilder::new(app, OVERLAY_WINDOW_LABEL, WebviewUrl::App("overlay.html".into()))
        .visible(false)
        .focused(false)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .position(f64::from(position.x), f64::from(position.y))
        .inner_size(size.width as f64 / scale_factor, size.height as f64 / scale_factor)
        .build()?;

    Ok(())
}

fn build_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let settings = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&settings, &quit]).build()?;

    let mut tray_builder = TrayIconBuilder::new().menu(&menu);

    if let Some(default_icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(default_icon);
    }

    tray_builder
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn default_shortcut() -> Shortcut {
    DEFAULT_SHORTCUT
        .parse::<Shortcut>()
        .expect("default shortcut should be valid")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .manage(AppState {
            active_shortcut: Mutex::new(default_shortcut()),
            settings: Mutex::new(AppSettings::default()),
        })
        .invoke_handler(tauri::generate_handler![
            ensure_screen_capture_access,
            capture_screen,
            hide_overlay,
            update_hotkey,
            get_settings,
            save_settings,
            reset_settings,
            copy_image_to_clipboard,
            save_image_file,
            open_url
        ])
        .setup(|app| {
            let (loaded_settings, loaded_shortcut, repaired_settings) =
                resolve_startup_settings(load_settings(app.handle()));

            if repaired_settings {
                let _ = persist_settings(app.handle(), &loaded_settings);
            }

            if let Ok(mut settings) = app.state::<AppState>().settings.lock() {
                *settings = loaded_settings.clone();
            }
            if let Ok(mut active_shortcut) = app.state::<AppState>().active_shortcut.lock() {
                *active_shortcut = loaded_shortcut;
            }
            ensure_overlay_window(app)?;
            build_tray(app)?;
            register_capture_shortcut(app.handle(), loaded_shortcut)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running screencap application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use std::cell::RefCell;
    use std::convert::TryInto;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn find_png_chunk<'a>(bytes: &'a [u8], chunk_type: &[u8; 4]) -> Option<&'a [u8]> {
        let mut offset = 8usize;

        while offset + 12 <= bytes.len() {
            let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().ok()?) as usize;
            let chunk_name = &bytes[offset + 4..offset + 8];
            let data_start = offset + 8;
            let data_end = data_start + length;

            if data_end + 4 > bytes.len() {
                return None;
            }

            if chunk_name == chunk_type {
                return Some(&bytes[data_start..data_end]);
            }

            offset = data_end + 4;
        }

        None
    }

    fn sample_png_data_url() -> String {
        let image = RgbaImage::from_pixel(2, 2, Rgba([0x12, 0x34, 0x56, 0xff]));
        let mut png_bytes = Vec::new();

        DynamicImage::ImageRgba8(image)
            .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
            .expect("expected sample PNG to encode");

        format!("data:image/png;base64,{}", BASE64.encode(png_bytes))
    }

    #[test]
    fn default_settings_are_valid() {
        let settings = AppSettings::default();

        assert!(validate_settings(&settings).is_ok());
    }

    #[test]
    fn invalid_default_tool_is_rejected() {
        let settings = AppSettings {
            default_tool: "polygon".to_string(),
            ..AppSettings::default()
        };

        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn invalid_hex_color_is_rejected() {
        let settings = AppSettings {
            annotation_color: "green".to_string(),
            ..AppSettings::default()
        };

        assert!(validate_settings(&settings).is_err());
        assert!(!is_hex_color("#12xz90"));
    }

    #[test]
    fn invalid_stroke_width_is_rejected() {
        let settings = AppSettings {
            stroke_width: 1,
            ..AppSettings::default()
        };

        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn invalid_font_size_is_rejected() {
        let settings = AppSettings {
            font_size: 12,
            ..AppSettings::default()
        };

        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn invalid_shortcut_is_rejected() {
        let settings = AppSettings {
            shortcut: "DefinitelyNotAShortcut".to_string(),
            ..AppSettings::default()
        };

        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn decode_png_data_url_accepts_valid_payload() {
        let payload = sample_png_data_url();
        let decoded = decode_png_data_url(&payload).expect("expected payload to decode");

        assert!(image::load_from_memory(&decoded).is_ok());
    }

    #[test]
    fn decode_png_data_url_rejects_invalid_payload() {
        assert!(decode_png_data_url("not-a-data-url").is_err());
        assert!(decode_png_data_url("data:text/plain;base64,aGVsbG8=").is_err());
        assert!(decode_png_data_url("data:image/png;base64,%%%invalid%%%" ).is_err());
    }

    #[test]
    fn decode_exported_png_rejects_non_image_bytes() {
        let payload = "data:image/png;base64,aGVsbG8=";

        let error = decode_exported_png(payload).expect_err("expected fake PNG payload to be rejected");

        assert!(error.contains("failed to decode exported image"));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn screen_capture_access_is_available_on_non_macos() {
        assert!(screen_capture_access_granted());
        assert!(ensure_screen_capture_access(false).expect("expected non-macOS permission check to succeed"));
    }

    #[test]
    fn empty_native_display_list_is_rejected() {
        let error = ensure_detected_displays(1, 0).expect_err("expected empty native displays to be rejected");

        assert!(error.contains("no displays"));
        assert!(error.contains("tauri monitors: 1"));
    }

    #[test]
    fn detected_native_display_list_is_accepted() {
        assert!(ensure_detected_displays(1, 1).is_ok());
    }

    #[test]
    fn midpoint_for_monitor_geometry_produces_monitor_center() {
        let midpoint = midpoint_for_monitor_geometry(
            PhysicalPosition::new(-1920, 0),
            PhysicalSize::new(1920, 1080),
        )
        .expect("expected midpoint to be computed");

        assert_eq!(midpoint, (-960, 540));
    }

    #[test]
    fn parse_settings_rejects_semantically_invalid_json() {
        let invalid = r##"{
  "shortcut": "CmdOrCtrl+Shift+A",
  "defaultTool": "polygon",
  "annotationColor": "#5ce1a6",
  "strokeWidth": 4,
    "fontSize": 24,
    "textFontFamily": "Segoe UI",
    "textBackgroundColor": "#0f1726",
    "textBorderColor": "#f8fafc",
    "textBorderSize": 0
}"##;

        let error = parse_settings(invalid).expect_err("expected invalid settings file to be rejected");

        assert!(error.contains("invalid settings file"));
        assert!(error.contains("invalid default tool"));
    }

    #[test]
    fn settings_round_trip_through_serialization() {
        let settings = AppSettings {
            shortcut: "CmdOrCtrl+Shift+S".to_string(),
            default_tool: "rectangle".to_string(),
            annotation_color: "#ff6600".to_string(),
            stroke_width: 6,
            font_size: 28,
            text_font_family: "Georgia".to_string(),
            text_background_color: "#102030".to_string(),
            text_border_color: "#f4f4f4".to_string(),
            text_border_size: 2,
        };

        let serialized = serialize_settings(&settings).expect("expected settings to serialize");
        let parsed = parse_settings(&serialized).expect("expected settings to round-trip");

        assert_eq!(parsed, settings);
    }

    #[test]
    fn save_image_file_writes_png_bytes_to_disk() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("expected system time after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "screencap-export-{}-{}.png",
            std::process::id(),
            timestamp
        ));
        let path_string = path.to_string_lossy().to_string();
        let payload = sample_png_data_url();

        save_image_file(payload, path_string.clone()).expect("expected PNG export to succeed");

        let saved = fs::read(&path).expect("expected saved image to exist");
        let decoded = image::load_from_memory(&saved).expect("expected saved bytes to be a valid PNG");
        let decoder = png::Decoder::new(Cursor::new(&saved));
        let reader = decoder
            .read_info()
            .expect("expected saved PNG metadata to be readable");
        let metadata = &reader.info().uncompressed_latin1_text;
        let exif_metadata = find_png_chunk(&saved, b"eXIf").expect("expected saved PNG to include eXIf metadata");

        assert_eq!(decoded.width(), 2);
        assert_eq!(decoded.height(), 2);
        assert!(metadata.iter().any(|chunk| chunk.keyword == "Software" && chunk.text == PNG_METADATA_APP_NAME));
        assert!(metadata.iter().any(|chunk| chunk.keyword == "Version" && chunk.text == env!("CARGO_PKG_VERSION")));
        assert!(metadata.iter().any(|chunk| chunk.keyword == "Comment" && chunk.text == PNG_METADATA_CREDITS));
        assert!(metadata.iter().any(|chunk| chunk.keyword == "Creation Time" && chunk.text == PNG_METADATA_RELEASE_DATE));
        assert!(metadata.iter().any(|chunk| chunk.keyword == "Source" && chunk.text == PNG_METADATA_REPOSITORY_URL));
        assert!(exif_metadata.windows(PNG_METADATA_APP_NAME.len()).any(|window| window == PNG_METADATA_APP_NAME.as_bytes()));
        assert!(exif_metadata.windows(PNG_EXIF_DATE_TIME.len()).any(|window| window == PNG_EXIF_DATE_TIME.as_bytes()));
        assert!(exif_metadata.windows(PNG_METADATA_REPOSITORY_URL.len()).any(|window| window == PNG_METADATA_REPOSITORY_URL.as_bytes()));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn save_image_file_rejects_non_png_payload() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("expected system time after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "screencap-invalid-export-{}-{}.png",
            std::process::id(),
            timestamp
        ));
        let path_string = path.to_string_lossy().to_string();

        let error = save_image_file("data:image/png;base64,aGVsbG8=".to_string(), path_string)
            .expect_err("expected invalid PNG payload to be rejected");

        assert!(error.contains("failed to decode exported image"));
        assert!(!path.exists());
    }

    #[test]
    fn reset_settings_payload_returns_defaults() {
        let settings = reset_settings_payload();

        assert_eq!(settings, AppSettings::default());
    }

    #[test]
    fn settings_with_updated_shortcut_only_changes_shortcut() {
        let original = AppSettings {
            shortcut: "CmdOrCtrl+Shift+A".to_string(),
            default_tool: "blur".to_string(),
            annotation_color: "#ff6600".to_string(),
            stroke_width: 8,
            font_size: 32,
            text_font_family: "Consolas".to_string(),
            text_background_color: "#111827".to_string(),
            text_border_color: "#ffffff".to_string(),
            text_border_size: 1,
        };

        let updated = settings_with_updated_shortcut(&original, "CmdOrCtrl+Shift+S".to_string());

        assert_eq!(updated.shortcut, "CmdOrCtrl+Shift+S");
        assert_eq!(updated.default_tool, original.default_tool);
        assert_eq!(updated.annotation_color, original.annotation_color);
        assert_eq!(updated.stroke_width, original.stroke_width);
        assert_eq!(updated.font_size, original.font_size);
        assert_eq!(updated.text_font_family, original.text_font_family);
        assert_eq!(updated.text_background_color, original.text_background_color);
        assert_eq!(updated.text_border_color, original.text_border_color);
        assert_eq!(updated.text_border_size, original.text_border_size);
    }

    #[test]
    fn settings_with_updated_shortcut_still_flows_through_validation() {
        let updated = settings_with_updated_shortcut(
            &AppSettings::default(),
            "DefinitelyNotAShortcut".to_string(),
        );

        assert!(validate_settings(&updated).is_err());
    }

    #[test]
    fn resolve_startup_settings_keeps_valid_loaded_settings() {
        let settings = AppSettings {
            shortcut: "CmdOrCtrl+Shift+S".to_string(),
            default_tool: "rectangle".to_string(),
            annotation_color: "#ff6600".to_string(),
            stroke_width: 6,
            font_size: 28,
            text_font_family: "Georgia".to_string(),
            text_background_color: "#102030".to_string(),
            text_border_color: "#f4f4f4".to_string(),
            text_border_size: 2,
        };

        let (resolved_settings, resolved_shortcut, repaired) = resolve_startup_settings(Ok(settings.clone()));

        assert_eq!(resolved_settings, settings);
        assert_eq!(resolved_shortcut, validate_settings(&settings).expect("expected settings shortcut to validate"));
        assert!(!repaired);
    }

    #[test]
    fn resolve_startup_settings_falls_back_after_load_error() {
        let (resolved_settings, resolved_shortcut, repaired) =
            resolve_startup_settings(Err("failed to read settings file".to_string()));

        assert_eq!(resolved_settings, AppSettings::default());
        assert_eq!(resolved_shortcut, default_shortcut());
        assert!(repaired);
    }

    #[test]
    fn resolve_startup_settings_falls_back_after_invalid_loaded_settings() {
        let invalid_settings = AppSettings {
            shortcut: "DefinitelyNotAShortcut".to_string(),
            ..AppSettings::default()
        };

        let (resolved_settings, resolved_shortcut, repaired) =
            resolve_startup_settings(Ok(invalid_settings));

        assert_eq!(resolved_settings, AppSettings::default());
        assert_eq!(resolved_shortcut, default_shortcut());
        assert!(repaired);
    }

    #[test]
    fn swap_active_shortcut_registers_new_before_unregisting_old() {
        let current = "CmdOrCtrl+Shift+A"
            .parse::<Shortcut>()
            .expect("expected current shortcut to parse");
        let next = "CmdOrCtrl+Shift+S"
            .parse::<Shortcut>()
            .expect("expected next shortcut to parse");
        let operations = RefCell::new(Vec::new());

        let changed = swap_active_shortcut(
            &current,
            &next,
            &mut |shortcut| {
                operations.borrow_mut().push(format!("register:{shortcut}"));
                Ok(())
            },
            &mut |shortcut| {
                operations.borrow_mut().push(format!("unregister:{shortcut}"));
                Ok(())
            },
        )
        .expect("expected shortcut swap to succeed");

        assert!(changed);
        let expected_register = format!("register:{next}");
        let expected_unregister = format!("unregister:{current}");
        assert_eq!(
            operations.into_inner(),
            vec![expected_register, expected_unregister]
        );
    }

    #[test]
    fn swap_active_shortcut_skips_work_when_shortcut_is_unchanged() {
        let current = "CmdOrCtrl+Shift+A"
            .parse::<Shortcut>()
            .expect("expected shortcut to parse");
        let operations = RefCell::new(Vec::new());

        let changed = swap_active_shortcut(
            &current,
            &current,
            &mut |shortcut| {
                operations.borrow_mut().push(format!("register:{shortcut}"));
                Ok(())
            },
            &mut |shortcut| {
                operations.borrow_mut().push(format!("unregister:{shortcut}"));
                Ok(())
            },
        )
        .expect("expected unchanged shortcut to succeed");

        assert!(!changed);
        assert!(operations.into_inner().is_empty());
    }

    #[test]
    fn swap_active_shortcut_rolls_back_when_old_shortcut_unregistration_fails() {
        let current = "CmdOrCtrl+Shift+A"
            .parse::<Shortcut>()
            .expect("expected current shortcut to parse");
        let next = "CmdOrCtrl+Shift+S"
            .parse::<Shortcut>()
            .expect("expected next shortcut to parse");
        let operations = RefCell::new(Vec::new());

        let error = swap_active_shortcut(
            &current,
            &next,
            &mut |shortcut| {
                operations.borrow_mut().push(format!("register:{shortcut}"));
                Ok(())
            },
            &mut |shortcut| {
                operations.borrow_mut().push(format!("unregister:{shortcut}"));

                if shortcut == current {
                    Err("old shortcut still active".to_string())
                } else {
                    Ok(())
                }
            },
        )
        .expect_err("expected unregistration failure to bubble up");

        assert!(error.contains("failed to unregister previous shortcut"));
        let expected_register = format!("register:{next}");
        let expected_unregister_current = format!("unregister:{current}");
        let expected_unregister_next = format!("unregister:{next}");
        assert_eq!(
            operations.into_inner(),
            vec![expected_register, expected_unregister_current, expected_unregister_next]
        );
    }
}