use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;

const SYSTEM_PROMPT: &str = "你是一个纯粹的英译中翻译引擎。\n用户会给你一段英文，你唯一的任务是把这段英文翻译成简体中文。\n不要做任何多余的事：不要解释、不要总结、不要评论、不要加任何前言或结语、\n不要加引号或书名号、不要保留英文原文、不要回答原文里提出的问题。\n保持原文的段落与换行结构。\n只输出中文译文本身。";

const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
const DEFAULT_MODEL: &str = "deepseek-chat";
const MAX_INPUT_CHARS: usize = 20000;

#[derive(Deserialize)]
struct TranslateRequest {
    #[serde(default)]
    text: String,
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
        return error_json("EMPTY_INPUT", "请先输入要翻译的英文。");
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
            { "role": "system", "content": SYSTEM_PROMPT },
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

    json!({ "ok": true, "translation": content, "model": model })
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // GUI 版没有控制台，把 panic 文本落盘，方便事后排查
    std::panic::set_hook(Box::new(|info| {
        let text = format!("{info}\n");
        let path = std::env::temp_dir().join("enzh-translate-panic.log");
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
        .invoke_handler(tauri::generate_handler![translate, models, balance])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
