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
    install_apk as adb_install_apk, list_devices as adb_list_devices,
    mdns_pairing_address as adb_mdns_pairing_address, mirror as adb_mirror,
    open_backdoor as adb_open_backdoor, pair as adb_pair, resolve_pids as adb_resolve_pids,
    restart_app as adb_restart_app, screencap_png as adb_screencap_png,
    uninstall_app as adb_uninstall_app, App, Device, DeviceInfo, LogcatProcess, PairingInfo,
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

#[tauri::command]
async fn list_devices() -> Result<Vec<Device>, String> {
    log::debug!("收到前端命令 list_devices");
    adb_list_devices()
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
async fn resolve_pids(device: Option<String>, package: String) -> Result<Vec<String>, String> {
    log::info!("收到前端命令 resolve_pids：device={:?} package={package}", device);
    adb_resolve_pids(device.as_deref(), &package)
}

#[tauri::command]
async fn fetch_remote_apps(url: String) -> Result<Vec<App>, String> {
    log::info!("收到前端命令 fetch_remote_apps：url={url}");
    adb_fetch_remote_apps(&url)
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
    use tauri_plugin_dialog::DialogExt;
    log::info!("收到前端命令 screenshot：device={:?}", device);
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let name = format!("screenshot_{ts}.png");
    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("图片", &["png"])
        .blocking_save_file();
    let Some(path) = picked else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let bytes = adb_screencap_png(device.as_deref())?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入截图失败：{e}"))?;
    log::info!("截图已保存到：{}", path.display());
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
async fn pick_apk(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    log::debug!("收到前端命令 pick_apk");
    let picked = app
        .dialog()
        .file()
        .add_filter("APK 安装包", &["apk"])
        .blocking_pick_file();
    match picked {
        Some(f) => Ok(Some(
            f.into_path()
                .map_err(|e| e.to_string())?
                .display()
                .to_string(),
        )),
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
    use tauri_plugin_dialog::DialogExt;
    log::info!("收到前端命令 start_recording：device={:?} mbps={mbps}", device);
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let name = format!("recording_{ts}.mp4");
    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("视频", &["mp4"])
        .blocking_save_file();
    let Some(path) = picked else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
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
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_file_name("logcat.txt")
        .add_filter("日志文件", &["txt", "log"])
        .blocking_save_file();
    match picked {
        Some(path) => {
            let p = path.into_path().map_err(|e| e.to_string())?;
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
    use tauri_plugin_dialog::DialogExt;
    log::info!("收到前端命令 export_config，配置长度 {} 字节", text.len());
    let picked = app
        .dialog()
        .file()
        .set_file_name("testbench-config.json")
        .add_filter("配置文件", &["json"])
        .blocking_save_file();
    match picked {
        Some(path) => {
            let p = path.into_path().map_err(|e| e.to_string())?;
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
    use tauri_plugin_dialog::DialogExt;
    log::debug!("收到前端命令 import_config");
    let picked = app
        .dialog()
        .file()
        .add_filter("配置文件", &["json"])
        .blocking_pick_file();
    match picked {
        Some(f) => {
            let p = f.into_path().map_err(|e| e.to_string())?;
            let text = std::fs::read_to_string(&p).map_err(|e| format!("读取文件失败：{e}"))?;
            log::info!("读取到配置文件：{}（{} 字节）", p.display(), text.len());
            Ok(Some(text))
        }
        None => Ok(None),
    }
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
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(RunningLogcat {
            child: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
        })
        .manage(RecordingState {
            session: Mutex::new(None),
        })
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            adb::init_binary_paths(resource_dir);
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
            resolve_pids,
            fetch_remote_apps,
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
            app_alarm,
            app_performance,
            export_logs,
            export_config,
            import_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
