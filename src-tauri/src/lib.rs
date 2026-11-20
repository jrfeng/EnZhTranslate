use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;

const DEFAULT_SOURCE_LANG: &str = "英语";
const DEFAULT_TARGET_LANG: &str = "简体中文";

/// 按「源语言 → 目标语言」生成系统提示词
fn system_prompt(source: &str, target: &str) -> String {
    let source = if source.trim().is_empty() {
        DEFAULT_SOURCE_LANG
    } else {
        source.trim()
    };
    let target = if target.trim().is_empty() {
        DEFAULT_TARGET_LANG
    } else {
        target.trim()
    };

    format!(
        "你是一个纯粹的翻译引擎。\n\
         用户会给你一段{source}文本，你唯一的任务是把这段文本翻译成{target}。\n\
         不要做任何多余的事：不要解释、不要总结、不要评论、不要加任何前言或结语、\n\
         不要加引号或书名号、不要保留原文、不要回答原文里提出的问题。\n\
         保持原文的段落与换行结构；代码、命令、文件路径、变量名、URL 保持原样。\n\
         只输出{target}译文本身。"
    )
}

const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
const DEFAULT_MODEL: &str = "deepseek-chat";
const MAX_INPUT_CHARS: usize = 20000;

#[derive(Deserialize)]
struct TranslateRequest {
    #[serde(default)]
    text: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    target: String,
    #[serde(default, rename = "apiKey")]
    api_key: String,
    #[serde(default, rename = "baseURL")]
    base_url: String,
    #[serde(default)]
    model: String,
}

#[derive(Deserialize)]
struct ModelsRequest {
    #[serde(default, rename = "apiKey")]
    api_key: String,
    #[serde(default, rename = "baseURL")]
    base_url: String,
}

fn resolve_base_url(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        DEFAULT_BASE_URL.to_string()
    } else {
        trimmed.trim_end_matches('/').to_string()
    }
}

fn error_json(code: &str, message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": { "code": code, "message": message.into() } })
}

fn status_code(status: u16) -> &'static str {
    match status {
        401 => "UNAUTHORIZED",
        402 => "QUOTA",
        429 => "RATE_LIMIT",
        500..=599 => "UPSTREAM",
        _ => "REQUEST_FAILED",
    }
}

fn upstream_message(data: &Value) -> String {
    data.get("error")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
        .unwrap_or("模型接口返回错误")
        .to_string()
}

#[tauri::command]
async fn translate(request: TranslateRequest) -> Value {
    let text = request.text.trim();
    if text.is_empty() {
        return error_json("EMPTY_INPUT", "请先输入要翻译的原文。");
    }
    if text.chars().count() > MAX_INPUT_CHARS {
        return error_json(
            "TOO_LONG",
            format!("文本超过 {MAX_INPUT_CHARS} 字符，请分段翻译。"),
        );
    }

    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return error_json("NO_KEY", "请先在「设置」里填写 API Key。");
    }

    let model = if request.model.trim().is_empty() {
        DEFAULT_MODEL
    } else {
        request.model.trim()
    };
    let url = format!("{}/chat/completions", resolve_base_url(&request.base_url));

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
    {
        Ok(client) => client,
        Err(error) => return error_json("INTERNAL", error.to_string()),
    };

    let body = json!({
        "model": model,
        "stream": false,
        "temperature": 0,
        "messages": [
            { "role": "system", "content": system_prompt(&request.source, &request.target) },
            { "role": "user", "content": text }
        ]
    });

    let response = match client
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return error_json("NETWORK", format!("调用模型失败：{error}")),
    };

    let status = response.status();
    let data: Value = response.json().await.unwrap_or(Value::Null);

    if !status.is_success() {
        return error_json(status_code(status.as_u16()), upstream_message(&data));
    }

    let content = data
        .get("choices")
        .and_then(|value| value.get(0))
        .and_then(|value| value.get("message"))
        .and_then(|value| value.get("content"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if content.is_empty() {
        return error_json("EMPTY_TRANSLATION", "模型没有返回译文。");
    }

    // 把 usage 一起带回前端：DeepSeek 会给出 prompt/completion/total，
    // 以及缓存命中 / 未命中两个细分字段；其它兼容服务可能只有前三个。
    let usage = data.get("usage").cloned().unwrap_or(Value::Null);

    json!({
        "ok": true,
        "translation": content,
        "model": model,
        "usage": usage
    })
}

#[tauri::command]
async fn models(request: ModelsRequest) -> Value {
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return error_json("NO_KEY", "请先填写 API Key。");
    }
    let url = format!("{}/models", resolve_base_url(&request.base_url));

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(error) => return error_json("INTERNAL", error.to_string()),
    };

    let response = match client.get(&url).bearer_auth(api_key).send().await {
        Ok(response) => response,
        Err(error) => return error_json("NETWORK", format!("读取模型列表失败：{error}")),
    };

    let status = response.status();
    let data: Value = response.json().await.unwrap_or(Value::Null);

    if !status.is_success() {
        return error_json(status_code(status.as_u16()), upstream_message(&data));
    }

    let list: Vec<Value> = data
        .get("data")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
                .map(|id| json!({ "id": id }))
                .collect()
        })
        .unwrap_or_default();

    json!({ "ok": true, "models": list })
}

