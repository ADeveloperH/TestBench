mod adb;

use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};

use adb::{
    app_alarm as adb_app_alarm, app_performance as adb_app_performance,
    clear_app_data as adb_clear_app_data, clear_log as adb_clear_log,
    connect as adb_connect, current_activity as adb_current_activity,
    device_info as adb_device_info, disconnect as adb_disconnect,
    fetch_remote_apps as adb_fetch_remote_apps, generate_pairing as adb_generate_pairing,
    install_apk as adb_install_apk, list_app_runtime_status as adb_list_app_runtime_status,
    list_devices as adb_list_devices,
    mdns_connect_address as adb_mdns_connect_address,
    mdns_pairing_address as adb_mdns_pairing_address, mirror as adb_mirror,
    open_backdoor as adb_open_backdoor, pair as adb_pair, resolve_pids as adb_resolve_pids,
    restart_app as adb_restart_app, screencap_png as adb_screencap_png,
    uninstall_app as adb_uninstall_app, App, AppRuntimeStatus, Device, DeviceInfo,
    BugreportController, BugreportProgress, BugreportResult, LogcatProcess, PairingInfo,
    ScrcpyRecord,
};

/// 全局运行状态：当前 logcat 进程 + 代号（用于识别过期读取线程）。
struct RunningLogcat {
    child: Mutex<Option<LogcatProcess>>,
    generation: Arc<AtomicU64>,
}

/// 当前录屏会话（scrcpy 子进程 + 输出路径）。
struct RecordingSession {
    child: ScrcpyRecord,
    path: String,
}

struct RecordingState {
    session: Mutex<Option<RecordingSession>>,
}

/// 当前 Bugreport 任务；用于防止重复导出，并在退出/更新前停止 adb 子进程。
struct BugreportState {
    controller: BugreportController,
}

#[tauri::command]
async fn list_devices() -> Result<Vec<Device>, String> {
    log::debug!("收到前端命令 list_devices");
    run_blocking(adb_list_devices).await
}

/// 阻塞式 ADB/文件系统任务必须与 Tauri 异步运行时隔离。
/// Windows 上 adb 偶发变慢时，否则会占住更新检查和其他 invoke 使用的工作线程。
async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| format!("后台任务执行失败：{e}"))?
}

