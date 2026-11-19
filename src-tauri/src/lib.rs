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
    // 显示前后各应用一次：WebView2 首帧时可能把窗口尺寸改回配置里的默认值
    restore_window_size(&window);
    let _ = window.show();
    restore_window_size(&window);
    let _ = window.set_focus();
    json!({ "ok": true })
}

/// 窗口尺寸的保存位置：应用配置目录下的 window-size.json
fn window_size_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("window-size.json"))
}

/// 关闭窗口前把当前逻辑尺寸和位置写盘；最大化 / 全屏时保留上一次的值
fn save_window_size(window: &tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let Ok(size) = window.inner_size() else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = (size.width as f64 / scale).round() as i64;
    let height = (size.height as f64 / scale).round() as i64;
    if width < 360 || height < 480 {
        return;
    }
    let position = window.outer_position().ok().map(|pos| {
        (
            (pos.x as f64 / scale).round() as i64,
            (pos.y as f64 / scale).round() as i64,
        )
    });
    let Some(path) = window_size_file(&window.app_handle()) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let body = match position {
        Some((x, y)) => json!({ "x": x, "y": y, "width": width, "height": height }),
        None => json!({ "width": width, "height": height }),
    };
    let _ = std::fs::write(path, body.to_string());
}

static LAST_SAVE_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// 拖动 / 缩放过程中顺带存一下，最多每 700ms 写一次盘
fn save_window_size_throttled(window: &tauri::WebviewWindow) {
    let now = now_ms();
    let last = LAST_SAVE_MS.load(std::sync::atomic::Ordering::Relaxed);
    if now.saturating_sub(last) < 700 {
        return;
    }
    LAST_SAVE_MS.store(now, std::sync::atomic::Ordering::Relaxed);
    save_window_size(window);
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

/// 按上次保存的尺寸和位置恢复；数值不合理就当作没有记录
fn restore_window_size(window: &tauri::WebviewWindow) {
    let Some(path) = window_size_file(&window.app_handle()) else { return };
    let Ok(content) = std::fs::read_to_string(path) else { return };
    let Ok(value) = serde_json::from_str::<Value>(&content) else { return };
    let width = value.get("width").and_then(Value::as_f64).unwrap_or(0.0);
    let height = value.get("height").and_then(Value::as_f64).unwrap_or(0.0);
    if !(360.0..=7680.0).contains(&width) || !(480.0..=4320.0).contains(&height) {
        return;
    }
    let _ = window.set_size(tauri::LogicalSize::new(width, height));

    let (Some(x), Some(y)) = (
        value.get("x").and_then(Value::as_f64),
        value.get("y").and_then(Value::as_f64),
    ) else {
        return;
    };
    if !(-32768.0..=32768.0).contains(&x) || !(-32768.0..=32768.0).contains(&y) {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let physical_x = (x * scale).round() as i32;
    let physical_y = (y * scale).round() as i32;
    let physical_w = (width * scale).round() as i32;
    let physical_h = (height * scale).round() as i32;
    if !position_is_visible(&window, physical_x, physical_y, physical_w, physical_h) {
        return;
    }
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
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
            app_ready
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                restore_window_size(&window);
            }
            // 兜底：前端万一没跑起来也别留一个看不见的进程
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::WindowEvent { label, event, .. } = &event {
            if label != "main" {
                return;
            }
            let Some(window) = app_handle.get_webview_window("main") else { return };
            match event {
                tauri::WindowEvent::CloseRequested { .. } => save_window_size(&window),
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    save_window_size_throttled(&window)
                }
                _ => {}
            }
        }
    });
}