#[derive(Deserialize)]
struct BalanceRequest {
    #[serde(default, rename = "apiKey")]
    api_key: String,
    #[serde(default, rename = "baseURL")]
    base_url: String,
}

#[tauri::command]
async fn balance(request: BalanceRequest) -> Value {
    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return error_json("NO_KEY", "请先填写 API Key。");
    }
    let url = format!("{}/user/balance", resolve_base_url(&request.base_url));

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(error) => return error_json("INTERNAL", error.to_string()),
    };

    let response = match client.get(&url).bearer_auth(api_key).send().await {
        Ok(response) => response,
        Err(error) => return error_json("NETWORK", format!("查询余额失败：{error}")),
    };

    let status = response.status();
    let data: Value = response.json().await.unwrap_or(Value::Null);

    if !status.is_success() {
        return error_json(status_code(status.as_u16()), upstream_message(&data));
    }

    let info = data
        .get("balance_infos")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first());

    let field = |name: &str| -> String {
        info.and_then(|value| value.get(name))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string()
    };

    json!({
        "ok": true,
        "available": data.get("is_available").and_then(|value| value.as_bool()).unwrap_or(true),
        "currency": field("currency"),
        "total": field("total_balance"),
        "granted": field("granted_balance"),
        "toppedUp": field("topped_up_balance"),
    })
}

#[derive(Deserialize)]
struct OcrRequest {
    #[serde(default, rename = "apiKey")]
    api_key: String,
    #[serde(default, rename = "baseURL")]
    base_url: String,
    #[serde(default, rename = "fileName")]
    file_name: String,
    #[serde(default)]
    mime: String,
    /// base64 编码的图片内容（不含 data: 前缀）
    #[serde(default)]
    data: String,
}

/// 调用 DeepSeek OCR 接口识别图片文字：POST {base}/v1/tools/ocr（multipart）
#[tauri::command]
async fn ocr(request: OcrRequest) -> Value {
    use base64::Engine;

    let api_key = request.api_key.trim();
    if api_key.is_empty() {
        return error_json("NO_KEY", "请先在「设置」里填写 API Key。");
    }

    let bytes = match base64::engine::general_purpose::STANDARD.decode(request.data.trim()) {
        Ok(bytes) => bytes,
        Err(_) => return error_json("BAD_IMAGE", "图片数据无法解析。"),
    };
    if bytes.is_empty() {
        return error_json("BAD_IMAGE", "图片内容是空的。");
    }

    let file_name = if request.file_name.trim().is_empty() {
        "image.png".to_string()
    } else {
        request.file_name.trim().to_string()
    };
    let mime = if request.mime.trim().is_empty() {
        "application/octet-stream".to_string()
    } else {
        request.mime.trim().to_string()
    };

    let part = match reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(&mime)
    {
        Ok(part) => part,
        Err(error) => return error_json("BAD_IMAGE", format!("图片类型无法识别：{error}")),
    };

    let form = reqwest::multipart::Form::new()
        .text("purpose", "text_recognition")
        .part("file", part);

    let url = format!("{}/v1/tools/ocr", resolve_base_url(&request.base_url));

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(240))
        .build()
    {
        Ok(client) => client,
        Err(error) => return error_json("INTERNAL", error.to_string()),
    };

    let response = match client
        .post(&url)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return error_json("NETWORK", format!("调用 OCR 接口失败：{error}")),
    };

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let data: Value = serde_json::from_str(&body).unwrap_or(Value::Null);

    if !status.is_success() {
        let message = if data.is_null() {
            format!("OCR 接口返回 {status}")
        } else {
            upstream_message(&data)
        };
        // 按官方 OCR 文档的错误表细分，前端好给具体提示
        let code = match status.as_u16() {
            400 => "BAD_REQUEST",
            402 => "QUOTA",
            408 => "UPLOAD_SLOW",
            413 => "TOO_LARGE",
            429 => "RATE_LIMIT",
            500 => "UPLOAD_FAILED",
            503 => "BUSY",
            504 => "TIMEOUT",
            other => status_code(other),
        };
        return error_json(code, message);
    }

    // 识别开始后状态码是 200，失败时响应体是错误对象
    if let Some(message) = data
        .get("error")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
    {
        return error_json("OCR_FAILED", message.to_string());
    }

    let pages = data
        .get("pages")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let text = pages
        .iter()
        .filter_map(|page| page.get("text").and_then(|value| value.as_str()))
        .collect::<Vec<_>>()
        .join("\n\n");

    json!({
        "ok": true,
        "text": text,
        "pageCount": data
            .get("page_count")
            .and_then(|value| value.as_u64())
            .unwrap_or(pages.len() as u64),
    })
}