#[tauri::command]
fn start_logcat(
    app: AppHandle,
    state: State<'_, RunningLogcat>,
    device: Option<String>,
    buffer: Option<String>,
) -> Result<(), String> {
    log::info!("收到前端命令 start_logcat：device={:?} buffer={:?}", device, buffer);

    // 递增代号，让旧的读取线程停止发送事件。
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    log::debug!("本次抓取代号 generation={generation}");

    // 停止旧进程。
    if let Some(mut proc) = state.child.lock().unwrap().take() {
        log::debug!("发现旧 logcat 进程，先停止");
        proc.stop();
    }

    let mut proc = LogcatProcess::start(device.as_deref(), buffer.as_deref())?;
    let stdout = proc.take_stdout().ok_or("无法读取 logcat 输出")?;
    let stderr = proc.take_stderr();
    *state.child.lock().unwrap() = Some(proc);

    // stdout 读取线程：逐行读取并推给前端。
    let app_for_thread = app.clone();
    let generation_ref = state.generation.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf: Vec<u8> = Vec::new();
        let mut count: u64 = 0;
        loop {
            if generation_ref.load(Ordering::SeqCst) != generation {
                break;
            }
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break, // EOF
                Ok(_) => {
                    // 去掉行尾的 \n 与 \r（避免 Windows 风格换行残留）
                    while matches!(buf.last(), Some(b'\n') | Some(b'\r')) {
                        buf.pop();
                    }
                    // lossy 转换：无效 UTF-8 字节替换为 �，避免中断整条读取线程
                    let text = String::from_utf8_lossy(&buf).into_owned();
                    // adb 在设备未就绪时输出等待提示：不进日志流，转为状态事件
                    if text.contains("waiting for device") {
                        let _ = app_for_thread.emit("logcat-waiting", ());
                        continue;
                    }
                    count += 1;
                    let _ = app_for_thread.emit("logcat-line", text);
                }
                Err(_) => break,
            }
        }
        log::debug!("logcat 读取线程结束，共读取 {count} 行，generation={generation}");
        if generation_ref.load(Ordering::SeqCst) == generation {
            let _ = app_for_thread.emit("logcat-stopped", ());
        }
    });

    // stderr 读取线程：捕获 adb logcat 的报错，不再静默丢弃。
    if let Some(stderr) = stderr {
        let app_for_err = app.clone();
        let gen_for_err = state.generation.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buf: Vec<u8> = Vec::new();
            loop {
                if gen_for_err.load(Ordering::SeqCst) != generation {
                    break;
                }
                buf.clear();
                match reader.read_until(b'\n', &mut buf) {
                    Ok(0) => break,
                    Ok(_) => {
                        while matches!(buf.last(), Some(b'\n') | Some(b'\r')) {
                            buf.pop();
                        }
                        let text = String::from_utf8_lossy(&buf).into_owned();
                        if text.contains("waiting for device") {
                            let _ = app_for_err.emit("logcat-waiting", ());
                            continue;
                        }
                        log::warn!("logcat stderr：{text}");
                        let _ = app_for_err.emit("logcat-error", text);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    log::info!("logcat 已启动，开始流式推送日志");
    let _ = app.emit("logcat-started", ());
    Ok(())
}

#[tauri::command]
fn stop_logcat(state: State<'_, RunningLogcat>) -> Result<(), String> {
    log::info!("收到前端命令 stop_logcat");
    state.generation.fetch_add(1, Ordering::SeqCst);
    if let Some(mut proc) = state.child.lock().unwrap().take() {
        proc.stop();
    }
    Ok(())
}

#[tauri::command]
async fn clear_log(device: Option<String>) -> Result<(), String> {
    log::info!("收到前端命令 clear_log：device={:?}", device);
    adb_clear_log(device.as_deref())
}

#[tauri::command]
async fn pair_device(ip: String, port: String, code: String) -> Result<String, String> {
    log::info!("收到前端命令 pair_device：ip={ip} port={port}");
    adb_pair(&ip, &port, &code)
}

#[tauri::command]
async fn connect_device(ip: String, port: String) -> Result<String, String> {
    log::info!("收到前端命令 connect_device：ip={ip} port={port}");
    adb_connect(&ip, &port)
}

#[tauri::command]
async fn disconnect_device(target: String) -> Result<String, String> {
    log::info!("收到前端命令 disconnect_device：target={target}");
    adb_disconnect(&target)
}

#[tauri::command]
fn generate_pairing() -> PairingInfo {
    log::debug!("收到前端命令 generate_pairing");
    adb_generate_pairing()
}

#[tauri::command]
async fn mdns_pairing_address() -> Result<Option<String>, String> {
    log::debug!("收到前端命令 mdns_pairing_address");
    adb_mdns_pairing_address()
}

#[tauri::command]
async fn mdns_connect_address() -> Result<Option<String>, String> {
    log::debug!("收到前端命令 mdns_connect_address");
    adb_mdns_connect_address()
}

#[tauri::command]
async fn resolve_pids(device: Option<String>, package: String) -> Result<Vec<String>, String> {
    log::debug!("收到前端命令 resolve_pids：device={:?} package={package}", device);
    run_blocking(move || adb_resolve_pids(device.as_deref(), &package)).await
}

#[tauri::command]
async fn app_runtime_status(device: Option<String>) -> Result<AppRuntimeStatus, String> {
    log::debug!("收到前端命令 app_runtime_status：device={:?}", device);
    run_blocking(move || adb_list_app_runtime_status(device.as_deref())).await
}

#[tauri::command]
async fn fetch_remote_apps(url: String) -> Result<Vec<App>, String> {
    log::info!("收到前端命令 fetch_remote_apps：url={url}");
    adb_fetch_remote_apps(&url)
}

/// 用系统默认浏览器打开 URL。
#[tauri::command]
fn open_in_browser(url: String) -> Result<(), String> {
    log::info!("打开浏览器：{url}");
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", url.as_str()])
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = std::process::Command::new("xdg-open").arg(&url).status();
    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("打开浏览器失败（退出码 {status}）")),
        Err(e) => Err(format!("无法启动浏览器：{e}")),
    }
}

/// 校验发布凭据对本仓库的权限（调试版「测试凭据」按钮用）。
#[tauri::command]
fn verify_publish_token(token: String) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("缺少 GitHub Token，请先粘贴".into());
    }
    let (auth, accept, ua) = github_headers(token);
    let resp = ureq::get("https://api.github.com/repos/ADeveloperH/TestBench")
        .set("Authorization", &auth)
        .set("Accept", &accept)
        .set("User-Agent", &ua)
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "Token 无效或已过期，请重新生成".to_string(),
            ureq::Error::Status(403, _) => {
                "Token 无法访问该仓库：请检查 token 的 Repository access 是否选为「Only select repositories」并勾选 ADeveloperH/TestBench（不能选 Public read-only），或确认 token 是用对仓库有写权限的账号创建的".to_string()
            }
            ureq::Error::Status(404, _) => "仓库不存在".to_string(),
            e => format!("请求失败：{e}"),
        })?;
    let v: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("解析响应失败：{e}"))?;
    let push = v["permissions"]["push"].as_bool().unwrap_or(false);
    if push {
        Ok("凭据有效：对本仓库有写权限，可以发布".into())
    } else {
        Err("凭据有效但只有读权限：请在 token 的 Repository permissions 里把 Contents 设为 Read and write".into())
    }
}

