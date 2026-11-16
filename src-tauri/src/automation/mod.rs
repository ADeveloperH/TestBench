//! 自动化宿主：独立于 Tab 生命周期的任务、JSONL 通信、手机录屏与交付。
mod recording;
pub mod plans;
use base64::Engine;
use recording::{write_json, Recording};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Output, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};
const MAX_MESSAGE: usize = 4 * 1024 * 1024;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub owner_tab: String,
    pub device: String,
    pub package: String,
    pub connected: bool,
    pub busy: bool,
    pub catalog: Option<Value>,
    pub phase: String,
    pub country: String,
    pub graph: String,
    pub node: String,
    pub error_code: String,
    pub error: String,
    pub run_dir: String,
    pub steps: Vec<Value>,
    pub clips: Vec<Value>,
}
fn mark_connection_lost(snapshot: &mut Snapshot, error: String) {
    snapshot.connected = false;
    // A late idle heartbeat must not replace an already recorded task outcome.
    if !["completed", "partial", "failed", "cancelled"].contains(&snapshot.phase.as_str()) {
        snapshot.phase = "disconnected".into();
        snapshot.error_code = "connection_lost".into();
        snapshot.error = error;
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Task {
    pub tab_id: String,
    pub scenario: String,
    pub countries: Vec<String>,
    pub plan: Value,
    pub recording: Value,
    pub output_directory: String,
}
enum Command {
    Run(Task),
    Shutdown,
}
struct Worker {
    sender: mpsc::Sender<Command>,
    cancel: Arc<AtomicBool>,
    quit: Arc<AtomicBool>,
    join: thread::JoinHandle<()>,
}
#[derive(Default)]
pub struct AutomationController {
    transition: Mutex<()>,
    worker: Mutex<Option<Worker>>,
    snapshot: Arc<Mutex<Snapshot>>,
}
impl AutomationController {
    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.lock().unwrap().clone()
    }
    pub fn busy(&self) -> bool {
        self.snapshot.lock().unwrap().busy
    }
    pub fn ensure_available(&self) -> Result<(), String> {
        if self.busy() || self.snapshot().phase == "connecting" {
            Err("设备正由自动化任务使用，请先停止任务".into())
        } else {
            Ok(())
        }
    }
    pub fn shutdown(&self) {
        let _transition = self.transition.lock().unwrap();
        self.stop_worker();
    }
    fn stop_worker(&self) {
        if let Some(worker) = self.worker.lock().unwrap().take() {
            worker.cancel.store(true, Ordering::SeqCst);
            worker.quit.store(true, Ordering::SeqCst);
            let _ = worker.sender.send(Command::Shutdown);
            let _ = worker.join.join();
        }
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.connected = false;
        snapshot.busy = false;
    }
    fn connect(
        &self,
        app: AppHandle,
        tab_id: String,
        device: String,
        package: String,
    ) -> Result<Snapshot, String> {
        let _transition = self.transition.lock().unwrap();
        self.ensure_available()?;
        validate_identity(&device, &package)?;
        self.stop_worker();
        let snapshot = Arc::clone(&self.snapshot);
        *snapshot.lock().unwrap() = Snapshot {
            owner_tab: tab_id,
            device: device.clone(),
            package: package.clone(),
            phase: "connecting".into(),
            ..Default::default()
        };
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let cancel = Arc::new(AtomicBool::new(false));
        let quit = Arc::new(AtomicBool::new(false));
        let stop = cancel.clone();
        let exit = quit.clone();
        let join = thread::spawn(move || {
            let initial = open_bridge(&device, &package, &exit);
            let mut client = match initial {
                Ok(v) => v,
                Err(e) => {
                    update(&app, &snapshot, |s| {
                        s.phase = "failed".into();
                        s.error_code = "connection_failed".into();
                        s.error = e.clone();
                    });
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            let catalog = client.catalog();
            match catalog {
                Ok(value) => {
                    update(&app, &snapshot, |s| {
                        s.catalog = Some(value);
                        s.connected = true;
                        s.phase = "ready".into();
                    });
                    let _ = ready_tx.send(Ok(()));
                }
                Err(e) => {
                    update(&app, &snapshot, |s| {
                        s.phase = "failed".into();
                        s.error_code = "catalog_failed".into();
                        s.error = e.clone();
                    });
                    let _ = ready_tx.send(Err(e));
                    client.remove_forward();
                    return;
                }
            }
            loop {
                if exit.load(Ordering::SeqCst) {
                    break;
                }
                match rx.recv_timeout(Duration::from_secs(2)) {
                    Ok(Command::Shutdown) => break,
                    Ok(Command::Run(task)) => {
                        let result = run_task(
                            &app,
                            &snapshot,
                            &device,
                            &package,
                            &task,
                            &stop,
                            &exit,
                            &mut client,
                        );
                        update(&app, &snapshot, |s| {
                            s.busy = false;
                            if let Err(e) = result {
                                s.phase = if stop.load(Ordering::SeqCst) {
                                    "cancelled"
                                } else {
                                    "failed"
                                }
                                .into();
                                s.error_code = if stop.load(Ordering::SeqCst) {
                                    "cancelled".into()
                                } else {
                                    error_code(&e)
                                };
                                s.error = e;
                            }
                        });
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if let Err(e) = client.call("ping", json!({})) {
                            update(&app, &snapshot, |s| {
                                mark_connection_lost(s, e);
                            });
                            break;
                        }
                    }
                }
            }
            client.remove_forward();
            update(&app, &snapshot, |s| s.connected = false);
        });
        *self.worker.lock().unwrap() = Some(Worker {
            sender: tx,
            cancel,
            quit,
            join,
        });
        match ready_rx.recv_timeout(Duration::from_secs(90)) {
            Ok(result) => result?,
            Err(_) => {
                self.stop_worker();
                return Err("connection_timeout：连接测试包超时，已取消连接".into());
            }
        }
        Ok(self.snapshot())
    }
    fn start(&self, app: &AppHandle, task: Task) -> Result<Snapshot, String> {
        let _transition = self.transition.lock().unwrap();
        ensure_manual_idle(app)?;
        validate_task(&task)?;
        let worker = self.worker.lock().unwrap();
        let worker = worker.as_ref().ok_or("请先连接自动化测试包")?;
        {
            let mut s = self.snapshot.lock().unwrap();
            if s.busy || !s.connected || s.owner_tab != task.tab_id {
                return Err("此Tab尚未连接或已有任务正在执行".into());
            }
            s.busy = true;
            s.phase = "preparing".into();
            s.error.clear();
            s.error_code.clear();
            s.clips.clear();
            s.steps.clear();
            s.run_dir.clear();
            s.country.clear();
            s.graph.clear();
            s.node.clear();
        }
        worker.cancel.store(false, Ordering::SeqCst);
        if worker.sender.send(Command::Run(task)).is_err() {
            self.snapshot.lock().unwrap().busy = false;
            return Err("自动化连接已关闭，请重新连接".into());
        }
        let snapshot = self.snapshot();
        let _ = app.emit("automation-state", &snapshot);
        Ok(snapshot)
    }
}
fn update(app: &AppHandle, snapshot: &Arc<Mutex<Snapshot>>, action: impl FnOnce(&mut Snapshot)) {
    let value = {
        let mut s = snapshot.lock().unwrap();
        action(&mut s);
        s.clone()
    };
    let _ = app.emit("automation-state", value);
}
fn validate_identity(device: &str, package: &str) -> Result<(), String> {
    if device.is_empty()
        || device.chars().any(|c| c.is_control())
        || package.is_empty()
        || !package.contains('.')
        || !package
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_')
    {
        return Err("设备或应用包名无效".into());
    }
    Ok(())
}
fn validate_task(task: &Task) -> Result<(), String> {
    if task.scenario != "material_capture_mock" {
        return Err("首版仅支持通用录屏素材Mock数据".into());
    }
    if task.countries.is_empty()
        || task.countries.len() > 32
        || task.countries.iter().any(|c| !safe_name(c))
    {
        return Err("请选择有效的录制国家".into());
    }
    let mut unique = task.countries.clone();
    unique.sort();
    unique.dedup();
    if unique.len() != task.countries.len() {
        return Err("录制国家重复".into());
    }
    recording::validate_settings(&task.recording)?;
    if !task.plan.is_object()
        || !task.recording.is_object()
        || !Path::new(&task.output_directory).is_absolute()
    {
        return Err("任务配置或输出目录无效".into());
    }
    Ok(())
}
fn safe_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn adb(device: &str, args: &[&str], cancel: &AtomicBool) -> Result<Output, String> {
    let mut cmd = crate::adb::adb_command();
    cmd.arg("-s")
        .arg(device)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("adb_start_failed：{e}"))?;
    // These adb commands have bounded output; readers run concurrently to avoid pipe saturation.
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let read = |stream: Option<Box<dyn std::io::Read + Send>>| {
        thread::spawn(move || {
            let mut data = Vec::new();
            if let Some(mut r) = stream {
                let _ = r.by_ref().take(1024 * 1024).read_to_end(&mut data);
            }
            data
        })
    };
    let out = read(stdout.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>));
    let err = read(stderr.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>));
    let deadline = Instant::now() + Duration::from_secs(15);
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if cancel.load(Ordering::SeqCst) || Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = out.join();
            let _ = err.join();
            return Err("adb_timeout_or_cancelled：设备操作超时或取消".into());
        }
        thread::sleep(Duration::from_millis(50));
    };
    let output = Output {
        status,
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
    };
    if !output.status.success() {
        return Err(format!(
            "adb_failed：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(output)
}
struct Client {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
    device: String,
    package: String,
    port: u16,
    next: u64,
    replies: HashMap<String, Value>,
    events: VecDeque<Value>,
    recoveries: Vec<Value>,
}
impl Client {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let result = self.call_once(method, params.clone());
        let Err(original) = &result else {
            return result;
        };
        if self.port == 0
            || !["ping", "catalog", "status", "artifact.read"].contains(&method)
            || ![
                "bridge_disconnected",
                "bridge_read_failed",
                "bridge_write_failed",
            ]
            .iter()
            .any(|code| original.starts_with(code))
        {
            return result;
        }
        let recovery = self
            .reconnect()
            .and_then(|_| self.call_once(method, params.clone()));
        self.recoveries.push(
            json!({"time":chrono::Local::now().to_rfc3339(),"method":method,
            "runId":params["runId"],"originalError":original,"recovered":recovery.is_ok(),
            "recoveryError":recovery.as_ref().err()}),
        );
        recovery.map_err(|error| format!("{original}；只读重连失败：{error}"))
    }
    fn reconnect(&mut self) -> Result<(), String> {
        let address: SocketAddr = format!("127.0.0.1:{}", self.port).parse().unwrap();
        let stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))
            .map_err(|e| format!("bridge_reconnect_failed：{e}"))?;
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .map_err(|e| e.to_string())?;
        let _ = stream.set_nodelay(true);
        self.reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
        self.writer = stream;
        self.replies.clear();
        let hello = self.call_once("hello", json!({}))?;
        if hello["protocolVersion"] != 1 || hello["package"] != self.package {
            // Cleanup must never send stop/ack to an unverified replacement peer.
            let _ = self.writer.shutdown(std::net::Shutdown::Both);
            return Err("protocol_identity_mismatch：重连应用身份不匹配".into());
        }
        Ok(())
    }
    fn call_once(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next += 1;
        let id = self.next.to_string();
        let request = json!({"version":1,"id":id,"method":method,"params":params});
        let mut bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE {
            return Err("protocol_message_too_large".into());
        }
        bytes.push(b'\n');
        self.writer
            .write_all(&bytes)
            .map_err(|e| format!("bridge_write_failed：{e}"))?;
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(value) = self.replies.remove(&id) {
                if value["ok"].as_bool() == Some(true) {
                    return Ok(value["result"].clone());
                }
                return Err(format!(
                    "{}：{}",
                    value["error"]["code"].as_str().unwrap_or("remote_error"),
                    value["error"]["message"].as_str().unwrap_or("未知错误")
                ));
            }
            if Instant::now() > deadline {
                return Err("bridge_reply_timeout：手机15秒未回复".into());
            }
            let mut line = Vec::new();
            let n = self
                .reader
                .by_ref()
                .take((MAX_MESSAGE + 1) as u64)
                .read_until(b'\n', &mut line)
                .map_err(|e| format!("bridge_read_failed：{e}"))?;
            if n == 0 {
                return Err("bridge_disconnected：手机连接已断开".into());
            }
            if line.len() > MAX_MESSAGE || line.last() != Some(&b'\n') {
                return Err("protocol_message_invalid".into());
            }
            let value: Value =
                serde_json::from_slice(&line).map_err(|e| format!("protocol_json_invalid：{e}"))?;
            if value["version"] != 1 {
                return Err("protocol_version_mismatch".into());
            }
            if value["event"].is_string() {
                if self.events.len() >= 256 {
                    return Err("protocol_event_overflow".into());
                }
                self.events.push_back(value);
            } else if let Some(reply_id) = value["id"].as_str() {
                if self.replies.len() >= 64 {
                    return Err("protocol_reply_overflow".into());
                }
                self.replies.insert(reply_id.to_owned(), value);
            } else {
                return Err("protocol_message_invalid".into());
            }
        }
    }
    fn catalog(&mut self) -> Result<Value, String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match self.call("catalog", json!({})) {
                Ok(value) => return Ok(value),
                Err(e) if e.starts_with("catalog_not_ready") && Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(100))
                }
                Err(e) => return Err(e),
            }
        }
    }
    fn remove_forward(&mut self) {
        if self.port == 0 {
            return;
        }
        let _ = adb(
            &self.device,
            &["forward", "--remove", &format!("tcp:{}", self.port)],
            &AtomicBool::new(false),
        );
        self.port = 0;
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        self.remove_forward();
    }
}
fn open_bridge(device: &str, package: &str, cancel: &AtomicBool) -> Result<Client, String> {
    adb(device, &["shell", "am", "force-stop", package], cancel)?;
    let output = adb(
        device,
        &[
            "shell",
            "cmd",
            "package",
            "resolve-activity",
            "--brief",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
            package,
        ],
        cancel,
    )?;
    let activity = String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find(|s| s.contains('/') && !s.contains(' '))
        .unwrap_or("")
        .trim()
        .to_owned();
    if !activity.starts_with(&format!("{package}/"))
        || !activity
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._/$".contains(c))
    {
        return Err("launch_activity_missing：应用不存在或没有可用入口".into());
    }
    adb(
        device,
        &[
            "shell",
            "am",
            "start",
            "-n",
            &activity,
            "--ez",
            "automation_session",
            "true",
        ],
        cancel,
    )?;
    let out = adb(device, &["forward", "tcp:0", "tcp:23071"], cancel)?;
    let port = String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse::<u16>()
        .map_err(|_| "adb_forward_invalid：无法建立转发".to_string())?;
    let deadline = Instant::now() + Duration::from_secs(20);
    let address: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
    loop {
        if cancel.load(Ordering::SeqCst) || Instant::now() > deadline {
            let _ = adb(
                device,
                &["forward", "--remove", &format!("tcp:{port}")],
                &AtomicBool::new(false),
            );
            return Err("automation_apk_unavailable：未连接到自动化桥。请使用专用入口构建启用ENABLE_AUTOMATION、TEST的自动化测试包（Development非必需），并保持游戏前台运行".into());
        }
        if let Ok(stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) {
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .map_err(|e| e.to_string())?;
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .map_err(|e| e.to_string())?;
            let _ = stream.set_nodelay(true);
            let mut client = Client {
                reader: BufReader::new(stream.try_clone().map_err(|e| e.to_string())?),
                writer: stream,
                device: device.into(),
                package: package.into(),
                port,
                next: 0,
                replies: HashMap::new(),
                events: VecDeque::new(),
                recoveries: Vec::new(),
            };
            if let Ok(hello) = client.call("hello", json!({})) {
                if hello["protocolVersion"] != 1 || hello["package"] != package {
                    client.remove_forward();
                    return Err("protocol_identity_mismatch：连接的应用或协议不匹配".into());
                }
                return Ok(client);
            }
            // This socket failed, but the retry loop still owns the adb forward.
            client.port = 0;
        }
        thread::sleep(Duration::from_millis(200));
    }
}
fn run_task(
    app: &AppHandle,
    snapshot: &Arc<Mutex<Snapshot>>,
    device: &str,
    package: &str,
    task: &Task,
    cancel: &AtomicBool,
    quit: &AtomicBool,
    client: &mut Client,
) -> Result<(), String> {
    let catalog = snapshot
        .lock()
        .unwrap()
        .catalog
        .clone()
        .ok_or("场景目录缺失")?;
    let available = catalog["Countries"].as_array().ok_or("场景国家列表无效")?;
    if task
        .countries
        .iter()
        .any(|c| !available.contains(&json!(c)))
    {
        return Err("选择的国家不在当前游戏支持范围内".into());
    }
    let game = catalog["Game"]
        .as_str()
        .filter(|s| {
            !s.trim().is_empty()
                && s.len() <= 128
                && !s
                    .chars()
                    .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
                && !s.ends_with([' ', '.'])
                && *s != "."
                && *s != ".."
        })
        .ok_or("游戏标识无效")?;
    let root = Path::new(&task.output_directory)
        .join(chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string());
    fs::create_dir_all(&task.output_directory).map_err(|e| e.to_string())?;
    fs::create_dir(&root).map_err(|e| format!("output_directory_conflict：{e}"))?;
    write_json(
        &root.join("config/task.json"),
        &json!({"scenario":task.scenario,"countries":task.countries,"plan":task.plan,"recording":task.recording,"device":device,"package":package,"catalog":catalog}),
    )?;
    update(app, snapshot, |s| s.run_dir = root.display().to_string());
    let mut country_results = Vec::new();
    let mut has_failure = false;
    let mut has_skips = false;
    for (index, country) in task.countries.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) || quit.load(Ordering::SeqCst) {
            write_json(
                &root.join("reports/materials.json"),
                &json!({"status":"cancelled","countries":country_results}),
            )?;
            return Err("cancelled：用户停止".into());
        }
        update(app, snapshot, |s| {
            s.phase = "preparing".into();
            s.country = country.clone();
            s.steps.clear();
            s.graph.clear();
            s.node.clear();
        });
        // Each country/run starts before login with a clean process, never swaps an initialized environment.

        let run_id = format!(
            "run_{}_{}",
            chrono::Local::now().format("%Y%m%d_%H%M%S"),
            index
        );
        let mut capture = Capture::new(
            root.clone(),
            game.into(),
            country.clone(),
            device.into(),
            task.recording.clone(),
        );
        let mut network_offset = 0u64;
        client.recoveries.clear();
        let mut stage = "launch";
        let mut launch_attempted = false;
        let mut prepared = false;
        let result = (|| -> Result<Value, String> {
            client.remove_forward();
            launch_attempted = true;
            *client = open_bridge(device, package, cancel)?;
            stage = "catalog";
            let fresh = client.catalog()?;
            if fresh != catalog {
                return Err("catalog_changed：测试包场景目录已变化，请重新连接并检查配置".into());
            }
            if cancel.load(Ordering::SeqCst) {
                return Err("cancelled：准备任务时用户停止".into());
            }
            stage = "prepare";
            let response=client.call("prepare",json!({"scenario":task.scenario,"country":country,"plan":task.plan,"recording":task.recording,"runId":run_id}))?;
            prepared = true;
            write_json(&root.join(format!("config/{country}.json")), &response)?;
            if cancel.load(Ordering::SeqCst) {
                return Err("cancelled：启动任务前用户停止".into());
            }
            stage = "start";
            client.call("start", json!({"runId":run_id}))?;
            stage = "execute";
            let deadline = Instant::now() + Duration::from_secs(7200);
            let mut stopping = false;
            loop {
                if (cancel.load(Ordering::SeqCst) || quit.load(Ordering::SeqCst)) && !stopping {
                    client.call("stop", json!({"runId":run_id}))?;
                    stopping = true;
                }
                if Instant::now() > deadline {
                    return Err("task_timeout：单国家任务超过2小时预算".into());
                }
                let status = client.call("status", json!({"runId":run_id}))?;
                while let Some(event) = client.events.pop_front() {
                    if event["runId"] != run_id {
                        return Err("event_run_mismatch".into());
                    }
                    if event["event"] == "capture.request" {
                        let request = &event["data"];
                        let operation = request["operation"].as_str().unwrap_or("");
                        let capture_result = capture.handle(operation, &request["clip"], cancel);
                        let ack = match &capture_result {
                            Ok(value) => {
                                json!({"runId":run_id,"requestId":request["requestId"],"ok":true,"result":value})
                            }
                            Err(error) => {
                                json!({"runId":run_id,"requestId":request["requestId"],"ok":false,"error":error})
                            }
                        };
                        client.call("capture.ack", ack)?;
                        capture_result?;
                    }
                }
                pull_artifact(
                    client,
                    &run_id,
                    "network",
                    &root.join(format!("diagnostics/{country}/network.jsonl")),
                    &mut network_offset,
                )?;
                update(app, snapshot, |s| {
                    s.phase = status["state"].as_str().unwrap_or("running").into();
                    s.graph = status["graph"].as_str().unwrap_or("").into();
                    s.node = status["node"].as_str().unwrap_or("").into();
                    s.steps = status["report"]["Steps"]
                        .as_array()
                        .map(|v| {
                            v.iter()
                                .rev()
                                .take(300)
                                .cloned()
                                .collect::<Vec<_>>()
                                .into_iter()
                                .rev()
                                .collect()
                        })
                        .unwrap_or_default();
                    s.clips = country_results
                        .iter()
                        .flat_map(|c: &Value| c["videos"].as_array().cloned().unwrap_or_default())
                        .chain(capture.delivered.clone())
                        .collect();
                });
                let phase = status["state"].as_str().unwrap_or("");
                if ["passed", "failed", "cancelled"].contains(&phase)
                    && status["capturePending"] != true
                    && client.events.is_empty()
                {
                    write_json(&root.join(format!("reports/{country}.json")), &status)?;
                    let mut report_offset = 0;
                    pull_artifact(
                        client,
                        &run_id,
                        "report",
                        &root.join(format!("reports/{country}-full.json")),
                        &mut report_offset,
                    )?;
                    if phase != "passed" {
                        return Err(remote_error(&status));
                    }
                    return Ok(status);
                }
                thread::sleep(Duration::from_millis(250));
            }
        })();
        if result.is_err() && prepared {
            // Stop the Unity executor too; merely closing scrcpy must not leave gameplay running under idle heartbeats.
            let _ = client.call("stop", json!({"runId":run_id}));
            while let Some(event) = client.events.pop_front() {
                if event["event"] == "capture.request" {
                    let _=client.call("capture.ack",json!({"runId":run_id,"requestId":event["data"]["requestId"],"ok":false,"error":"host_task_stopped"}));
                }
            }
            let mut full_offset = 0;
            let _ = pull_artifact(
                client,
                &run_id,
                "report",
                &root.join(format!("reports/{country}-full.json")),
                &mut full_offset,
            );
        }
        // Best effort only: never replace the original task error with a diagnostics transfer error.
        if prepared {
            if let Err(error) = pull_artifact(
                client,
                &run_id,
                "network",
                &root.join(format!("diagnostics/{country}/network.jsonl")),
                &mut network_offset,
            ) {
                let _ = write_json(
                    &root.join(format!("diagnostics/{country}/transfer-error.json")),
                    &json!({"error":error,"receivedBytes":network_offset}),
                );
            }
        } else if launch_attempted {
            // prepare never established a run; keep the primary error instead of
            // issuing mismatched commands while the app continues normal startup.
            let cleanup = adb(
                device,
                &["shell", "am", "force-stop", package],
                &AtomicBool::new(false),
            );
            client.remove_forward();
            update(app, snapshot, |s| s.connected = false);
            let _ = write_json(
                &root.join(format!("diagnostics/{country}/startup-cleanup.json")),
                &json!({"stage":stage,"applicationStopped":cleanup.is_ok(),"cleanupError":cleanup.err()}),
            );
        }
        capture.cleanup();
        let _ = write_json(
            &root.join(format!("diagnostics/{country}/transport.json")),
            &json!({"recoveries":client.recoveries}),
        );
        let item = match result {
            Ok(status) => {
                let skipped = status["clips"]
                    .as_array()
                    .is_some_and(|clips| clips.iter().any(|c| c["status"] == "unreachable"));
                has_skips |= skipped;
                json!({"country":country,"status":if skipped{"partial"}else{"passed"},"result":status,"videos":capture.delivered})
            }
            Err(error) => {
                has_failure = true;
                write_json(
                    &root.join(format!("reports/{country}-error.json")),
                    &json!({"country":country,"stage":stage,"errorCode":error_code(&error),"error":error,"videos":capture.delivered}),
                )?;
                json!({"country":country,"stage":stage,"status":if cancel.load(Ordering::SeqCst)||quit.load(Ordering::SeqCst){"cancelled"}else{"failed"},"errorCode":error_code(&error),"error":error,"videos":capture.delivered})
            }
        };
        country_results.push(item);
        write_json(
            &root.join("reports/materials.json"),
            &json!({"status":if cancel.load(Ordering::SeqCst)||quit.load(Ordering::SeqCst){"cancelled"}else if has_failure||has_skips{"partial"}else{"complete"},"countries":country_results}),
        )?;
        if cancel.load(Ordering::SeqCst) || quit.load(Ordering::SeqCst) {
            return Err("cancelled：用户停止，已完成视频保留".into());
        }
    }
    update(app, snapshot, |s| {
        s.error = country_results
            .iter()
            .filter_map(|c| {
                c["error"]
                    .as_str()
                    .map(|e| format!("{}：{}", c["country"].as_str().unwrap_or(""), e))
            })
            .collect::<Vec<_>>()
            .join("\n");
        s.error_code = country_results
            .iter()
            .find_map(|c| c["errorCode"].as_str())
            .unwrap_or("")
            .into();
        s.phase = if has_failure || has_skips {
            "partial"
        } else {
            "completed"
        }
        .into();
        s.clips = country_results
            .iter()
            .flat_map(|c| c["videos"].as_array().cloned().unwrap_or_default())
            .collect();
    });
    Ok(())
}
struct Capture {
    root: PathBuf,
    game: String,
    country: String,
    device: String,
    settings: Value,
    recording: Option<Recording>,
    clip: Value,
    delivered: Vec<Value>,
    finished: HashMap<String, Value>,
}
impl Capture {
    fn new(root: PathBuf, game: String, country: String, device: String, settings: Value) -> Self {
        Self {
            root,
            game,
            country,
            device,
            settings,
            recording: None,
            clip: Value::Null,
            delivered: Vec::new(),
            finished: HashMap::new(),
        }
    }
    fn handle(
        &mut self,
        operation: &str,
        clip: &Value,
        cancel: &AtomicBool,
    ) -> Result<Value, String> {
        let id = clip["id"].as_str().unwrap_or("");
        if operation == "screenshot" {
            let path = self
                .root
                .join(format!("diagnostics/{}/final.png", self.country));
            fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            let image = adb(&self.device, &["exec-out", "screencap", "-p"], cancel)?.stdout;
            fs::write(&path, image).map_err(|e| e.to_string())?;
            return Ok(json!({"path":path}));
        }
        if !safe_name(id) {
            return Err("capture_clip_invalid".into());
        }
        if operation == "start" {
            if self.recording.is_some() || self.finished.contains_key(id) {
                return Err("capture_already_started".into());
            }
            let path = self
                .root
                .join(format!("diagnostics/{}/{}.mp4", self.country, id));
            fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            self.clip = clip.clone();
            self.recording = Some(Recording::start(
                &self.device,
                &path,
                &self.settings,
                cancel,
            )?);
            return Ok(json!({"ready":true}));
        }
        if operation != "stop" && operation != "cleanup" {
            return Err("capture_operation_unsupported".into());
        }
        if let Some(done) = self.finished.get(id) {
            return Ok(done.clone());
        }
        if self.clip["id"] != id {
            return Err("capture_clip_mismatch".into());
        }
        let mut recorder = self.recording.take().ok_or("capture_not_recording")?;
        let info = recorder.finish();
        // Recording owns the complete on-disk log from spawn onward; do not
        // overwrite it with the bounded error-message tail after finalization.
        let media = info?;
        let mut path = recorder.path.clone();
        if operation == "stop" && clip["status"] != "unreachable" {
            let kind = if clip["type"] == "level_success" {
                "游戏成功"
            } else {
                "游戏失败"
            };
            let level = clip["level"].as_str().unwrap_or("");
            if !level.bytes().all(|c| c.is_ascii_digit()) || level.len() > 5 {
                return Err("capture_level_invalid".into());
            }
            let suffix = if clip["withdrawal_status"] == "completed" {
                "_含提现"
            } else {
                ""
            };
            let target = self.root.join(format!(
                "video_{}/{}/{:02}_{}_第{}关{}.mp4",
                self.game,
                self.country,
                self.delivered.len() + 1,
                kind,
                level,
                suffix
            ));
            fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
            if target.exists() {
                return Err("delivery_file_exists".into());
            }
            fs::rename(&path, &target).map_err(|e| format!("delivery_failed：{e}"))?;
            path = target;
            self.delivered
                .push(json!({"country":self.country,"clip":clip,"file":path,"media":media}));
        }
        let result = json!({"video":path,"media":media});
        self.finished.insert(id.into(), result.clone());
        Ok(result)
    }
    fn cleanup(&mut self) {
        if let Some(mut recorder) = self.recording.take() {
            let _ = recorder.finish();
        }
    }
}

