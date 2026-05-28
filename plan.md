# Project Plan: Cross-Platform Screencap Application (Tauri + Rust + TS)

## 1. Business Context & Objective
The goal of this project is to develop a lightweight, high-performance, cross-platform (Windows & macOS) screen capture utility. 
Unlike bloated alternatives, this application focuses on a minimal memory footprint (< 30MB idle) and seamless integration into user workflows (hotkey triggering, canvas editing, and clipboard/file output).

---

## 2. Technical Stack
- **Backend Core:** Rust (Tauri v2 Framework)
- **Frontend UI:** TypeScript + Vite + HTML5 Canvas (or Fabric.js/Konva.js)
- **Inter-Process Communication (IPC):** Tauri Commands and Events
- **Key Rust Crates:** `screenshots` (or `scap`), `tauri-plugin-global-shortcut`, `tauri-plugin-clipboard-manager`

---

## 3. Functional Requirements & User Stories

### 3.1 Core Workflow (MVP)
- **User Story 1: Global Hotkey Activation**
  - *As a* user, *I want to* press a customizable global hotkey (Default: `CmdOrCtrl+Shift+A`), *so that* I can instantly trigger the screenshot mode regardless of which app is currently focused.
  - **Acceptance Criteria:**
    1. The app must run as a background agent / system tray icon.
    2. Pressing the hotkey hides the main app window (if visible), captures the screen buffer, and opens a transparent, borderless, full-screen overlay window within $100\text{ms}$.

- **User Story 2: Area Selection & Window Detection**
  - *As a* user, *I want to* drag my mouse to select a rectangular area of the screen, *so that* I can capture exactly what I need.
  - **Acceptance Criteria:**
    1. Display crosshairs and real-time pixel dimensions (e.g., `800 x 600`) during dragging.
    2. Pressing `Esc` must abort the screenshot mode and clean up memory immediately.

- **User Story 3: Canvas Annotation**
  - *As a* user, *I want to* annotate the selected area using basic drawing tools, *so that* I can highlight specific details before saving.
  - **Acceptance Criteria:**
    1. Provide at least 4 tools: Rectangle, Arrow, Blur/Mosaic, and Text input.
    2. Support `Ctrl+Z` / `Cmd+Z` to undo the last annotation object.
    3. Annotations must be managed as vector objects on the canvas, not direct destructive pixel modifications, until the final export.

- **User Story 4: Output Execution**
  - *As a* user, *I want to* copy the final annotated image to my system clipboard or save it locally, *so that* I can share it instantly.
  - **Acceptance Criteria:**
    1. Double-clicking inside the selection area or clicking the "Confirm" button writes the flattened image bytes directly to the OS clipboard.
    2. Provide a "Save" button that invokes the native OS file picker to save as PNG/JPG.

---

## 4. Non-Functional Requirements

| Category | Requirement Specification |
| :--- | :--- |
| **Performance** | Hotkey-to-overlay latency **$< 100\text{ms}$**. Idle RAM usage **$< 30\text{MB}$**. Installation package size **$< 15\text{MB}$**. |
| **Security** | On macOS, check for Screen Recording permissions via `CGPreflightScreenCaptureAccess`. If `false`, prompt user via system settings. All data must reside locally unless cloud export is explicitly added later. |
| **Usability** | Support keyboard micro-adjustments (Arrow keys move selection by 1 pixel; Shift + Arrow keys by 10 pixels). |

---

## 5. System Design & Data Flow

### 5.1 Architecture Diagram
```mermaid
graph TD
    subgraph Frontend (UI Layer - TS)
        A[Overlay Canvas] --> B[Annotation Controller]
        B --> C[Export Utility]
    end

    subgraph Tauri IPC Bridge
        D[Tauri Commands / Events]
    end

    subgraph Backend Core (Rust Engine)
        E[Global Hotkey Manager]
        F[Screen Capture Engine]
        G[OS Clipboard Bridge]
    end

    C <--> D
    D <--> E & F & G

```

### 5.2 Data Structure: Annotation Canvas State (JSON Schema)

