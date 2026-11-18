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

/// 系统凭据库里的条目：服务名 / 账号名
const KEY_SERVICE: &str = "fish-translate";
const KEY_ACCOUNT: &str = "api-key";

/// 把 API Key 交给操作系统保管：Windows 走凭据管理器（DPAPI 加密），
/// 其它平台暂时保留前端保存的方式，这里只做「不支持」的占位。
#[cfg(windows)]
mod secrets {
    use super::{KEY_ACCOUNT, KEY_SERVICE};

    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEY_SERVICE, KEY_ACCOUNT)
            .map_err(|error| format!("无法访问系统凭据库：{error}"))
    }

    pub fn read() -> Option<String> {
        let entry = entry().ok()?;
        entry.get_password().ok()
    }

    pub fn write(key: &str) -> Result<(), String> {
        entry()?.set_password(key).map_err(|error| format!("写入系统凭据库失败：{error}"))
    }

    pub fn delete() -> Result<(), String> {
        let entry = entry()?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            // 条目本来就不存在，按成功处理
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("删除系统凭据库条目失败：{error}")),
        }
    }
}

#[cfg(not(windows))]
mod secrets {
    pub fn read() -> Option<String> {
        None
    }

    pub fn write(_key: &str) -> Result<(), String> {
        Err("当前平台尚未接入系统凭据库".to_string())
    }

    pub fn delete() -> Result<(), String> {
        Ok(())
    }
}

/// Key 的尾部 4 位，用于界面上「已配置 sk-…3f2a」的展示
fn key_preview(key: &str) -> String {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let tail: String = {
        let chars: Vec<char> = trimmed.chars().collect();
        let start = chars.len().saturating_sub(4);
        chars[start..].iter().collect()
    };
    format!("sk-…{tail}")
}

/// 取用 API Key：请求里带了就直接用（非 Windows 的现状），
/// 否则读系统凭据库；都没有就返回 NO_KEY。
fn resolve_api_key(provided: &str) -> Result<String, Value> {
    let trimmed = provided.trim();
    if !trimmed.is_empty() {
        return Ok(trimmed.to_string());
    }
    match secrets::read() {
        Some(key) if !key.trim().is_empty() => Ok(key),
        _ => Err(error_json("NO_KEY", "请先在「设置」里填写 API Key。")),
    }
}

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

    let api_key = match resolve_api_key(&request.api_key) {
        Ok(key) => key,
        Err(payload) => return payload,
    };

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
        .bearer_auth(&api_key)
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
async fn models(request: ModelsRequest) -> Value {    let api_key = match resolve_api_key(&request.api_key) {
        Ok(key) => key,
        Err(payload) => return payload,
    };
    let url = format!("{}/models", resolve_base_url(&request.base_url));

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(error) => return error_json("INTERNAL", error.to_string()),
    };

    let response = match client.get(&url).bearer_auth(&api_key).send().await {
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
    let api_key = match resolve_api_key(&request.api_key) {
        Ok(key) => key,
        Err(payload) => return payload,
    };
    let url = format!("{}/user/balance", resolve_base_url(&request.base_url));

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(error) => return error_json("INTERNAL", error.to_string()),
    };

    let response = match client.get(&url).bearer_auth(&api_key).send().await {
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

    let api_key = match resolve_api_key(&request.api_key) {
        Ok(key) => key,
        Err(payload) => return payload,
    };

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
        .bearer_auth(&api_key)
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
struct SaveKeyRequest {
    #[serde(default)]
    key: String,
}

/// 保存 API Key 到系统凭据库，只回传尾部 4 位给界面
#[tauri::command]
async fn save_key(request: SaveKeyRequest) -> Value {
    let key = request.key.trim().to_string();
    if key.is_empty() {
        return error_json("EMPTY_KEY", "API Key 不能为空。");
    }
    match secrets::write(&key) {
        Ok(()) => json!({ "ok": true, "configured": true, "preview": key_preview(&key) }),
        Err(message) => error_json("KEYSTORE", message),
    }
}

/// 查询是否已配置 Key（不返回明文）
#[tauri::command]
async fn key_status() -> Value {
    // 目前只有 Windows 接入了系统凭据库
    let supported = cfg!(windows);
    let stored = if supported { secrets::read() } else { None };
    match stored {
        Some(key) if !key.trim().is_empty() => json!({
            "ok": true,
            "supported": supported,
            "configured": true,
            "preview": key_preview(&key)
        }),
        _ => json!({
            "ok": true,
            "supported": supported,
            "configured": false,
            "preview": ""
        }),
    }
}

/// 从系统凭据库删除 Key
#[tauri::command]
async fn clear_key() -> Value {
    match secrets::delete() {
        Ok(()) => json!({ "ok": true, "configured": false }),
        Err(message) => error_json("KEYSTORE", message),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {    // GUI 版没有控制台，把 panic 文本落盘，方便事后排查
    std::panic::set_hook(Box::new(|info| {
        let text = format!("{info}\n");
        let path = std::env::temp_dir().join("fish-translate-panic.log");
        let _ = std::fs::write(&path, &text);
        eprintln!("{text}");
    }));

    tauri::Builder::default()
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
            save_key,
            key_status,
            clear_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_preview_keeps_tail() {
        assert_eq!(key_preview("sk-1234567890abc"), "sk-…0abc");
        assert_eq!(key_preview(""), "");
    }

    #[cfg(windows)]
    #[test]
    fn credential_roundtrip() {
        let key = "sk-test-roundtrip-9876";
        secrets::write(key).expect("写入失败");
        assert_eq!(secrets::read().as_deref(), Some(key));
        secrets::delete().expect("删除失败");
        assert!(secrets::read().is_none());
    }
}