fn remote_error(status: &Value) -> String {
    let code = status["errorCode"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            status["report"]["ErrorCode"]
                .as_str()
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("execution_failed");
    let message = status["error"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| status["report"]["Error"].as_str().filter(|s| !s.is_empty()))
        .unwrap_or("流程未通过");
    format!("{code}：{message}")
}
fn error_code(message: &str) -> String {
    let first = message.split(['：', ':']).next().unwrap_or("");
    if !first.is_empty()
        && first
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b == b'_' || b.is_ascii_digit())
    {
        first.into()
    } else {
        "task_failed".into()
    }
}
fn ensure_manual_idle(app: &AppHandle) -> Result<(), String> {
    if app
        .state::<crate::RecordingState>()
        .session
        .lock()
        .unwrap()
        .is_some()
    {
        return Err("请先停止手工录屏，再连接或运行自动化".into());
    }
    if app.state::<crate::BugreportState>().controller.is_running() {
        return Err("请等待故障报告完成，再连接或运行自动化".into());
    }
    Ok(())
}
fn pull_artifact(
    client: &mut Client,
    run: &str,
    kind: &str,
    path: &Path,
    offset: &mut u64,
) -> Result<(), String> {
    // Bound each polling transfer to 2 MiB; remaining bytes continue on the next poll.
    for _ in 0..if kind == "report" { 512 } else { 8 } {
        let value = client.call(
            "artifact.read",
            json!({"runId":run,"kind":kind,"offset":*offset,"count":256*1024}),
        )?;
        let data = base64::engine::general_purpose::STANDARD
            .decode(value["data"].as_str().ok_or("artifact_data_invalid")?)
            .map_err(|_| "artifact_data_invalid")?;
        let next = value["nextOffset"]
            .as_u64()
            .ok_or("artifact_offset_invalid")?;
        if next != *offset + data.len() as u64 {
            return Err("artifact_offset_invalid".into());
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        file.write_all(&data).map_err(|e| e.to_string())?;
        *offset = next;
        if value["eof"] == true {
            return Ok(());
        }
    }
    if kind == "report" {
        return Err("report_transfer_incomplete：完整报告超过单次传输预算".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn automation_connect(
    app: AppHandle,
    _state: State<'_, AutomationController>,
    tab_id: String,
    device: String,
    package: String,
) -> Result<Snapshot, String> {
    ensure_manual_idle(&app)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app2.state::<AutomationController>()
            .connect(app2.clone(), tab_id, device, package)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn automation_snapshot(state: State<'_, AutomationController>) -> Snapshot {
    state.snapshot()
}
#[tauri::command]
pub fn automation_start(
    app: AppHandle,
    state: State<'_, AutomationController>,
    task: Task,
) -> Result<Snapshot, String> {
    state.start(&app, task)
}
#[tauri::command]
pub fn automation_stop(state: State<'_, AutomationController>) -> Result<(), String> {
    let w = state.worker.lock().unwrap();
    let w = w.as_ref().ok_or("没有自动化连接")?;
    w.cancel.store(true, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub async fn automation_disconnect(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AutomationController>().shutdown())
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn automation_default_output(app: AppHandle) -> Result<String, String> {
    Ok(app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("TestBench/AutomationOutput")
        .display()
        .to_string())
}
#[tauri::command]
pub fn automation_open_output(state: State<'_, AutomationController>) -> Result<(), String> {
    let path = state.snapshot().run_dir;
    if path.is_empty() || !Path::new(&path).is_dir() {
        return Err("尚无运行输出目录".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn automation_export_config(
    app: AppHandle,
    text: String,
) -> Result<Option<String>, String> {
    let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if value["Version"] != 1 || !value["Plans"].is_object() {
        return Err("自动化配置格式无效".into());
    }
    let path = crate::save_file_dialog(&app, "Automation.json", "自动化配置", &["json"])?;
    if let Some(path) = path {
        fs::write(&path, text).map_err(|e| e.to_string())?;
        Ok(Some(path.display().to_string()))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    fn client_with_server(
        reply: impl FnOnce(TcpStream) + Send + 'static,
    ) -> (Client, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            reply(stream);
        });
        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        (
            Client {
                reader: BufReader::new(stream.try_clone().unwrap()),
                writer: stream,
                device: String::new(),
                package: "fixture.game".into(),
                port: 0,
                next: 0,
                replies: HashMap::new(),
                events: VecDeque::new(),
                recoveries: Vec::new(),
            },
            handle,
        )
    }
    #[test]
    fn read_only_reconnect_checks_identity_and_preserves_events_without_restarting_task() {
        for identity in ["fixture.game", "other.game"] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = thread::spawn(move || {
                let (mut first, _) = listener.accept().unwrap();
                let mut line = String::new();
                BufReader::new(first.try_clone().unwrap())
                    .read_line(&mut line)
                    .unwrap();
                let original: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(original["method"], "status");
                writeln!(first,"{}",json!({"version":1,"event":"capture.request","runId":"r","sequence":1,"data":{"operation":"start"}})).unwrap();
                drop(first);
                let (mut second, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(second.try_clone().unwrap());
                line.clear();
                reader.read_line(&mut line).unwrap();
                let hello: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(hello["method"], "hello");
                writeln!(second,"{}",json!({"version":1,"id":hello["id"],"ok":true,"result":{"protocolVersion":1,"package":identity}})).unwrap();
                if identity == "fixture.game" {
                    line.clear();
                    reader.read_line(&mut line).unwrap();
                    let retry: Value = serde_json::from_str(&line).unwrap();
                    assert_eq!(retry["method"], "status");
                    assert_eq!(retry["params"], original["params"]);
                    writeln!(second,"{}",json!({"version":1,"id":retry["id"],"ok":true,"result":{"runId":"r","state":"running"}})).unwrap();
                } else {
                    second.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                    line.clear();
                    assert_eq!(reader.read_line(&mut line).unwrap(), 0,
                        "identity mismatch must close the peer before any cleanup command");
                }
            });
            let stream = TcpStream::connect(address).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut client = Client {
                reader: BufReader::new(stream.try_clone().unwrap()),
                writer: stream,
                device: String::new(),
                package: "fixture.game".into(),
                port: address.port(),
                next: 0,
                replies: HashMap::new(),
                events: VecDeque::new(),
                recoveries: Vec::new(),
            };
            let result = client.call("status", json!({"runId":"r"}));
            client.port = 0; // The test listener is not an adb forward.
            assert_eq!(result.is_ok(), identity == "fixture.game");
            assert_eq!(client.events.len(), 1);
            assert_eq!(client.recoveries.len(), 1);
            if identity != "fixture.game" {
                assert!(result.unwrap_err().contains("protocol_identity_mismatch"));
            }
            server.join().unwrap();
        }
    }
    #[test]
    fn disconnect_never_replays_side_effecting_commands() {
        for method in ["prepare", "start", "stop", "capture.ack"] {
            let (mut client, server) = client_with_server(|stream| {
                let mut line = String::new();
                BufReader::new(stream).read_line(&mut line).unwrap();
            });
            client.port = 1; // A reconnect attempt would fail; none is permitted.
            let result = client.call(method, json!({"runId":"r"}));
            client.port = 0;
            assert!(result.is_err());
            assert_eq!(client.next, 1);
            assert!(client.recoveries.is_empty());
            server.join().unwrap();
        }
    }
    #[test]
    fn requests_match_replies_and_keep_interleaved_capture_events() {
        let (mut client, server) = client_with_server(|mut stream| {
            let mut line = String::new();
            BufReader::new(stream.try_clone().unwrap())
                .read_line(&mut line)
                .unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            writeln!(stream,"{}",json!({"version":1,"event":"capture.request","runId":"r","sequence":1,"data":{"operation":"start"}})).unwrap();
            writeln!(stream,"{}",json!({"version":1,"id":request["id"],"ok":false,"error":{"code":"withdraw_rejected","message":"sample"}})).unwrap();
        });
        let error = client.call("status", json!({"runId":"r"})).unwrap_err();
        assert_eq!(error_code(&error), "withdraw_rejected");
        assert_eq!(
            client.events.pop_front().unwrap()["event"],
            "capture.request"
        );
        server.join().unwrap();
    }
    #[test]
    fn truncated_jsonl_and_wrong_versions_fail_closed() {
        for output in [
            "{\"version\":1",
            "{\"version\":2,\"id\":\"1\",\"ok\":true}\n",
        ] {
            let (mut client, server) = client_with_server(move |mut stream| {
                let mut line = String::new();
                BufReader::new(stream.try_clone().unwrap())
                    .read_line(&mut line)
                    .unwrap();
                stream.write_all(output.as_bytes()).unwrap();
            });
            assert!(client.call("hello", json!({})).is_err());
            server.join().unwrap();
        }
    }
    #[test]
    fn transport_failure_keeps_precise_error_instead_of_empty_or_cancelled_report() {
        assert_eq!(
            remote_error(
                &json!({"errorCode":"host_disconnected","error":"heartbeat lost","report":{"ErrorCode":"cancelled","Error":""}})
            ),
            "host_disconnected：heartbeat lost"
        );
        assert_eq!(
            remote_error(
                &json!({"errorCode":"","error":"","report":{"ErrorCode":"input_timeout","Error":"sample"}})
            ),
            "input_timeout：sample"
        );
    }
    #[test]
    fn idle_disconnect_preserves_finished_task_outcome_and_primary_error() {
        for phase in ["completed", "partial", "failed", "cancelled"] {
            let mut snapshot = Snapshot {
                phase: phase.into(),
                connected: true,
                error_code: "business_compilation_missing".into(),
                error: "original failure".into(),
                run_dir: "/output/run".into(),
                clips: vec![json!({"file":"completed.mp4"})],
                ..Default::default()
            };
            mark_connection_lost(&mut snapshot, "bridge_read_failed".into());
            assert!(!snapshot.connected);
            assert_eq!(snapshot.phase, phase);
            assert_eq!(snapshot.error_code, "business_compilation_missing");
            assert_eq!(snapshot.error, "original failure");
            assert_eq!(snapshot.run_dir, "/output/run");
            assert_eq!(snapshot.clips.len(), 1);
        }
        let mut snapshot = Snapshot {
            phase: "ready".into(),
            connected: true,
            ..Default::default()
        };
        mark_connection_lost(&mut snapshot, "bridge_read_failed".into());
        assert_eq!(snapshot.phase, "disconnected");
        assert_eq!(snapshot.error_code, "connection_lost");
        assert_eq!(snapshot.error, "bridge_read_failed");
    }
    #[test]
    fn task_validation_rejects_unsafe_countries_duplicates_and_relative_outputs() {
        let mut task = Task {
            tab_id: "tab".into(),
            scenario: "material_capture_mock".into(),
            countries: vec!["ID".into()],
            plan: json!({}),
            recording: json!({"Width":1080,"Height":1920,"FrameRate":30,"BitRateMbps":10,"CaptureAudio":false}),
            output_directory: std::env::temp_dir().display().to_string(),
        };
        assert!(validate_task(&task).is_ok());
        task.countries = vec!["../ID".into()];
        assert!(validate_task(&task).is_err());
        task.countries = vec!["ID".into(), "ID".into()];
        assert!(validate_task(&task).is_err());
        task.countries = vec!["ID".into()];
        task.output_directory = "relative".into();
        assert!(validate_task(&task).is_err());
    }
}