#[derive(Deserialize)]
struct ClipboardWriteRequest {
    #[serde(default)]
    text: String,
}

/// 读系统剪贴板的文本和 HTML（自定义右键菜单的「粘贴」用：
/// 有 HTML 就转成 Markdown，没有就退回纯文本）
#[tauri::command]
async fn clipboard_read() -> Value {
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(clipboard) => clipboard,
        Err(error) => return error_json("CLIPBOARD", format!("无法访问剪贴板：{error}")),
    };

    let text = clipboard.get_text().unwrap_or_default();
    let html = clipboard.get().html().unwrap_or_default();

    json!({ "ok": true, "text": text, "html": html })
}

/// 写系统剪贴板的文本（自定义右键菜单的「复制 / 剪切」用）
#[tauri::command]
async fn clipboard_write(request: ClipboardWriteRequest) -> Value {
    match arboard::Clipboard::new() {
        Ok(mut clipboard) => match clipboard.set_text(request.text) {
            Ok(()) => json!({ "ok": true }),
            Err(error) => error_json("CLIPBOARD", format!("写入剪贴板失败：{error}")),
        },
        Err(error) => error_json("CLIPBOARD", format!("无法访问剪贴板：{error}")),
    }
}

/// 前端把首屏渲染完之后调用：这时才把窗口显示出来，避免启动时闪白
#[tauri::command]
fn app_ready(window: tauri::WebviewWindow) -> Value {
    if startup_maximized() {
        // 最大化启动：窗口在 setup 里已经最大化并显示，
        // 这里只确认状态，绝不能 set_size —— 对最大化窗口 set_size 会先还原成普通窗口，肉眼可见地闪一下
        if !window.is_maximized().unwrap_or(false) {
            let _ = window.maximize();
        }
        let _ = window.set_focus();
        return json!({ "ok": true });
    }
    // 普通启动：显示前后各应用一次，压掉 WebView2 首帧对尺寸的重算
    restore_window_size(&window);
    let _ = window.show();
    restore_window_size(&window);
    let _ = window.set_focus();
    json!({ "ok": true })
}

#[derive(Deserialize)]
struct ThemeRequest {
    theme: String,
}

const THEME_FILE_NAME: &str = "theme.json";

/// 主题 id 对应的页面底色（与 app.css 里 --app-bg 保持一致）
fn theme_background(id: &str) -> (u8, u8, u8) {
    match id {
        "a" => (0x0d, 0x0d, 0x10),
        "c" => (0xfd, 0xfa, 0xf2),
        "d" => (0xdc, 0xe9, 0xfb),
        _ => (0xf2, 0xf2, 0xf5),
    }
}

fn theme_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(THEME_FILE_NAME))
}

fn saved_theme_id(app: &tauri::AppHandle) -> Option<String> {
    let path = theme_file(app)?;
    let id = std::fs::read_to_string(path).ok()?.trim().to_string();
    matches!(id.as_str(), "a" | "b" | "c" | "d").then_some(id)
}