/// 远程配置文件在仓库中的路径（Contents API 使用）。
const REMOTE_CONFIG_API_URL: &str =
    "https://api.github.com/repos/ADeveloperH/TestBench/contents/config/remote-config.json";

fn github_headers(token: &str) -> (String, String, String) {
    (
        format!("Bearer {token}"),
        "application/vnd.github+json".to_string(),
        "TestBench-Publisher".to_string(),
    )
}

/// 用维护者的 fine-grained PAT 把远程配置提交到仓库（Contents API）。
/// 仅调试模式前端页面会调用；权限由 GitHub 对 token 的授权范围控制。
#[tauri::command]
fn publish_remote_config(token: String, content: String) -> Result<String, String> {
    let content = content.trim();
    // 提交前先校验是合法 JSON，避免把坏配置写进仓库
    serde_json::from_str::<serde_json::Value>(content)
        .map_err(|e| format!("配置不是合法 JSON：{e}"))?;
    let token = token.trim();
    if token.is_empty() {
        return Err("缺少 GitHub Token，请先在发布页粘贴 fine-grained PAT".into());
    }
    let (auth, accept, ua) = github_headers(token);
    log::info!("发布远程配置：获取当前文件 sha");

    // 1. 取当前文件 sha（文件不存在则视为新建）
    let sha: Option<String> = match ureq::get(REMOTE_CONFIG_API_URL)
        .set("Authorization", &auth)
        .set("Accept", &accept)
        .set("User-Agent", &ua)
        .timeout(std::time::Duration::from_secs(15))
        .call()
    {
        Ok(resp) => {
            let v: serde_json::Value = resp
                .into_json()
                .map_err(|e| format!("解析 GitHub 响应失败：{e}"))?;
            v["sha"].as_str().map(|s| s.to_string())
        }
        Err(ureq::Error::Status(404, _)) => None,
        Err(ureq::Error::Status(code, _)) => {
            return Err(match code {
                401 => "Token 无效或已过期，请重新生成并粘贴".into(),
                403 => "Token 没有该仓库的访问权限（需要选中 ADeveloperH/TestBench 并授予 Contents 读写）".into(),
                _ => format!("GitHub 返回错误（HTTP {code}）"),
            });
        }
        Err(e) => return Err(format!("请求失败：{e}")),
    };

    // 2. 提交（base64 编码内容；已有文件需带 sha）
    let encoded = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        content.as_bytes(),
    );
    let mut payload = serde_json::json!({
        "message": "chore: TestBench 调试版发布内置配置",
        "content": encoded,
        "branch": "main",
    });
    if let Some(s) = &sha {
        payload["sha"] = serde_json::json!(s);
    }
    log::info!("发布远程配置：提交新内容");
    let resp = ureq::put(REMOTE_CONFIG_API_URL)
        .set("Authorization", &auth)
        .set("Accept", &accept)
        .set("User-Agent", &ua)
        .timeout(std::time::Duration::from_secs(30))
        .send_json(payload)
        .map_err(|e| match e {
            ureq::Error::Status(code, resp) => {
                let detail = resp
                    .into_string()
                    .ok()
                    .and_then(|s| {
                        serde_json::from_str::<serde_json::Value>(&s)
                            .ok()
                            .and_then(|v| {
                                v["message"].as_str().map(|m| m.to_string())
                            })
                    })
                    .unwrap_or_default();
                match code {
                    401 => "Token 无效或已过期，请重新生成并粘贴".to_string(),
                    403 => format!("没有提交权限：{detail}"),
                    409 => "文件在远端已被修改，请刷新后重试".to_string(),
                    422 => format!("GitHub 拒绝提交：{detail}"),
                    _ => format!("GitHub 返回错误（HTTP {code}）：{detail}"),
                }
            }
            e => format!("提交失败：{e}"),
        })?;

    // 3. 返回提交链接
    let v: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("解析提交结果失败：{e}"))?;
    let commit_url = v["commit"]["html_url"]
        .as_str()
        .unwrap_or("https://github.com/ADeveloperH/TestBench/commits/main")
        .to_string();
    let commit_sha = v["commit"]["sha"]
        .as_str()
        .map(|s| s[..7.min(s.len())].to_string())
        .unwrap_or_default();
    log::info!("远程配置已发布：{commit_sha}");
    Ok(commit_url)
}

