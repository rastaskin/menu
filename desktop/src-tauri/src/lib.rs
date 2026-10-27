// Вся логика в web/app.js. Rust поднимает окно, плагины, одноразовый сервер для входа в Google
// и держит токен Google: refresh token лежит в диспетчере учётных данных Windows и в окно не попадает,
// окно получает только access token на час.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tauri_plugin_http::reqwest;

const KEYRING_SERVICE: &str = "app.menu.desktop";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Меню</title>\
<body style=\"font:16px system-ui;padding:40px\">Вход выполнен. Окно браузера можно закрыть и вернуться в приложение.</body>";

/// Слушает 127.0.0.1 (порт 0 — любой свободный, для Desktop-клиента Google), ждёт один редирект
/// с ?code=…&state=… и отдаёт его путь в окно событием oauth-redirect. Через 5 минут сдаётся.
#[tauri::command]
fn oauth_listen(app: tauri::AppHandle, port: Option<u16>) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", port.unwrap_or(0))).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(300);
        while Instant::now() < deadline {
            let (mut stream, _) = match listener.accept() {
                Ok(c) => c,
                Err(_) => {
                    std::thread::sleep(Duration::from_millis(100));
                    continue;
                }
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let path = req
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("")
                .to_string();
            if !(path.starts_with("/?") && (path.contains("code=") || path.contains("error="))) {
                let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                DONE_PAGE.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(DONE_PAGE.as_bytes());
            let _ = app.emit("oauth-redirect", path);
            break;
        }
    });
    Ok(port)
}

/* ---------- токен Google ---------- */
fn refresh_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, "google_refresh").map_err(|e| e.to_string())
}
fn refresh_get(app: &tauri::AppHandle) -> Option<String> {
    if let Ok(v) = refresh_entry().and_then(|e| e.get_password().map_err(|e| e.to_string())) {
        return Some(v);
    }
    // перенос из secrets.json версии 0.1.x: токен уходит в диспетчер учётных данных, файл удаляется
    let path = app.path().app_config_dir().ok()?.join("secrets.json");
    let old: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).ok()?).ok()?;
    let v = old.get("google_refresh")?.as_str()?.to_string();
    if refresh_entry().and_then(|e| e.set_password(&v).map_err(|e| e.to_string())).is_ok() {
        let _ = std::fs::remove_file(&path);
    }
    Some(v)
}
fn refresh_set(v: &str) -> Result<(), String> {
    refresh_entry()?.set_password(v).map_err(|e| e.to_string())
}
fn refresh_clear(app: &tauri::AppHandle) {
    if let Ok(e) = refresh_entry() {
        let _ = e.delete_credential();
    }
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = std::fs::remove_file(dir.join("secrets.json"));
    }
}

async fn token_request(pairs: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let body = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs.iter()).finish();
    let res = reqwest::Client::new()
        .post(TOKEN_URL)
        .header("content-type", "application/x-www-form-urlencoded")
        .timeout(Duration::from_secs(30))
        .body(body)
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;
    let status = res.status().as_u16();
    let json: serde_json::Value = serde_json::from_str(&res.text().await.map_err(|e| format!("network: {e}"))?)
        .map_err(|_| format!("http {status}"))?;
    if status >= 400 {
        return Err(json["error"].as_str().unwrap_or("error").to_string());
    }
    Ok(json)
}
/// Окну отдаём только access token и срок, refresh token остаётся здесь.
fn access_only(j: &serde_json::Value) -> Result<serde_json::Value, String> {
    let t = j["access_token"].as_str().ok_or("no access_token")?;
    Ok(serde_json::json!({ "access_token": t, "expires_in": j["expires_in"].as_u64().unwrap_or(3600) }))
}

#[tauri::command]
async fn google_exchange(client_id: String, client_secret: String, code: String, verifier: String, redirect: String) -> Result<serde_json::Value, String> {
    let j = token_request(&[
        ("grant_type", "authorization_code"), ("client_id", &client_id), ("client_secret", &client_secret),
        ("code", &code), ("code_verifier", &verifier), ("redirect_uri", &redirect),
    ]).await?;
    if let Some(rt) = j["refresh_token"].as_str() {
        refresh_set(rt)?;
    }
    access_only(&j)
}

#[tauri::command]
async fn google_refresh(app: tauri::AppHandle, client_id: String, client_secret: String) -> Result<serde_json::Value, String> {
    let rt = refresh_get(&app).ok_or("no_refresh")?;
    match token_request(&[("grant_type", "refresh_token"), ("client_id", &client_id), ("client_secret", &client_secret), ("refresh_token", &rt)]).await {
        Ok(j) => access_only(&j),
        Err(e) => {
            if e == "invalid_grant" {
                refresh_clear(&app);
            }
            Err(e)
        }
    }
}

#[tauri::command]
fn google_signed_in(app: tauri::AppHandle) -> bool {
    refresh_get(&app).is_some()
}

#[tauri::command]
fn google_logout(app: tauri::AppHandle) {
    refresh_clear(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // одна копия: повторный запуск (ярлык, «Пуск», панель задач) показывает уже открытое окно
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![oauth_listen, google_exchange, google_refresh, google_signed_in, google_logout])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}