/// 启动时用哪个主题给窗口上底色：优先用上次保存的主题，没有就跟随系统
fn startup_theme_id(window: &tauri::WebviewWindow) -> String {
    if let Some(id) = saved_theme_id(&window.app_handle()) {
        return id;
    }
    match window.theme() {
        Ok(tauri::Theme::Dark) => "a".to_string(),
        _ => "b".to_string(),
    }
}

fn apply_window_theme_color(window: &tauri::WebviewWindow, id: &str) {
    let (red, green, blue) = theme_background(id);
    // 让 WebView 首帧之前的底色就是主题色，避免浅色用户看到深色/白色底板
    let _ = window.set_background_color(Some(tauri::window::Color(red, green, blue, 255)));
}

/// 前端切换主题时调用：落盘 + 立刻更新窗口底色
#[tauri::command]
fn save_theme(window: tauri::WebviewWindow, request: ThemeRequest) -> Value {
    let id = match request.theme.as_str() {
        "a" | "b" | "c" | "d" => request.theme,
        _ => "b".to_string(),
    };
    if let Some(path) = theme_file(&window.app_handle()) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, &id);
    }
    apply_window_theme_color(&window, &id);
    json!({ "ok": true })
}

// ---------------------------------------------------------------- 窗口几何记忆

/// 诊断日志只在 FISH_DEBUG=1 的构建里编译进去（release 包整体剔除）
const WINDOW_DEBUG: bool = match option_env!("FISH_DEBUG") {
    Some(value) => value.len() == 1 && value.as_bytes()[0] == b'1',
    None => false,
};

/// 窗口尺寸的保存位置：应用配置目录下的 window-size.json
fn window_size_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("window-size.json"))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// 写一行窗口日志：控制台 + %TEMP%\fish-window.log，便于事后排查
fn window_log(message: &str) {
    if !WINDOW_DEBUG {
        return;
    }
    eprintln!("[window] {message}");
    let path = std::env::temp_dir().join("fish-window.log");
    let line = format!("[{}] {message}\n", now_ms());
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write;
        let _ = file.write_all(line.as_bytes());
    }
}

#[derive(Clone, Copy, Debug)]
struct WindowGeometry {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Clone, Copy)]
struct SavedState {
    geometry: WindowGeometry,
    has_position: bool,
    maximized: bool,
}

/// 最后一次"非最大化"的几何：最大化关闭时用它写盘
static LAST_NORMAL: std::sync::Mutex<Option<WindowGeometry>> = std::sync::Mutex::new(None);
/// 本次启动是否应该以最大化状态出现（上次是最大化关闭的）
static STARTUP_MAXIMIZED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

impl SavedState {
    fn valid(&self) -> bool {
        (360..=7680).contains(&self.geometry.width)
            && (480..=4320).contains(&self.geometry.height)
            && (-32768..=32768).contains(&self.geometry.x)
            && (-32768..=32768).contains(&self.geometry.y)
    }
}

fn current_geometry(window: &tauri::WebviewWindow) -> Option<WindowGeometry> {
    let size = window.inner_size().ok()?;
    let position = window.outer_position().ok()?;
    let scale = window.scale_factor().unwrap_or(1.0);
    Some(WindowGeometry {
        x: (position.x as f64 / scale).round() as i32,
        y: (position.y as f64 / scale).round() as i32,
        width: (size.width as f64 / scale).round() as i32,
        height: (size.height as f64 / scale).round() as i32,
    })
}

/// 几何是否接近某块显示器尺寸：最大化动画过程中会短暂出现这种尺寸，
/// 不能把它当成"用户想要的尺寸"记下来
fn is_screen_sized(window: &tauri::WebviewWindow, geometry: &WindowGeometry) -> bool {
    let Ok(monitors) = window.available_monitors() else { return false };
    let scale = window.scale_factor().unwrap_or(1.0);
    monitors.iter().any(|monitor| {
        let size = monitor.size();
        let logical_width = (size.width as f64 / scale).round() as i32;
        let logical_height = (size.height as f64 / scale).round() as i32;
        geometry.width >= (logical_width as f64 * 0.92) as i32
            && geometry.height >= (logical_height as f64 * 0.92) as i32
    })
}

fn update_last_normal(window: &tauri::WebviewWindow) {
    let Some(geometry) = current_geometry(window) else { return };
    if geometry.width < 360 || geometry.height < 480 {
        return;
    }
    if is_screen_sized(window, &geometry) {
        return;
    }
    if let Ok(mut slot) = LAST_NORMAL.lock() {
        *slot = Some(geometry);
    }
}

