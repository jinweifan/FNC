use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::UNIX_EPOCH,
};
use tauri::{Emitter, Manager, Size, Theme};

#[cfg(target_os = "macos")]
use objc2_foundation::{NSProcessInfo, NSString};

#[derive(Default)]
struct AppState {
    sessions: Mutex<HashMap<u64, SimulationSessionInternal>>,
    next_session_id: AtomicU64,
    locale: Mutex<String>,
    pending_launch_files: Mutex<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParseResult {
    file_path: String,
    file_name: String,
    extension: String,
    total_lines: usize,
    total_moves: usize,
    warnings: Vec<String>,
    content: String,
    lines: Vec<NcLine>,
    bounds: Bounds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NcLine {
    number: usize,
    text: String,
    motion: Option<MotionType>,
    x: Option<f64>,
    y: Option<f64>,
    z: Option<f64>,
    feed: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum MotionType {
    Rapid,
    Linear,
    ArcCw,
    ArcCcw,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Bounds {
    min_x: f64,
    min_y: f64,
    min_z: f64,
    max_x: f64,
    max_y: f64,
    max_z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MachineProfile {
    file_path: String,
    profile_type: String,
    post_name: String,
    machine_type: String,
    version: String,
    options: HashMap<String, String>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolLibrary {
    file_path: String,
    name: String,
    version: String,
    items: Vec<ToolItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolItem {
    index: usize,
    raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulationConfig {
    program_lines: Vec<NcLine>,
    breakpoints: Vec<usize>,
    speed: SimulationSpeed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum SimulationSpeed {
    Low,
    Standard,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulationSession {
    session_id: u64,
    frame_count: usize,
    current_index: usize,
    speed: SimulationSpeed,
    follow_tool: bool,
    current_line: usize,
    current_position: Vec3,
}

#[derive(Debug, Clone)]
struct SimulationSessionInternal {
    frames: Vec<FrameState>,
    current_index: usize,
    breakpoints: Vec<usize>,
    follow_tool: bool,
    camera: CameraState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StepSimulationRequest {
    session_id: u64,
    mode: StepMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum StepMode {
    Next,
    Prev,
    ToStart,
    ToEnd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameState {
    index: usize,
    line_number: usize,
    position: Vec3,
    motion: Option<MotionType>,
    paused_by_breakpoint: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CameraState {
    target: Vec3,
    position: Vec3,
    zoom: f64,
    view_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Vec3 {
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowState {
    session_id: u64,
    follow_tool: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportOptions {
    encoding: ExportEncoding,
    line_ending: LineEnding,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum ExportEncoding {
    Utf8,
    Utf8Bom,
    Ansi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum LineEnding {
    Lf,
    CrLf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    path: String,
    bytes_written: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocaleState {
    locale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartupAppearance {
    resolved_theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NcFileItem {
    path: String,
    file_name: String,
    size_bytes: u64,
    created_at_ms: u64,
}

#[tauri::command]
fn set_startup_appearance(
    appearance: StartupAppearance,
    app: tauri::AppHandle,
) -> Result<StartupAppearance, String> {
    write_startup_appearance(&app, &appearance)?;
    Ok(appearance)
}

#[tauri::command]
fn open_nc_file(path: String) -> Result<ParseResult, String> {
    let file = PathBuf::from(&path);
    let content = fs::read_to_string(&file).map_err(|e| format!("failed to read file: {e}"))?;
    let mut lines = Vec::new();
    let mut warnings = Vec::new();
    let mut current = Vec3::default();
    let mut min = Vec3 {
        x: f64::MAX,
        y: f64::MAX,
        z: f64::MAX,
    };
    let mut max = Vec3 {
        x: f64::MIN,
        y: f64::MIN,
        z: f64::MIN,
    };
    let mut move_count = 0;

    for (idx, raw_line) in content.lines().enumerate() {
        let cleaned = strip_comment(raw_line);
        let motion = detect_motion(&cleaned);
        let x = extract_axis(&cleaned, 'X');
        let y = extract_axis(&cleaned, 'Y');
        let z = extract_axis(&cleaned, 'Z');
        let feed = extract_axis(&cleaned, 'F');

        if let Some(v) = x {
            current.x = v;
        }
        if let Some(v) = y {
            current.y = v;
        }
        if let Some(v) = z {
            current.z = v;
        }

        if motion.is_some() {
            move_count += 1;
            min.x = min.x.min(current.x);
            min.y = min.y.min(current.y);
            min.z = min.z.min(current.z);
            max.x = max.x.max(current.x);
            max.y = max.y.max(current.y);
            max.z = max.z.max(current.z);
        }

        if cleaned.contains("M98") || cleaned.contains("G65") {
            warnings.push(format!("Line {} uses subprogram call; verify compatibility", idx + 1));
        }

        lines.push(NcLine {
            number: idx + 1,
            text: raw_line.to_string(),
            motion,
            x,
            y,
            z,
            feed,
        });
    }

    if move_count == 0 {
        min = Vec3::default();
        max = Vec3::default();
        warnings.push("No motion blocks detected.".to_string());
    }

    Ok(ParseResult {
        file_path: path.clone(),
        file_name: file
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string(),
        extension: file
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string(),
        total_lines: lines.len(),
        total_moves: move_count,
        warnings,
        content,
        lines,
        bounds: Bounds {
            min_x: min.x,
            min_y: min.y,
            min_z: min.z,
            max_x: max.x,
            max_y: max.y,
            max_z: max.z,
        },
    })
}

#[tauri::command]
fn load_machine_profile(path: String) -> Result<MachineProfile, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("failed to read profile: {e}"))?;
    let ini = parse_ini_like(&content);

    let post_name = ini
        .get("PostInfo")
        .and_then(|s| s.get("Name"))
        .cloned()
        .unwrap_or_else(|| "UNKNOWN".to_string());

    let machine_type = ini
        .get("PostInfo")
        .and_then(|s| s.get("McnType"))
        .cloned()
        .unwrap_or_else(|| "0".to_string());

    let version = ini
        .get("Info")
        .and_then(|s| s.get("Version"))
        .cloned()
        .unwrap_or_else(|| "0".to_string());

    let mut options = HashMap::new();
    if let Some(post_info) = ini.get("PostInfo") {
        for (k, v) in post_info {
            options.insert(k.clone(), v.clone());
        }
    }

    let profile_type = Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("mdl")
        .to_lowercase();

    let warnings = if !matches!(profile_type.as_str(), "mdl" | "wdl" | "ldl") {
        vec!["Unknown profile extension; parser used compatibility mode.".to_string()]
    } else {
        vec![]
    };

    Ok(MachineProfile {
        file_path: path,
        profile_type,
        post_name,
        machine_type,
        version,
        options,
        warnings,
    })
}

#[tauri::command]
fn load_tool_library(path: String) -> Result<ToolLibrary, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("failed to read tool file: {e}"))?;
    let ini = parse_ini_like(&content);
    let version = ini
        .get("Info")
        .and_then(|s| s.get("Version"))
        .cloned()
        .unwrap_or_else(|| "0".to_string());

    let mut items = vec![];
    if let Some(tools) = ini.get("Tools") {
        for (k, v) in tools {
            if let Some(raw_idx) = k.strip_prefix("Item") {
                if let Ok(index) = raw_idx.parse::<usize>() {
                    items.push(ToolItem {
                        index,
                        raw: v.clone(),
                    });
                }
            }
        }
    }
    items.sort_by_key(|t| t.index);

    Ok(ToolLibrary {
        file_path: path,
        name: "ToolLibrary".to_string(),
        version,
        items,
    })
}

#[tauri::command]
fn start_simulation(config: SimulationConfig, state: tauri::State<'_, AppState>) -> Result<SimulationSession, String> {
    if config.program_lines.is_empty() {
        return Err("program_lines is empty".to_string());
    }

    let frames = build_frames(&config.program_lines, &config.breakpoints);
    let session_id = state.next_session_id.fetch_add(1, Ordering::Relaxed) + 1;
    let first_frame = frames.first().cloned().ok_or_else(|| "No frames generated".to_string())?;

    let internal = SimulationSessionInternal {
        frames,
        current_index: 0,
        breakpoints: config.breakpoints,
        follow_tool: false,
        camera: CameraState {
            target: first_frame.position.clone(),
            position: Vec3 {
                x: first_frame.position.x + 120.0,
                y: first_frame.position.y + 120.0,
                z: first_frame.position.z + 120.0,
            },
            zoom: 1.0,
            view_name: "Iso".to_string(),
        },
    };

    state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?
        .insert(session_id, internal);

    Ok(SimulationSession {
        session_id,
        frame_count: build_frames(&config.program_lines, &[]).len(),
        current_index: 0,
        speed: config.speed,
        follow_tool: false,
        current_line: first_frame.line_number,
        current_position: first_frame.position,
    })
}

#[tauri::command]
fn step_simulation(request: StepSimulationRequest, state: tauri::State<'_, AppState>) -> Result<FrameState, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "session not found".to_string())?;

    let len = session.frames.len();
    if len == 0 {
        return Err("empty session".to_string());
    }

    session.current_index = match request.mode {
        StepMode::Next => (session.current_index + 1).min(len - 1),
        StepMode::Prev => session.current_index.saturating_sub(1),
        StepMode::ToStart => 0,
        StepMode::ToEnd => len - 1,
    };

    let mut frame = session.frames[session.current_index].clone();
    frame.paused_by_breakpoint = session.breakpoints.contains(&frame.line_number);

    if session.follow_tool {
        session.camera.target = frame.position.clone();
    }

    Ok(frame)
}

#[tauri::command]
fn set_camera(session_id: u64, camera_state: CameraState, state: tauri::State<'_, AppState>) -> Result<CameraState, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "session not found".to_string())?;

    session.camera = camera_state.clone();
    Ok(camera_state)
}

#[tauri::command]
fn set_named_view(session_id: u64, view_name: String, state: tauri::State<'_, AppState>) -> Result<CameraState, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "session not found".to_string())?;

    let current = session.frames[session.current_index].position.clone();
    let camera = named_view_camera(&view_name, current);
    session.camera = camera.clone();
    Ok(camera)
}

#[tauri::command]
fn toggle_camera_follow_tool(session_id: u64, enabled: bool, state: tauri::State<'_, AppState>) -> Result<FollowState, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;

    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "session not found".to_string())?;

    session.follow_tool = enabled;
    Ok(FollowState {
        session_id,
        follow_tool: enabled,
    })
}

#[tauri::command]
fn export_nc_file(path: String, content: String, export_options: ExportOptions) -> Result<ExportResult, String> {
    let normalized = match export_options.line_ending {
        LineEnding::Lf => content.replace("\r\n", "\n"),
        LineEnding::CrLf => content.replace("\r\n", "\n").replace('\n', "\r\n"),
    };

    let bytes = match export_options.encoding {
        ExportEncoding::Utf8 => normalized.into_bytes(),
        ExportEncoding::Utf8Bom => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(normalized.as_bytes());
            out
        }
        ExportEncoding::Ansi => {
            let (cow, _, _) = encoding_rs::GBK.encode(&normalized);
            cow.into_owned()
        }
    };

    fs::write(&path, &bytes).map_err(|e| format!("failed to export file: {e}"))?;
    Ok(ExportResult {
        path,
        bytes_written: bytes.len(),
    })
}

#[tauri::command]
fn set_locale(locale: String, state: tauri::State<'_, AppState>) -> Result<LocaleState, String> {
    let mut lock = state
        .locale
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    *lock = locale.clone();
    Ok(LocaleState { locale })
}

fn startup_appearance_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app config dir: {e}"))?;
    Ok(dir.join("startup-appearance.json"))
}

fn read_startup_appearance<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<StartupAppearance> {
    let path = startup_appearance_path(app).ok()?;
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<StartupAppearance>(&content).ok()
}

fn write_startup_appearance<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    appearance: &StartupAppearance,
) -> Result<(), String> {
    let path = startup_appearance_path(app)?;
    let content = serde_json::to_vec_pretty(appearance)
        .map_err(|e| format!("failed to serialize startup appearance: {e}"))?;
    fs::write(path, content).map_err(|e| format!("failed to write startup appearance: {e}"))
}

fn startup_theme_background(theme: &str) -> tauri::webview::Color {
    match theme {
        "dark" => tauri::webview::Color(0, 0, 0, 255),
        "navy" => tauri::webview::Color(2, 6, 23, 255),
        _ => tauri::webview::Color(238, 242, 247, 255),
    }
}

fn startup_theme_window_theme(theme: &str) -> Option<Theme> {
    match theme {
        "dark" | "navy" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    }
}

fn apply_adaptive_window_size(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let min_width = 980.0;
    let min_height = 640.0;
    let _ = window.set_min_size(Some(Size::Logical(tauri::LogicalSize::new(
        min_width, min_height,
    ))));
    let _ = window.set_fullscreen(false);
    let _ = window.unmaximize();

    if let Ok(Some(monitor)) = window.current_monitor() {
        let monitor_size = monitor.size();
        let scale = monitor.scale_factor().max(1.0);
        let logical_w = monitor_size.width as f64 / scale;
        let logical_h = monitor_size.height as f64 / scale;

        let max_w = (logical_w - 120.0).max(min_width);
        let max_h = (logical_h - 120.0).max(min_height);
        let target_w = (logical_w * 0.74).clamp(min_width, max_w);
        let target_h = (logical_h * 0.78).clamp(min_height, max_h);

        let _ = window.set_size(Size::Logical(tauri::LogicalSize::new(target_w, target_h)));
    }

    let _ = window.center();
}

#[tauri::command]
fn list_nc_files_in_folder(folder_path: String) -> Result<Vec<NcFileItem>, String> {
    let mut files: Vec<NcFileItem> = fs::read_dir(&folder_path)
        .map_err(|e| format!("failed to read folder: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if !(path.is_file()
                && path
                    .extension()
                    .and_then(|s| s.to_str())
                    .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "nc" | "anc"))
                    .unwrap_or(false))
            {
                return None;
            }

            let metadata = entry.metadata().ok()?;
            let created = metadata
                .created()
                .or_else(|_| metadata.modified())
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            let path_str = path.to_str()?.to_string();
            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();

            Some(NcFileItem {
                path: path_str,
                file_name,
                size_bytes: metadata.len(),
                created_at_ms: created,
            })
        })
        .collect();

    files.sort_by_key(|item| item.file_name.to_lowercase());

    Ok(files)
}

#[tauri::command]
fn get_launch_nc_file() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| normalize_launch_arg_to_file(arg.to_string_lossy().as_ref()))
        .find_map(|path| path.to_str().map(|s| s.to_string()))
}

#[tauri::command]
fn take_pending_launch_nc_files(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut lock = state
        .pending_launch_files
        .lock()
        .map_err(|_| "state lock poisoned".to_string())?;
    Ok(std::mem::take(&mut *lock))
}

fn normalize_launch_arg_to_file(raw: &str) -> Option<PathBuf> {
    let arg = raw.trim();
    if arg.is_empty() {
        return None;
    }
    // macOS process serial argument, not a file path.
    if arg.starts_with("-psn_") {
        return None;
    }

    let path = if arg.starts_with("file://") {
        let url = url::Url::parse(arg).ok()?;
        url.to_file_path().ok()?
    } else {
        PathBuf::from(arg)
    };

    if !path.is_file() {
        return None;
    }

    Some(path)
}

fn collect_launch_paths_from_args() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|arg| normalize_launch_arg_to_file(arg.to_string_lossy().as_ref()))
        .filter_map(|path| path.to_str().map(|s| s.to_string()))
        .collect()
}

#[cfg(target_os = "macos")]
fn normalize_opened_url_to_file(url: &url::Url) -> Option<String> {
    let path = url.to_file_path().ok()?;
    if !path.is_file() {
        return None;
    }
    path.to_str().map(|s| s.to_string())
}


fn strip_comment(line: &str) -> String {
    let mut no_paren = String::new();
    let mut in_paren = false;
    for c in line.chars() {
        if c == '(' {
            in_paren = true;
            continue;
        }
        if c == ')' {
            in_paren = false;
            continue;
        }
        if !in_paren {
            no_paren.push(c);
        }
    }

    no_paren
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_uppercase()
}

fn detect_motion(line: &str) -> Option<MotionType> {
    if line.contains("G00") || line.contains("G0 ") {
        Some(MotionType::Rapid)
    } else if line.contains("G01") || line.contains("G1 ") {
        Some(MotionType::Linear)
    } else if line.contains("G02") || line.contains("G2 ") {
        Some(MotionType::ArcCw)
    } else if line.contains("G03") || line.contains("G3 ") {
        Some(MotionType::ArcCcw)
    } else {
        None
    }
}

fn extract_axis(line: &str, axis: char) -> Option<f64> {
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == axis {
            let mut number = String::new();
            while let Some(next) = chars.peek() {
                if next.is_ascii_digit() || *next == '.' || *next == '-' || *next == '+' {
                    number.push(*next);
                    chars.next();
                } else {
                    break;
                }
            }
            if !number.is_empty() {
                if let Ok(v) = number.parse::<f64>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn build_frames(lines: &[NcLine], breakpoints: &[usize]) -> Vec<FrameState> {
    let mut frames = Vec::new();
    let mut current = Vec3::default();

    for line in lines {
        if let Some(v) = line.x {
            current.x = v;
        }
        if let Some(v) = line.y {
            current.y = v;
        }
        if let Some(v) = line.z {
            current.z = v;
        }

        if line.motion.is_some() {
            frames.push(FrameState {
                index: frames.len(),
                line_number: line.number,
                position: current.clone(),
                motion: line.motion.clone(),
                paused_by_breakpoint: breakpoints.contains(&line.number),
            });
        }
    }

    if frames.is_empty() {
        frames.push(FrameState {
            index: 0,
            line_number: 1,
            position: Vec3::default(),
            motion: None,
            paused_by_breakpoint: false,
        });
    }

    frames
}

fn named_view_camera(view_name: &str, target: Vec3) -> CameraState {
    let (dx, dy, dz) = match view_name.to_lowercase().as_str() {
        "top" => (0.0, 0.0, 180.0),
        "front" => (0.0, 180.0, 0.0),
        "left" => (180.0, 0.0, 0.0),
        "lathe" => (150.0, -80.0, 50.0),
        _ => (120.0, 120.0, 120.0),
    };

    CameraState {
        target: target.clone(),
        position: Vec3 {
            x: target.x + dx,
            y: target.y + dy,
            z: target.z + dz,
        },
        zoom: 1.0,
        view_name: view_name.to_string(),
    }
}

fn parse_ini_like(content: &str) -> HashMap<String, HashMap<String, String>> {
    let mut out: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut section = "default".to_string();

    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].to_string();
            continue;
        }

        if let Some((k, v)) = line.split_once('=') {
            out.entry(section.clone()).or_default().insert(
                k.trim().to_string(),
                v.trim().trim_matches('"').to_string(),
            );
        }
    }

    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    apply_macos_process_name();

    let initial_launch_files = collect_launch_paths_from_args();

    tauri::Builder::default()
        .manage(AppState {
            sessions: Mutex::new(HashMap::new()),
            next_session_id: AtomicU64::new(0),
            locale: Mutex::new("zh-CN".to_string()),
            pending_launch_files: Mutex::new(initial_launch_files),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            app.handle().plugin(tauri_plugin_dialog::init())?;
            apply_adaptive_window_size(app);
            if let Some(main_window) = app.get_webview_window("main") {
                let appearance = read_startup_appearance(app.handle()).unwrap_or(StartupAppearance {
                    resolved_theme: "light".to_string(),
                });
                let _ = main_window.set_background_color(Some(startup_theme_background(&appearance.resolved_theme)));
                let _ = main_window.set_theme(startup_theme_window_theme(&appearance.resolved_theme));
            }
            Ok(())
        })
        .on_page_load(|webview, _payload| {
            if webview.label() == "main" {
                let window = webview.window();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_startup_appearance,
            open_nc_file,
            load_machine_profile,
            load_tool_library,
            start_simulation,
            step_simulation,
            set_camera,
            set_named_view,
            toggle_camera_follow_tool,
            export_nc_file,
            set_locale,
            list_nc_files_in_folder,
            get_launch_nc_file,
            take_pending_launch_nc_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(not(target_os = "macos"))]
            let _ = (&app, &event);
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let files: Vec<String> = urls
                    .iter()
                    .filter_map(normalize_opened_url_to_file)
                    .collect();
                if files.is_empty() {
                    return;
                }

                if let Ok(mut pending) = app.state::<AppState>().pending_launch_files.lock() {
                    pending.extend(files.iter().cloned());
                }

                for path in files {
                    let _ = app.emit("launch-nc-file", path);
                }
            }
        });
}

#[cfg(target_os = "macos")]
fn apply_macos_process_name() {
    let process_name = NSString::from_str("First NC Viewer");
    let process_info = NSProcessInfo::processInfo();
    process_info.setProcessName(&process_name);
}