```json
{
  "screenshot_id": "string",
  "dimensions": { "width": "number", "height": "number" },
  "shapes": [
    {
      "id": "string",
      "type": "arrow | rectangle | text | blur",
      "stroke_color": "string",
      "stroke_width": "number",
      "points": [ "number" ],
      "text_content": "string"
    }
  ]
}

```

---

## 6. Implementation Considerations & Edge Cases (For Copilot Guidance)

### 6.1 Multi-Monitor & DPI Awareness (Crucial)

* **Problem:** Windows Per-Monitor DPI scaling (e.g., Main monitor 150%, Secondary monitor 100%) and macOS Retina backing scale factors cause coordinate mismatch and blurry captures.
* **Copilot Directive:** - In Rust, utilize the `scale_factor` from `tauri::Monitor` to correctly map physical screen buffers to logical frontend CSS pixels.
* Ensure the Tauri window initialization sets `.set_resizable(false)`, `.set_decorations(false)`, and `.set_transparent(true)`.



### 6.2 Application Lifecycle & Window Recycling

* **Problem:** Recreating the Tauri window on every hotkey press introduces performance overhead.
* **Copilot Directive:** Create the overlay window once at startup, keep it hidden (`.hide()`), and use `.show()` / `.focus()` when the hotkey is triggered. Ensure the window covers the specific monitor boundary where the mouse cursor currently resides.

---

## 7. Phase-Based Implementation Roadmap

### Phase 1: Rust Backend Infrastructure

* [ ] Initialize Tauri v2 project.
* [ ] Implement system tray icon menu (Quit, Settings).
* [ ] Setup `tauri-plugin-global-shortcut` to listen to `CmdOrCtrl+Shift+A`.
* [ ] Implement Rust command utilizing `screenshots` crate to capture current display buffers and convert them to Base64 strings or temporary image files.

### Phase 2: Frontend Overlay & Canvas UI

* [ ] Design a fullscreen frameless transparent HTML template.
* [ ] Implement Canvas to render the captured image buffer as background.
* [ ] Implement mouse event listeners (`mousedown`, `mousemove`, `mouseup`) to draw the selection box boundary.
* [ ] Implement keyboard listeners (`Esc` to hide window, Arrow keys to tweak bounds).

### Phase 3: Annotation Features

* [ ] Integrate a canvas library (e.g., Konva/Fabric) or implement custom stateful `CustomPainter` logic.
* [ ] Implement drawing tools: Rectangle, Arrow, Text.
* [ ] Implement pixelation filter for the "Blur/Mosaic" tool.
* [ ] Implement Undo stack array for state management.

### Phase 4: OS Integration & Optimization

* [ ] Map the "Confirm" event to call `tauri-plugin-clipboard-manager` to write PNG bytes to OS clipboard.
* [ ] Handle macOS screen recording permission guardrails.
* [ ] Handle Windows High-DPI coordinate calculation fixes.

---

## 8. Testing Matrix (Instructions for QA/Copilot Test Generation)

### 8.1 Unit Tests (Rust)

* Test hotkey registration and unregistration lifecycle.
* Test monitor detection returns correct bounds and `scale_factor`.

### 8.2 Integration Tests (Frontend & IPC)

* Verify `invoke('capture_screen')` returns a valid data URI/path string.
* Verify pressing `Esc` key successfully fires window hide command.

### 8.3 Edge Case Manual Checklist

* [ ] App behavior when secondary monitor is disconnected/reconnected during execution.
* [ ] Capturing screens with different scale factors (e.g., 100% vs 200%).
* [ ] Denying macOS screen recording permission, verifying the warning dialog pops up gracefully.

```

***

### 如何使用這份文件搭配 GitHub Copilot：

1. **引導上下文：** 在 VS Code / Cursor 中開啟這個 `plan.md`，並在與 Copilot Chat 對話時輸入：
   > *"Please read `plan.md` to understand the complete architecture and specs of my project. Let's start with Phase 1: Rust Backend Infrastructure. Please generate the `main.rs` and `tauri.conf.json` template according to the instructions."*
2. **逐步代碼生成：** 按照規劃書中的 **Phase 1 到 Phase 4**，一塊一塊地讓 Copilot 生產代碼。因為文件內寫明了 Edge Cases（如 DPI 縮放、macOS 權限），Copilot 在寫程式碼時會主動避開這些跨平台的常見陷阱。