fn last_normal() -> Option<WindowGeometry> {
    LAST_NORMAL.lock().ok().and_then(|slot| *slot)
}

fn read_saved_state(window: &tauri::WebviewWindow) -> Option<SavedState> {
    let path = window_size_file(&window.app_handle())?;
    let content = std::fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    let width = value.get("width").and_then(Value::as_i64).unwrap_or(0) as i32;
    let height = value.get("height").and_then(Value::as_i64).unwrap_or(0) as i32;
    let x = value.get("x").and_then(Value::as_i64).map(|v| v as i32);
    let y = value.get("y").and_then(Value::as_i64).map(|v| v as i32);
    let maximized = value.get("maximized").and_then(Value::as_bool).unwrap_or(false);
    let (x, y, has_position) = match (x, y) {
        (Some(x), Some(y)) => (x, y, true),
        _ => (0, 0, false),
    };
    let state = SavedState {
        geometry: WindowGeometry { x, y, width, height },
        has_position,
        maximized,
    };
    state.valid().then_some(state)
}

fn write_saved_state(window: &tauri::WebviewWindow, state: SavedState) {
    let Some(path) = window_size_file(&window.app_handle()) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let geometry = state.geometry;
    let mut body = json!({
        "version": 1,
        "width": geometry.width,
        "height": geometry.height,
        "maximized": state.maximized,
    });
    if state.has_position {
        body["x"] = json!(geometry.x);
        body["y"] = json!(geometry.y);
    }
    let _ = std::fs::write(path, body.to_string());
    window_log(&format!(
        "save {}x{} @ {},{} maximized={}",
        geometry.width, geometry.height, geometry.x, geometry.y, state.maximized
    ));
}

/// 保存窗口尺寸/位置。最大化时用最后一次非最大化几何，避免把屏幕尺寸存进去
fn save_window_size(window: &tauri::WebviewWindow, reason: &str) {
    if window.is_fullscreen().unwrap_or(false) {
        window_log(&format!("skip save ({reason}): fullscreen"));
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    if !maximized {
        update_last_normal(window);
    }
    let geometry = if maximized {
        // LAST_NORMAL 可能被最大化动画污染成屏幕尺寸，这里再过滤一次；
        // 实在没有可用值就沿用旧文件里的记录（宁可不更新，也不写屏幕尺寸）
        let candidate = last_normal()
            .filter(|geometry| !is_screen_sized(window, geometry))
            .or_else(|| {
                read_saved_state(window)
                    .map(|state| state.geometry)
                    .filter(|geometry| !is_screen_sized(window, geometry))
            });
        match candidate {
            Some(geometry) => geometry,
            None => {
                window_log("skip save: no valid normal geometry while maximized");
                return;
            }
        }
    } else {
        match current_geometry(window) {
            Some(geometry) => geometry,
            None => return,
        }
    };
    let state = SavedState { geometry, has_position: true, maximized };
    if !state.valid() {
        window_log(&format!("skip save ({reason}): invalid geometry"));
        return;
    }
    write_saved_state(window, state);
}

static LAST_SAVE_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 拖动 / 缩放过程中顺带存一下，最多每 700ms 写一次盘
fn save_window_size_throttled(window: &tauri::WebviewWindow) {
    if window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let now = now_ms();
    let last = LAST_SAVE_MS.load(std::sync::atomic::Ordering::Relaxed);
    if now.saturating_sub(last) < 700 {
        return;
    }
    LAST_SAVE_MS.store(now, std::sync::atomic::Ordering::Relaxed);
    save_window_size(window, "resize/move");
}

/// 位置是否还落在某块显示器上（至少露出 120×80，避免整窗跑到屏幕外）
fn position_is_visible(window: &tauri::WebviewWindow, x: i32, y: i32, w: i32, h: i32) -> bool {
    let Ok(monitors) = window.available_monitors() else { return false };
    monitors.iter().any(|monitor| {
        let pos = monitor.position();
        let size = monitor.size();
        let monitor_right = pos.x + size.width as i32;
        let monitor_bottom = pos.y + size.height as i32;
        x + w > pos.x + 120 && x < monitor_right - 120 && y + h > pos.y + 40 && y < monitor_bottom - 40
    })
}

/// 把「客户区最小尺寸」换算成窗口最小尺寸后设置。
/// 直接用 tauri.conf 的 minWidth 会被 Windows 当成外框尺寸，
/// 无边框窗口还带 ~14px 的隐形边框，导致实际 innerWidth 比 360 小。
fn apply_min_inner_size(window: &tauri::WebviewWindow, min_width: f64, min_height: f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let (Ok(outer), Ok(inner)) = (window.outer_size(), window.inner_size()) else { return };
    let border_width = outer.width.saturating_sub(inner.width) as f64 / scale;
    let border_height = outer.height.saturating_sub(inner.height) as f64 / scale;
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(
        min_width + border_width,
        min_height + border_height,
    )));
    window_log(&format!(
        "min inner size {}x{} (border {}x{})",
        min_width, min_height, border_width, border_height
    ));
}