#[tauri::command]
async fn open_backdoor(
    device: Option<String>,
    package: String,
    activity: String,
) -> Result<String, String> {
    log::info!("收到前端命令 open_backdoor：package={package} activity={activity}");
    adb_open_backdoor(device.as_deref(), &package, &activity)
}

#[tauri::command]
async fn restart_app(device: Option<String>, package: String) -> Result<(), String> {
    log::info!("收到前端命令 restart_app：package={package}");
    adb_restart_app(device.as_deref(), &package)
}

#[tauri::command]
async fn screenshot(app: AppHandle, device: Option<String>) -> Result<Option<String>, String> {
    log::info!("收到前端命令 screenshot：device={:?}", device);
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let name = format!("screenshot_{ts}.png");
    let picked = save_file_dialog(&app, &name, "图片", &["png"])?;
    let Some(path) = picked else {
        return Ok(None);
    };
    let bytes = adb_screencap_png(device.as_deref())?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入截图失败：{e}"))?;
    log::info!("截图已保存到：{}", path.display());
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
async fn pick_apk(app: AppHandle) -> Result<Option<String>, String> {
    log::debug!("收到前端命令 pick_apk");
    let picked = pick_file_dialog(&app, "APK 安装包", &["apk"])?;
    match picked {
        Some(p) => Ok(Some(p.display().to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
async fn install_apk(device: Option<String>, path: String) -> Result<String, String> {
    log::info!("收到前端命令 install_apk：path={path}");
    adb_install_apk(device.as_deref(), &path)
}

#[tauri::command]
async fn clear_app_data(device: Option<String>, package: String) -> Result<String, String> {
    log::info!("收到前端命令 clear_app_data：package={package}");
    adb_clear_app_data(device.as_deref(), &package)
}

#[tauri::command]
async fn uninstall_app(device: Option<String>, package: String) -> Result<String, String> {
    log::info!("收到前端命令 uninstall_app：package={package}");
    adb_uninstall_app(device.as_deref(), &package)
}

#[tauri::command]
async fn device_info(device: Option<String>) -> Result<DeviceInfo, String> {
    log::info!("收到前端命令 device_info：device={:?}", device);
    adb_device_info(device.as_deref())
}

#[tauri::command]
async fn current_activity(device: Option<String>) -> Result<String, String> {
    log::info!("收到前端命令 current_activity：device={:?}", device);
    adb_current_activity(device.as_deref())
}

#[tauri::command]
async fn start_recording(
    app: AppHandle,
    state: State<'_, RecordingState>,
    device: Option<String>,
    mbps: u32,
) -> Result<Option<String>, String> {
    log::info!("收到前端命令 start_recording：device={:?} mbps={mbps}", device);
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let name = format!("recording_{ts}.mp4");
    let picked = save_file_dialog(&app, &name, "视频", &["mp4"])?;
    let Some(path) = picked else {
        return Ok(None);
    };
    let p = path.display().to_string();

    if let Some(mut old) = state.session.lock().unwrap().take() {
        old.child.stop();
    }
    let child = ScrcpyRecord::start(device.as_deref(), &p, mbps)?;
    *state.session.lock().unwrap() = Some(RecordingSession { child, path: p.clone() });
    Ok(Some(p))
}

#[tauri::command]
async fn stop_recording(state: State<'_, RecordingState>) -> Result<Option<String>, String> {
    log::info!("收到前端命令 stop_recording");
    let Some(mut session) = state.session.lock().unwrap().take() else {
        return Err("当前未在录制".to_string());
    };
    session.child.stop();
    Ok(Some(session.path))
}

#[tauri::command]
async fn mirror(device: Option<String>, mbps: u32) -> Result<(), String> {
    log::info!("收到前端命令 mirror：device={:?} mbps={mbps}", device);
    adb_mirror(device.as_deref(), mbps)
}

#[tauri::command]
async fn export_bugreport(
    app: AppHandle,
    state: State<'_, BugreportState>,
    recording_state: State<'_, RecordingState>,
    device: Option<String>,
) -> Result<Option<BugreportResult>, String> {
    log::info!("收到前端命令 export_bugreport：device={:?}", device);
    if state.controller.is_running() {
        return Err("已有故障报告正在生成，请稍候".to_string());
    }
    if recording_state.session.lock().unwrap().is_some() {
        return Err("请先停止录屏，再导出故障报告".to_string());
    }

    let serial = device.as_deref().unwrap_or("device");
    let safe_serial: String = serial
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let file_name = format!("TestBench-Bugreport-{safe_serial}-{ts}.zip");
    let Some(mut output_path) =
        save_file_dialog(&app, &file_name, "Bugreport 压缩包", &["zip"])?
    else {
        return Ok(None);
    };
    let has_zip_extension = output_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("zip"))
        .unwrap_or(false);
    if !has_zip_extension {
        output_path.set_extension("zip");
    }

    let controller = state.controller.clone();
    let app_for_progress = app.clone();
    let selected_device = device.clone();
    let result = run_blocking(move || {
        controller.generate(
            selected_device.as_deref(),
            &output_path,
            move |progress: BugreportProgress| {
                if let Err(error) = app_for_progress.emit("bugreport-progress", progress) {
                    log::debug!("发送 Bugreport 进度失败：{error}");
                }
            },
        )
    })
    .await?;
    Ok(Some(result))
}

/// 更新安装前清理子进程。
/// Windows 上 App 更新时 updater 会直接 exit 并运行安装器，若不杀掉 adb/scrcpy
/// 子进程，它们会以孤儿进程继续运行并锁住 AdbWinApi.dll / scrcpy 文件，
/// 导致安装器「Error opening file for writing」。
#[tauri::command]
async fn cleanup_for_update(
    logcat_state: State<'_, RunningLogcat>,
    recording_state: State<'_, RecordingState>,
    bugreport_state: State<'_, BugreportState>,
) -> Result<(), String> {
    log::info!("收到前端命令 cleanup_for_update：停止子进程以准备更新");

    // 1. 停止 logcat（adb）
    logcat_state.generation.fetch_add(1, Ordering::SeqCst);
    if let Some(mut proc) = logcat_state.child.lock().unwrap().take() {
        proc.stop();
    }

    // 2. 停止录屏（scrcpy）
    if let Some(mut session) = recording_state.session.lock().unwrap().take() {
        session.child.stop();
    }

    // 3. 停止 Bugreport（adb）
    bugreport_state.controller.stop();

    // 4. Windows：兜底杀掉可能残留的 adb.exe / scrcpy.exe 孤儿进程
    #[cfg(target_os = "windows")]
    {
        for exe in ["adb.exe", "scrcpy.exe"] {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", exe, "/T"])
                .output();
        }
    }

    Ok(())
}

#[tauri::command]
async fn app_alarm(device: Option<String>, package: String) -> Result<String, String> {
    log::info!("收到前端命令 app_alarm：package={package}");
    adb_app_alarm(device.as_deref(), &package)
}

#[tauri::command]
async fn app_performance(device: Option<String>, package: String) -> Result<String, String> {
    log::info!("收到前端命令 app_performance：package={package}");
    adb_app_performance(device.as_deref(), &package)
}

#[tauri::command]
async fn export_logs(app: AppHandle, text: String) -> Result<Option<String>, String> {
    log::info!("收到前端命令 export_logs，日志长度 {} 字节", text.len());
    let picked = save_file_dialog(&app, "logcat.txt", "日志文件", &["txt", "log"])?;
    match picked {
        Some(p) => {
            std::fs::write(&p, text).map_err(|e| format!("写入文件失败：{e}"))?;
            log::info!("日志已导出到：{}", p.display());
            Ok(Some(p.display().to_string()))
        }
        None => {
            log::debug!("用户取消了导出");
            Ok(None)
        }
    }
}

#[tauri::command]
async fn export_config(app: AppHandle, text: String) -> Result<Option<String>, String> {
    log::info!("收到前端命令 export_config，配置长度 {} 字节", text.len());
    let picked = save_file_dialog(&app, "testbench-config.json", "配置文件", &["json"])?;
    match picked {
        Some(p) => {
            std::fs::write(&p, text).map_err(|e| format!("写入文件失败：{e}"))?;
            log::info!("配置已导出到：{}", p.display());
            Ok(Some(p.display().to_string()))
        }
        None => {
            log::debug!("用户取消了导出");
            Ok(None)
        }
    }
}

#[tauri::command]
async fn import_config(app: AppHandle) -> Result<Option<String>, String> {
    log::debug!("收到前端命令 import_config");
    let picked = pick_file_dialog(&app, "配置文件", &["json"])?;
    match picked {
        Some(p) => {
            let text = std::fs::read_to_string(&p).map_err(|e| format!("读取文件失败：{e}"))?;
            log::info!("读取到配置文件：{}（{} 字节）", p.display(), text.len());
            Ok(Some(text))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn export_debug_log(app: AppHandle) -> Result<Option<String>, String> {
    log::info!("收到前端命令 export_debug_log");

    let mut report = String::new();
    report.push_str("===== TestBench 调试报告 =====\n\n");

    // 版本与系统
    let version = app.package_info().version.to_string();
    report.push_str(&format!(
        "版本：{version}\n操作系统：{} {}\n",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));

    // Windows 屏幕 DPI（影响 scrcpy 点击坐标映射的常见因素）
    #[cfg(windows)]
    {
        let dpi = unsafe { windows_sys::Win32::UI::HiDpi::GetDpiForSystem() };
        report.push_str(&format!("屏幕 DPI：{dpi}（缩放 {}%）\n", dpi * 100 / 96));
    }

    // 设备列表由应用日志中的轮询记录提供。这里不再另外启动 adb，
    // 避免恰好在 adb 异常时连调试报告也无法导出。
    report.push_str("\n===== 设备列表 =====\n");
    report.push_str("（请查看下方应用日志中的最近设备轮询记录）\n");

    // 应用日志（tauri-plugin-log 写入的文件）
    report.push_str("\n===== 应用日志 =====\n");
    match app.path().app_log_dir() {
        Ok(log_dir) => {
            let log_file = log_dir.join("testbench.log");
            match std::fs::read_to_string(&log_file) {
                Ok(content) => report.push_str(&content),
                Err(e) => report.push_str(&format!("（读取日志文件失败：{e}）\n")),
            }
        }
        Err(e) => report.push_str(&format!("（获取日志目录失败：{e}）\n")),
    }

    // 保存对话框
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let picked = save_file_dialog(
        &app,
        &format!("testbench-debug-{ts}.txt"),
        "文本文件",
        &["txt"],
    )?;
    match picked {
        Some(p) => {
            std::fs::write(&p, report).map_err(|e| format!("写入文件失败：{e}"))?;
            log::info!("调试报告已导出到：{}", p.display());
            Ok(Some(p.display().to_string()))
        }
        None => {
            log::debug!("用户取消了导出");
            Ok(None)
        }
    }
}

/// 显示保存文件对话框。
/// Tauri 的命令运行在工作线程，直接使用 dialog 插件提供的 blocking API。
/// 该路径与插件自身的 JS `save` 命令一致，并已在旧版 Windows 包中验证可用。
fn save_file_dialog(
    app: &AppHandle,
    file_name: &str,
    filter_name: &str,
    extensions: &[&str],
) -> Result<Option<std::path::PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter(filter_name, extensions)
        .blocking_save_file();
    match picked {
        Some(path) => Ok(Some(path.into_path().map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

/// 显示打开文件对话框（与保存弹窗使用同一条 Windows 兼容路径）。
fn pick_file_dialog(
    app: &AppHandle,
    filter_name: &str,
    extensions: &[&str],
) -> Result<Option<std::path::PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .add_filter(filter_name, extensions)
        .blocking_pick_file();
    match picked {
        Some(path) => Ok(Some(path.into_path().map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

/// 显示并聚焦主窗口（托盘回调复用）。
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 构建系统托盘：左键/「显示」恢复窗口，「退出」弹确认并优雅收尾。
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show = MenuItem::with_id(app, "show", "显示测试工作台", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// 退出入口：录屏中先确认；确认后优雅停止录屏与 logcat 再退出。
fn quit_app(app: &tauri::AppHandle) {
    use tauri_plugin_dialog::DialogExt;

    let recording = {
        let state = app.state::<RecordingState>();
        let is_recording = state.session.lock().unwrap().is_some();
        is_recording
    };

    let bugreport_running = app.state::<BugreportState>().controller.is_running();

    if recording || bugreport_running {
        let message = match (recording, bugreport_running) {
            (true, true) => "正在录屏并生成故障报告，确定退出？退出会停止这些任务。",
            (true, false) => "正在录屏，确定退出？退出会停止录屏。",
            (false, true) => "正在生成故障报告，确定退出？退出会停止导出。",
            (false, false) => unreachable!(),
        };
        let app_for_quit = app.clone();
        app.dialog()
            .message(message)
            .title("确认退出")
            .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel)
            .show(move |confirmed| {
                if confirmed {
                    stop_all_and_exit(&app_for_quit);
                }
            });
    } else {
        stop_all_and_exit(app);
    }
}

/// 优雅停止录屏（SIGINT 收尾 mp4）与 logcat 后退出应用。
fn stop_all_and_exit(app: &tauri::AppHandle) {
    let state = app.state::<RecordingState>();
    if let Some(mut session) = state.session.lock().unwrap().take() {
        session.child.stop();
        log::info!("退出前已停止录屏，文件：{}", session.path);
    }
    let logcat = app.state::<RunningLogcat>();
    logcat.generation.fetch_add(1, Ordering::SeqCst);
    if let Some(mut proc) = logcat.child.lock().unwrap().take() {
        proc.stop();
    }
    app.state::<BugreportState>().controller.stop();
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log::info!("应用启动，初始化插件");
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("testbench".into()),
                    }),
                ])
                .level(log::LevelFilter::Debug)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                // 默认单文件上限仅 40KB，容易被轮询日志写爆；提高到 5MB，
                // 保证启动/投屏等关键日志能完整保留到导出调试报告时。
                .max_file_size(5 * 1024 * 1024)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // 自动更新（updater）：更新清单/签名验证逻辑由 tauri.conf.json 的 plugins.updater 配置
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 更新安装完成后 relaunch 重启进程
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 已有实例在运行：聚焦已有窗口
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // 只记忆尺寸/位置/最大化。不记忆 VISIBLE：窗口平时会隐藏到托盘，
                // 若连同可见性一起保存，退出后下次启动会“记住”隐藏状态导致窗口不显示。
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            // 关闭按钮 → 隐藏到托盘（继续抓日志/录屏），真正退出走托盘菜单「退出」。
            // 必须在 Rust 侧同步处理：JS 异步回调里调用 hide() 在 Windows 上会与
            // 主线程事件循环互相等待而死锁，表现为“点关闭没有反应”。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    if let Err(e) = window.hide() {
                        log::error!("隐藏窗口失败：{e}");
                    }
                }
            }
        })
        .manage(RunningLogcat {
            child: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
        })
        .manage(RecordingState {
            session: Mutex::new(None),
        })
        .manage(BugreportState {
            controller: BugreportController::default(),
        })
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            adb::init_binary_paths(resource_dir);
            build_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            start_logcat,
            stop_logcat,
            clear_log,
            pair_device,
            connect_device,
            disconnect_device,
            generate_pairing,
            mdns_pairing_address,
            mdns_connect_address,
            resolve_pids,
            app_runtime_status,
            fetch_remote_apps,
            open_in_browser,
            publish_remote_config,
            verify_publish_token,
            open_backdoor,
            restart_app,
            screenshot,
            pick_apk,
            install_apk,
            clear_app_data,
            uninstall_app,
            device_info,
            current_activity,
            start_recording,
            stop_recording,
            mirror,
            export_bugreport,
            cleanup_for_update,
            app_alarm,
            app_performance,
            export_logs,
            export_config,
            import_config,
            export_debug_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