/// 按上次保存的尺寸和位置恢复；数值不合理就当作没有记录
fn restore_window_size(window: &tauri::WebviewWindow) {
    let Some(state) = read_saved_state(window) else {
        window_log("restore: no valid saved state");
        return;
    };
    let geometry = state.geometry;
    let _ = window.set_size(tauri::LogicalSize::new(geometry.width as f64, geometry.height as f64));

    if state.has_position {
        let scale = window.scale_factor().unwrap_or(1.0);
        let physical_x = (geometry.x as f64 * scale).round() as i32;
        let physical_y = (geometry.y as f64 * scale).round() as i32;
        let physical_w = (geometry.width as f64 * scale).round() as i32;
        let physical_h = (geometry.height as f64 * scale).round() as i32;
        if position_is_visible(window, physical_x, physical_y, physical_w, physical_h) {
            let _ = window.set_position(tauri::LogicalPosition::new(geometry.x as f64, geometry.y as f64));
        } else {
            window_log(&format!(
                "restore: position {physical_x},{physical_y} off-screen, keep default"
            ));
        }
    }

    if let Ok(mut slot) = LAST_NORMAL.lock() {
        *slot = Some(geometry);
    }
    STARTUP_MAXIMIZED.store(state.maximized, std::sync::atomic::Ordering::Relaxed);
    window_log(&format!(
        "restore {}x{} @ {},{} maximized={}",
        geometry.width, geometry.height, geometry.x, geometry.y, state.maximized
    ));
}

fn startup_maximized() -> bool {
    STARTUP_MAXIMIZED.load(std::sync::atomic::Ordering::Relaxed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {    // GUI 版没有控制台，把 panic 文本落盘，方便事后排查
    std::panic::set_hook(Box::new(|info| {
        let text = format!("{info}\n");
        let path = std::env::temp_dir().join("fish-translate-panic.log");
        let _ = std::fs::write(&path, &text);
        eprintln!("{text}");
    }));

    let app = tauri::Builder::default()
        // 全局只保留一个实例：再次双击时把已有窗口唤到前面，然后退出新进程
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            translate,
            models,
            balance,
            ocr,
            clipboard_read,
            clipboard_write,
            save_theme,
            app_ready
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // ① 先恢复上次的窗口尺寸/位置（必须在 show 之前，否则会看到跳变）
                restore_window_size(&window);
                // ①.5 客户区最小尺寸按 360×480 钉死（含隐形边框的补偿）
                apply_min_inner_size(&window, 360.0, 480.0);
                // ② 再按上次主题给窗口上底色
                let theme_id = startup_theme_id(&window);
                apply_window_theme_color(&window, &theme_id);
                // ③ 上次是最大化关闭的：在窗口仍隐藏时直接最大化，
                //    随后 show() 出来的第一帧就已经是最大化，不会看到动画
                if startup_maximized() {
                    let _ = window.maximize();
                    window_log("startup: maximize before show");
                }
                // ④ 最后显示：底色和几何都已就位，页面还有遮罩盖着
                let _ = window.show();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        match &event {
            tauri::RunEvent::WindowEvent { label, event, .. } if label == "main" => {
                let Some(window) = app_handle.get_webview_window("main") else { return };
                match event {
                    tauri::WindowEvent::CloseRequested { .. } => save_window_size(&window, "close"),
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                        save_window_size_throttled(&window)
                    }
                    _ => {}
                }
            }
            // 有些关闭路径不会触发 CloseRequested，退出前再存一次
            tauri::RunEvent::Exit => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    save_window_size(&window, "exit");
                }
            }
            _ => {}
        }
    });
}
