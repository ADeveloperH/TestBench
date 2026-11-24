mod crash;
pub(crate) mod store;

pub use crash::IosCrashReport;

use std::{
    env,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use store::IosSessionWriter;

use ios_core::{
    classify_tool_error, list_devices, mask_udid, parse_envelope, IosDevice, IosLogRecord, IosTool,
    ProbeError, ProbeErrorKind,
};
use serde::Serialize;
use tauri::{Emitter, Manager};

const EVENT_QUEUE_CAPACITY: usize = 5_000;
const EVENT_BATCH_SIZE: usize = 200;
const EVENT_BATCH_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Clone)]
pub struct IosRuntime {
    resource_dir: Option<PathBuf>,
    development: bool,
}

impl IosRuntime {
    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        Self {
            resource_dir,
            development: cfg!(debug_assertions),
        }
    }

    pub fn resolve_tool(&self) -> Result<IosTool, ProbeError> {
        if self.development {
            if let Some(path) = env::var_os("IOS_TOOL_PATH").map(PathBuf::from) {
                if path.is_file() {
                    return Ok(IosTool::new(path));
                }
            }

            let repository_binary = bundled_binary(Path::new(env!("CARGO_MANIFEST_DIR")));
            if repository_binary.is_file() {
                return Ok(IosTool::new(repository_binary));
            }

            if let Some(path) = self.resource_binary().filter(|path| path.is_file()) {
                return Ok(IosTool::new(path));
            }

            if command_exists("ios") {
                return Ok(IosTool::new("ios"));
            }

            return Err(ProbeError::new(
                ProbeErrorKind::ToolNotFound,
                "未找到 go-ios；请设置 IOS_TOOL_PATH 或准备 src-tauri/bin/<platform>/ios",
            ));
        }

        let path = self.resource_binary().ok_or_else(|| {
            ProbeError::new(
                ProbeErrorKind::InstallationDamaged,
                "无法解析 TestBench 安装包资源目录",
            )
        })?;
        if !path.is_file() {
            return Err(ProbeError::new(
                ProbeErrorKind::InstallationDamaged,
                format!("安装包缺少内置 iOS 工具：{}", path.display()),
            ));
        }
        Ok(IosTool::new(path))
    }

    fn resource_binary(&self) -> Option<PathBuf> {
        self.resource_dir.as_deref().map(bundled_binary)
    }
}

fn bundled_binary(root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    return root.join("bin/windows/ios.exe");
    #[cfg(target_os = "macos")]
    return root.join("bin/macos/ios");
    #[allow(unreachable_code)]
    root.join("bin/unsupported/ios")
}

fn command_exists(command: &str) -> bool {
    env::var_os("PATH").is_some_and(|paths| {
        env::split_paths(&paths).any(|path| {
            if path.join(command).is_file() {
                return true;
            }
            #[cfg(target_os = "windows")]
            return path.join(format!("{command}.exe")).is_file();
            #[cfg(not(target_os = "windows"))]
            false
        })
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub enum DiagnosticStatus {
    Available,
    Unavailable,
    Error,
    NotApplicable,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticItem {
    pub status: DiagnosticStatus,
    pub message: String,
    pub error_kind: Option<ProbeErrorKind>,
}

impl DiagnosticItem {
    fn available(message: impl Into<String>) -> Self {
        Self {
            status: DiagnosticStatus::Available,
            message: message.into(),
            error_kind: None,
        }
    }

    fn from_error(error: &ProbeError) -> Self {
        Self {
            status: DiagnosticStatus::Error,
            message: error.message.clone(),
            error_kind: Some(error.kind),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosDoctorReport {
    pub platform: &'static str,
    pub architecture: &'static str,
    pub tool: DiagnosticItem,
    pub apple_service: DiagnosticItem,
    pub device_transport: DiagnosticItem,
    pub devices: Vec<IosDevice>,
}

pub fn doctor(runtime: &IosRuntime) -> IosDoctorReport {
    let mut report = IosDoctorReport {
        platform: env::consts::OS,
        architecture: env::consts::ARCH,
        tool: DiagnosticItem {
            status: DiagnosticStatus::Unknown,
            message: "尚未检查".to_owned(),
            error_kind: None,
        },
        apple_service: apple_service_diagnostic(),
        device_transport: DiagnosticItem {
            status: DiagnosticStatus::Unknown,
            message: "尚未检查".to_owned(),
            error_kind: None,
        },
        devices: Vec::new(),
    };

    let tool = match runtime.resolve_tool() {
        Ok(tool) => tool,
        Err(error) => {
            report.tool = DiagnosticItem::from_error(&error);
            return report;
        }
    };
    match tool.version() {
        Ok(version) => {
            report.tool =
                DiagnosticItem::available(format!("go-ios v{version}：{}", tool.path().display()));
        }
        Err(error) => {
            report.tool = DiagnosticItem::from_error(&error);
            return report;
        }
    }

    match list_devices(&tool) {
        Ok(devices) => {
            let available = devices
                .iter()
                .filter(|device| {
                    device
                        .capabilities
                        .contains(&ios_core::DeviceCapability::Syslog)
                })
                .count();
            report.device_transport = DiagnosticItem::available(if devices.is_empty() {
                "设备通信服务可用，当前没有连接设备".to_owned()
            } else {
                format!(
                    "设备通信服务可用，发现 {} 条设备记录，{} 台当前可采集",
                    devices.len(),
                    available
                )
            });
            report.devices = devices;
        }
        Err(error) => {
            if error.kind == ProbeErrorKind::AppleServiceMissing {
                report.apple_service = DiagnosticItem::from_error(&error);
            }
            report.device_transport = DiagnosticItem::from_error(&error);
        }
    }
    report
}

#[cfg(target_os = "windows")]
fn apple_service_diagnostic() -> DiagnosticItem {
    use std::os::windows::process::CommandExt;

    let output = std::process::Command::new("sc")
        .creation_flags(0x0800_0000)
        .args(["query", "Apple Mobile Device Service"])
        .output();
    match output {
        Ok(value) if value.status.success() => {
            let text = String::from_utf8_lossy(&value.stdout).to_ascii_uppercase();
            if text.contains("RUNNING") {
                DiagnosticItem::available("Apple Mobile Device Service 正在运行")
            } else {
                DiagnosticItem {
                    status: DiagnosticStatus::Unavailable,
                    message: "Apple Mobile Device Service 已安装但未运行".to_owned(),
                    error_kind: Some(ProbeErrorKind::AppleServiceMissing),
                }
            }
        }
        _ => DiagnosticItem {
            status: DiagnosticStatus::Unavailable,
            message: "未检测到 Apple Mobile Device Service，请安装 Apple Devices 或 iTunes"
                .to_owned(),
            error_kind: Some(ProbeErrorKind::AppleServiceMissing),
        },
    }
}

#[cfg(not(target_os = "windows"))]
fn apple_service_diagnostic() -> DiagnosticItem {
    DiagnosticItem {
        status: DiagnosticStatus::NotApplicable,
        message: "当前平台不使用 Windows Apple Mobile Device Service".to_owned(),
        error_kind: None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogSessionState {
    Idle,
    Running,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosProbeStatus {
    pub session_id: Option<String>,
    pub device_key: Option<String>,
    pub state: LogSessionState,
    pub error: Option<ProbeError>,
    pub session_dir: Option<String>,
    pub storage_error: Option<String>,
    pub received_count: u64,
    pub emitted_count: u64,
    pub backend_dropped_count: u64,
    pub frontend_dropped_count: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IosSessionEvent {
    session_id: String,
    device_key: String,
    error: Option<ProbeError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IosExportStatus<'a> {
    session_id: &'a Option<String>,
    device_display_id: Option<String>,
    state: &'a LogSessionState,
    error_kind: Option<ProbeErrorKind>,
    storage_error: &'a Option<String>,
    received_count: u64,
    emitted_count: u64,
    backend_dropped_count: u64,
    frontend_dropped_count: u64,
}

impl IosProbeStatus {
    pub(crate) fn export_summary(&self) -> IosExportStatus<'_> {
        IosExportStatus {
            session_id: &self.session_id,
            device_display_id: self
                .device_key
                .as_deref()
                .and_then(|key| key.strip_prefix("ios:"))
                .map(mask_udid),
            state: &self.state,
            error_kind: self.error.as_ref().map(|error| error.kind),
            storage_error: &self.storage_error,
            received_count: self.received_count,
            emitted_count: self.emitted_count,
            backend_dropped_count: self.backend_dropped_count,
            frontend_dropped_count: self.frontend_dropped_count,
        }
    }
}

struct RunningSession {
    child: Arc<Mutex<Child>>,
    generation: u64,
    worker: Option<thread::JoinHandle<()>>,
}

struct ControllerState {
    session_id: Option<String>,
    device_key: Option<String>,
    state: LogSessionState,
    error: Option<ProbeError>,
    session_dir: Option<String>,
    storage_error: Option<String>,
    exact_process: Option<String>,
    started_at: i64,
}

#[derive(Default)]
struct SessionMetrics {
    received: AtomicU64,
    emitted: AtomicU64,
    backend_dropped: AtomicU64,
    frontend_dropped: AtomicU64,
}

impl SessionMetrics {
    fn reset(&self) {
        self.received.store(0, Ordering::SeqCst);
        self.emitted.store(0, Ordering::SeqCst);
        self.backend_dropped.store(0, Ordering::SeqCst);
        self.frontend_dropped.store(0, Ordering::SeqCst);
    }

    fn snapshot(&self, state: &ControllerState) -> IosProbeStatus {
        IosProbeStatus {
            session_id: state.session_id.clone(),
            device_key: state.device_key.clone(),
            state: state.state.clone(),
            error: state.error.clone(),
            session_dir: state.session_dir.clone(),
            storage_error: state.storage_error.clone(),
            received_count: self.received.load(Ordering::SeqCst),
            emitted_count: self.emitted.load(Ordering::SeqCst),
            backend_dropped_count: self.backend_dropped.load(Ordering::SeqCst),
            frontend_dropped_count: self.frontend_dropped.load(Ordering::SeqCst),
        }
    }
}

pub struct IosLogController {
    lifecycle: Mutex<()>,
    session: Arc<Mutex<Option<RunningSession>>>,
    state: Arc<Mutex<ControllerState>>,
    metrics: Arc<SessionMetrics>,
    generation: Arc<AtomicU64>,
    crash_watch: Mutex<Option<crash::CrashWatch>>,
}

impl Default for IosLogController {
    fn default() -> Self {
        Self {
            lifecycle: Mutex::new(()),
            session: Arc::new(Mutex::new(None)),
            state: Arc::new(Mutex::new(ControllerState {
                session_id: None,
                device_key: None,
                state: LogSessionState::Idle,
                error: None,
                session_dir: None,
                storage_error: None,
                exact_process: None,
                started_at: 0,
            })),
            metrics: Arc::new(SessionMetrics::default()),
            generation: Arc::new(AtomicU64::new(0)),
            crash_watch: Mutex::new(None),
        }
    }
}

impl IosLogController {
    pub fn status(&self) -> IosProbeStatus {
        self.metrics.snapshot(&self.state.lock().unwrap())
    }

    pub fn scan_crashes(
        &self,
        runtime: &IosRuntime,
        session_id: &str,
        bundle_id: &str,
        process: &str,
    ) -> Result<Vec<IosCrashReport>, ProbeError> {
        if !matches!(
            (bundle_id, process),
            ("com.lucky.fruit.quest.master", "FruitQuest")
                | ("com.testbench.iosbusinessfixture", "TestBenchIOSBusinessFixture")
        ) {
            return Err(ProbeError::new(
                ProbeErrorKind::InvalidArguments,
                "未知的 iOS 崩溃监测目标",
            ));
        }
        let (udid, started_at) = {
            let state = self.state.lock().unwrap();
            if state.session_id.as_deref() != Some(session_id)
                || !matches!(state.state, LogSessionState::Running)
                || state.exact_process.as_deref() != Some(process)
            {
                return Ok(Vec::new());
            }
            let Some(udid) = state
                .device_key
                .as_deref()
                .and_then(|key| key.strip_prefix("ios:"))
            else {
                return Ok(Vec::new());
            };
            (udid.to_owned(), state.started_at)
        };

        // 崩溃查询使用独立锁，设备服务超时不阻塞日志启停。
        let Ok(mut watch) = self.crash_watch.try_lock() else {
            return Ok(Vec::new());
        };
        if watch.as_ref().is_none_or(|current| current.session_id != session_id) {
            *watch = Some(crash::CrashWatch::new(session_id.to_owned()));
        }
        let reports = watch.as_mut().unwrap().scan(
            &runtime.resolve_tool()?,
            &udid,
            bundle_id,
            process,
            started_at,
        )?;
        let state = self.state.lock().unwrap();
        if state.session_id.as_deref() != Some(session_id)
            || !matches!(state.state, LogSessionState::Running)
        {
            return Ok(Vec::new());
        }
        Ok(reports)
    }

    pub fn report_frontend_dropped(&self, count: u64) {
        self.metrics
            .frontend_dropped
            .fetch_add(count, Ordering::SeqCst);
    }

    pub fn start<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        runtime: &IosRuntime,
        udid: &str,
        process_filter: Option<String>,
        exact_process: bool,
    ) -> Result<(), ProbeError> {
        let app_data_dir = app.path().app_data_dir().map_err(|error| {
            ProbeError::new(
                ProbeErrorKind::Io,
                format!("无法解析 TestBench 数据目录：{error}"),
            )
        })?;
        self.start_with_app_data(app, runtime, udid, process_filter, &app_data_dir, exact_process)
    }

    fn start_with_app_data<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        runtime: &IosRuntime,
        udid: &str,
        process_filter: Option<String>,
        app_data_dir: &Path,
        exact_process: bool,
    ) -> Result<(), ProbeError> {
        let _lifecycle = self.lifecycle.lock().unwrap();
        let mut session = self.session.lock().unwrap();
        if session.is_some() {
            return Err(ProbeError::new(
                ProbeErrorKind::InvalidArguments,
                "iOS 日志会话已经在运行，请先停止当前会话",
            ));
        }

        let tool = runtime.resolve_tool()?;
        let tool_version = tool.version()?;
        let mut writer = IosSessionWriter::start(
            app_data_dir,
            &mask_udid(udid),
            &tool_version,
            process_filter.as_deref(),
            exact_process,
        )
        .map_err(|error| ProbeError::new(ProbeErrorKind::Io, error))?;
        let session_dir = writer.dir().display().to_string();
        let session_id = writer
            .dir()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let device_key = format!("ios:{udid}");
        let started_event = IosSessionEvent {
            session_id: session_id.clone(),
            device_key: device_key.clone(),
            error: None,
        };
        let mut child = tool
            .command()
            .args(["--udid", udid, "syslog"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                ProbeError::new(
                    ProbeErrorKind::Io,
                    format!("无法启动 go-ios syslog：{error}"),
                )
            })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ProbeError::new(ProbeErrorKind::Io, "无法读取 go-ios stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| ProbeError::new(ProbeErrorKind::Io, "无法读取 go-ios stderr"))?;

        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.metrics.reset();
        let child = Arc::new(Mutex::new(child));
        *session = Some(RunningSession {
            child: child.clone(),
            generation,
            worker: None,
        });
        *self.state.lock().unwrap() = ControllerState {
            session_id: Some(session_id.clone()),
            device_key: Some(device_key.clone()),
            state: LogSessionState::Running,
            error: None,
            session_dir: Some(session_dir),
            storage_error: None,
            exact_process: process_filter.clone().filter(|_| exact_process),
            started_at: chrono::Utc::now().timestamp_millis(),
        };
        drop(session);

        let stderr_thread = thread::spawn(move || {
            let mut collected = String::new();
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    collected.push_str(&line);
                    collected.push('\n');
                }
            }
            collected
        });

        let expected_process = process_filter.map(|value| value.to_ascii_lowercase());
        let generation_ref = self.generation.clone();
        let state_ref = self.state.clone();
        let session_ref = self.session.clone();
        let metrics_ref = self.metrics.clone();
        let app_for_thread = app.clone();
        let worker = thread::spawn(move || {
            let (sender, receiver) = sync_channel(EVENT_QUEUE_CAPACITY);
            let emitter_app = app_for_thread.clone();
            let emitter_metrics = metrics_ref.clone();
            let emitter_session_id = session_id.clone();
            let emitter_device_key = device_key.clone();
            let emitter = thread::spawn(move || {
                emit_batches(
                    receiver,
                    emitter_app,
                    emitter_metrics,
                    emitter_session_id,
                    emitter_device_key,
                )
            });

            let mut terminal_error = None;
            for line in BufReader::new(stdout).lines() {
                if generation_ref.load(Ordering::SeqCst) != generation {
                    break;
                }
                let line = match line {
                    Ok(line) => line,
                    Err(error) => {
                        terminal_error = Some(ProbeError::new(
                            ProbeErrorKind::Io,
                            format!("读取 go-ios syslog 失败：{error}"),
                        ));
                        break;
                    }
                };
                let Some(record) = parse_envelope(&line) else {
                    continue;
                };
                if expected_process.as_ref().is_some_and(|expected| {
                    !ios_core::matches_process(&record.process, expected, exact_process)
                }) {
                    continue;
                }
                metrics_ref.received.fetch_add(1, Ordering::SeqCst);
                if let Err(error) = writer.append(&record) {
                    state_ref.lock().unwrap().storage_error = Some(error.clone());
                    terminal_error = Some(ProbeError::new(ProbeErrorKind::Io, error));
                    if let Ok(mut child) = child.lock() {
                        let _ = child.kill();
                    }
                    break;
                }
                if !enqueue_record(&sender, &metrics_ref, record) {
                    break;
                }
            }

            if let Err(error) = writer.flush() {
                state_ref
                    .lock()
                    .unwrap()
                    .storage_error
                    .get_or_insert_with(|| error.clone());
                terminal_error.get_or_insert_with(|| ProbeError::new(ProbeErrorKind::Io, error));
            }
            drop(sender);
            let _ = emitter.join();
            let stderr = stderr_thread.join().unwrap_or_default();
            if generation_ref.load(Ordering::SeqCst) != generation {
                return;
            }
            let exit_status = child.lock().unwrap().wait();
            let error = terminal_error.or_else(|| match exit_status {
                Ok(value) if value.success() => None,
                Ok(value) => {
                    let kind = classify_tool_error(&stderr);
                    let message = match kind {
                        ProbeErrorKind::DeviceDisconnected => {
                            "iOS 设备连接已断开，请重新连接后刷新设备".to_owned()
                        }
                        ProbeErrorKind::TrustRequired | ProbeErrorKind::PairingInvalid => {
                            "iOS 设备信任或配对状态已失效，请解锁设备并重新信任此电脑".to_owned()
                        }
                        _ => format!("go-ios syslog 异常退出：{value}"),
                    };
                    Some(ProbeError::new(kind, message))
                }
                Err(error) => Some(ProbeError::new(
                    ProbeErrorKind::Io,
                    format!("等待 go-ios syslog 退出失败：{error}"),
                )),
            });
            let mut state = state_ref.lock().unwrap();
            state.state = if error.is_some() {
                LogSessionState::Error
            } else {
                LogSessionState::Idle
            };
            state.error = error.clone();
            drop(state);
            let mut session = session_ref.lock().unwrap();
            if session
                .as_ref()
                .is_some_and(|running| running.generation == generation)
            {
                *session = None;
            }
            drop(session);
            if let Some(error) = error {
                let _ = app_for_thread.emit(
                    "ios-probe-error",
                    IosSessionEvent {
                        session_id: session_id.clone(),
                        device_key: device_key.clone(),
                        error: Some(error),
                    },
                );
            }
            let _ = app_for_thread.emit(
                "ios-probe-stopped",
                IosSessionEvent {
                    session_id,
                    device_key,
                    error: None,
                },
            );
        });

        let mut session = self.session.lock().unwrap();
        if let Some(running) = session
            .as_mut()
            .filter(|running| running.generation == generation)
        {
            running.worker = Some(worker);
        }
        drop(session);

        let _ = app.emit("ios-probe-started", started_event);
        Ok(())
    }

    pub fn stop(&self) {
        let _lifecycle = self.lifecycle.lock().unwrap();
        self.generation.fetch_add(1, Ordering::SeqCst);
        let running = { self.session.lock().unwrap().take() };
        if let Some(mut running) = running {
            debug_assert!(running.generation > 0);
            if let Ok(mut child) = running.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
            if let Some(worker) = running.worker.take() {
                let _ = worker.join();
            }
        }
        let mut state = self.state.lock().unwrap();
        state.state = LogSessionState::Idle;
        state.error = None;
    }
}

fn enqueue_record(
    sender: &SyncSender<IosLogRecord>,
    metrics: &SessionMetrics,
    record: IosLogRecord,
) -> bool {
    match sender.try_send(record) {
        Ok(()) => true,
        Err(TrySendError::Full(_)) => {
            metrics.backend_dropped.fetch_add(1, Ordering::SeqCst);
            true
        }
        Err(TrySendError::Disconnected(_)) => false,
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IosLogBatch {
    first_sequence: u64,
    session_id: String,
    device_key: String,
    records: Vec<IosLogRecord>,
    received_count: u64,
    emitted_count: u64,
    backend_dropped_count: u64,
    frontend_dropped_count: u64,
}

fn emit_batches<R: tauri::Runtime>(
    receiver: Receiver<IosLogRecord>,
    app: tauri::AppHandle<R>,
    metrics: Arc<SessionMetrics>,
    session_id: String,
    device_key: String,
) {
    let mut batch = Vec::with_capacity(EVENT_BATCH_SIZE);
    let mut last_flush = Instant::now();
    loop {
        let timeout = EVENT_BATCH_INTERVAL.saturating_sub(last_flush.elapsed());
        match receiver.recv_timeout(timeout) {
            Ok(record) => batch.push(record),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                flush_batch(&app, &metrics, &mut batch, &session_id, &device_key);
                break;
            }
        }
        if batch.len() >= EVENT_BATCH_SIZE || last_flush.elapsed() >= EVENT_BATCH_INTERVAL {
            flush_batch(&app, &metrics, &mut batch, &session_id, &device_key);
            last_flush = Instant::now();
        }
    }
}

fn flush_batch<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    metrics: &SessionMetrics,
    batch: &mut Vec<IosLogRecord>,
    session_id: &str,
    device_key: &str,
) {
    if batch.is_empty() {
        return;
    }
    let count = batch.len() as u64;
    let emitted_count = metrics.emitted.load(Ordering::SeqCst) + count;
    let payload = IosLogBatch {
        first_sequence: emitted_count - count + 1,
        session_id: session_id.to_owned(),
        device_key: device_key.to_owned(),
        records: std::mem::take(batch),
        received_count: metrics.received.load(Ordering::SeqCst),
        emitted_count,
        backend_dropped_count: metrics.backend_dropped.load(Ordering::SeqCst),
        frontend_dropped_count: metrics.frontend_dropped.load(Ordering::SeqCst),
    };
    if app.emit("ios-probe-logs", payload).is_ok() {
        metrics.emitted.fetch_add(count, Ordering::SeqCst);
    } else {
        metrics.backend_dropped.fetch_add(count, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_binary, doctor, enqueue_record, DiagnosticStatus, IosLogController, IosRuntime,
        SessionMetrics,
    };
    use ios_core::{EncodingStatus, IosLogRecord, ProbeErrorKind};
    use std::{path::Path, time::SystemTime};

    fn sample_record(message: &str) -> IosLogRecord {
        IosLogRecord {
            timestamp: "Nov  4 12:00:00".to_owned(),
            device: "TestPhone".to_owned(),
            process: "Fixture".to_owned(),
            module: Some("UnityFramework".to_owned()),
            pid: Some(42),
            level: "notice".to_owned(),
            semantic_level: None,
            semantic_level_source: None,
            encoding_status: EncodingStatus::Valid,
            truncated: false,
            message: message.to_owned(),
            raw: format!("raw {message}"),
        }
    }

    #[test]
    fn builds_platform_resource_path() {
        let path = bundled_binary(Path::new("/resource"));
        #[cfg(target_os = "macos")]
        assert!(path.ends_with("bin/macos/ios"));
        #[cfg(target_os = "windows")]
        assert!(path.ends_with("bin/windows/ios.exe"));
    }

    #[test]
    fn release_mode_reports_missing_bundled_tool_as_damaged_installation() {
        let runtime = IosRuntime {
            resource_dir: Some(std::env::temp_dir().join("testbench-missing-ios-resource")),
            development: false,
        };
        let error = runtime
            .resolve_tool()
            .expect_err("missing resource must fail");
        assert_eq!(error.kind, ProbeErrorKind::InstallationDamaged);
    }

    #[test]
    fn bounded_queue_counts_dropped_records_without_blocking() {
        use std::sync::{atomic::Ordering, mpsc::sync_channel};

        let metrics = SessionMetrics::default();
        let (sender, _receiver) = sync_channel(1);
        assert!(enqueue_record(&sender, &metrics, sample_record("first")));
        assert!(enqueue_record(&sender, &metrics, sample_record("dropped")));
        assert_eq!(metrics.backend_dropped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn status_accumulates_frontend_drop_reports() {
        let controller = IosLogController::default();
        controller.report_frontend_dropped(3);
        controller.report_frontend_dropped(2);
        assert_eq!(controller.status().frontend_dropped_count, 5);
    }

    #[test]
    fn crash_scan_checks_active_exact_capture_before_accessing_the_device() {
        let controller = IosLogController::default();
        // 缺少工具时，只有满足会话边界的请求才会尝试访问它。
        let runtime = IosRuntime {
            resource_dir: None,
            development: false,
        };
        {
            let mut state = controller.state.lock().unwrap();
            state.session_id = Some("current".into());
            state.device_key = Some("ios:fixture".into());
            state.state = super::LogSessionState::Running;
        }
        let scan = |session| {
            controller.scan_crashes(
                &runtime,
                session,
                "com.testbench.iosbusinessfixture",
                "TestBenchIOSBusinessFixture",
            )
        };
        assert!(scan("current").unwrap().is_empty());
        controller.state.lock().unwrap().exact_process = Some("TestBenchIOSBusinessFixture".into());
        assert!(scan("old").unwrap().is_empty());
        assert_eq!(
            scan("current").unwrap_err().kind,
            ProbeErrorKind::InstallationDamaged
        );
        controller.state.lock().unwrap().state = super::LogSessionState::Error;
        assert!(scan("current").unwrap().is_empty());
    }

    #[test]
    fn stop_releases_session_lock_before_waiting_for_worker() {
        use std::{
            process::{Command, Stdio},
            sync::{mpsc, Arc, Mutex},
            time::{Duration, Instant},
        };
        let controller = IosLogController::default();
        let child = Command::new(std::env::current_exe().unwrap())
            .arg("--list")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let session = controller.session.clone();
        let (tx, rx) = mpsc::channel();
        let (start_tx, start_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            start_rx.recv().unwrap();
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                if session.try_lock().is_ok_and(|guard| guard.is_none()) {
                    tx.send(true).unwrap();
                    return;
                }
                if Instant::now() >= deadline {
                    tx.send(false).unwrap();
                    return;
                }
                std::thread::yield_now();
            }
        });
        *controller.session.lock().unwrap() = Some(super::RunningSession {
            child: Arc::new(Mutex::new(child)),
            generation: 1,
            worker: Some(worker),
        });
        start_tx.send(()).unwrap();
        controller.stop();
        assert!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap(),
            "stop 持锁等待 worker，会导致退出死锁"
        );
    }

    #[test]
    fn export_summary_masks_device_and_omits_internal_paths() {
        let controller = IosLogController::default();
        {
            let mut state = controller.state.lock().unwrap();
            state.session_id = Some("session-one".into());
            state.device_key = Some("ios:00008110-1234567890ABCDEF".into());
            state.session_dir = Some("/private/user/internal/session-one".into());
            state.storage_error = Some("disk full".into());
        }
        let status = controller.status();
        let json = serde_json::to_value(status.export_summary()).unwrap();
        assert!(json.get("deviceKey").is_none());
        assert!(json.get("sessionDir").is_none());
        assert_eq!(json["sessionId"], "session-one");
        assert_eq!(
            json["deviceDisplayId"],
            ios_core::mask_udid("00008110-1234567890ABCDEF")
        );
        let text = json.to_string();
        assert!(!text.contains("1234567890ABCDEF"));
        assert!(!text.contains("/private/user"));
        assert_eq!(json["storageError"], "disk full");
    }

    #[test]
    fn lifecycle_events_include_device_and_session_identity() {
        let event = super::IosSessionEvent {
            session_id: "session-one".into(),
            device_key: "ios:device-one".into(),
            error: Some(ios_core::ProbeError::new(
                ProbeErrorKind::DeviceDisconnected,
                "disconnected",
            )),
        };
        let json = serde_json::to_value(event).unwrap();
        assert_eq!(json["sessionId"], "session-one");
        assert_eq!(json["deviceKey"], "ios:device-one");
        assert_eq!(json["error"]["kind"], "DeviceDisconnected");
    }

    #[test]
    fn stopping_preserves_storage_failure_in_export_status() {
        let controller = IosLogController::default();
        controller.state.lock().unwrap().storage_error = Some("disk full".into());
        controller.stop();
        let status = controller.status();
        assert_eq!(status.state, super::LogSessionState::Idle);
        assert_eq!(status.storage_error.as_deref(), Some("disk full"));
        let json = serde_json::to_value(status).unwrap();
        assert_eq!(json["storageError"], "disk full");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn doctor_reports_pinned_bundled_tool_and_empty_device_list() {
        use std::os::unix::fs::PermissionsExt;

        let suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("testbench-ios-doctor-{suffix}"));
        let tool_path = bundled_binary(&root);
        std::fs::create_dir_all(tool_path.parent().expect("parent")).expect("create tool dir");
        std::fs::write(
            &tool_path,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo '{\"version\":\"1.3.2\"}'\nelse\n  echo '{\"deviceList\":[]}'\nfi\n",
        )
        .expect("write mock tool");
        let mut permissions = std::fs::metadata(&tool_path)
            .expect("metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&tool_path, permissions).expect("chmod");

        let runtime = IosRuntime {
            resource_dir: Some(root.clone()),
            development: false,
        };
        let report = doctor(&runtime);
        assert!(matches!(report.tool.status, DiagnosticStatus::Available));
        assert!(matches!(
            report.device_transport.status,
            DiagnosticStatus::Available
        ));
        assert!(report.devices.is_empty());

        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn abnormal_sidecar_exit_sets_disconnect_error_and_releases_session() {
        use super::{IosLogController, LogSessionState};
        use std::{os::unix::fs::PermissionsExt, time::Duration};

        let suffix = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("testbench-ios-exit-{suffix}"));
        let tool_path = bundled_binary(&root);
        std::fs::create_dir_all(tool_path.parent().expect("parent")).expect("create tool dir");
        std::fs::write(
            &tool_path,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo '{\"version\":\"1.3.2\"}'\nelse\n  echo '{\"msg\":\"Nov  4 12:00:00 TestPhone Fixture(UnityFramework)[42] <Notice>: simulated\"}'\n  echo '{\"msg\":\"failed reading syslog\",\"err\":\"EOF\"}' >&2\n  exit 1\nfi\n",
        )
        .expect("write mock tool");
        let mut permissions = std::fs::metadata(&tool_path)
            .expect("metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&tool_path, permissions).expect("chmod");

        let runtime = IosRuntime {
            resource_dir: Some(root.clone()),
            development: false,
        };
        let controller = IosLogController::default();
        let app = tauri::test::mock_app();
        let app_data = root.join("app-data");
        controller
            .start_with_app_data(app.handle().clone(), &runtime, "test-udid", None, &app_data, false)
            .expect("first start");
        for _ in 0..40 {
            if matches!(controller.status().state, LogSessionState::Error) {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let status = controller.status();
        assert_eq!(status.state, LogSessionState::Error);
        assert_eq!(
            status.error.as_ref().map(|error| error.kind),
            Some(ProbeErrorKind::DeviceDisconnected)
        );
        assert_eq!(status.received_count, 1);
        assert!(status.session_id.is_some());
        assert_eq!(status.device_key.as_deref(), Some("ios:test-udid"));
        let previous_session = status.session_id.clone();
        controller.state.lock().unwrap().storage_error = Some("previous disk failure".into());

        // 自然异常退出后必须释放旧会话，下一次启动不能误报“已经在运行”。
        controller
            .start_with_app_data(app.handle().clone(), &runtime, "test-udid", None, &app_data, false)
            .expect("restart after abnormal exit");
        assert_ne!(controller.status().session_id, previous_session);
        assert!(controller.status().storage_error.is_none());
        controller.stop();
        assert_eq!(controller.status().state, LogSessionState::Idle);

        if let Some(session_dir) = status.session_dir {
            let _ = std::fs::remove_dir_all(session_dir);
        }
        if let Some(session_dir) = controller.status().session_dir {
            let _ = std::fs::remove_dir_all(session_dir);
        }
        std::fs::remove_dir_all(root).expect("cleanup mock tool");
    }

    /// 真实设备回归入口：默认忽略，避免普通测试依赖 USB 和本机配对状态。
    ///
    /// IOS_TOOL_PATH=/path/to/ios IOS_TEST_UDID=<UDID> \
    ///   cargo test --manifest-path src-tauri/Cargo.toml \
    ///   ios::tests::real_device_session_starts_emits_and_stops -- --ignored --nocapture
    #[test]
    #[ignore = "需要已配对的 USB iOS 真机和 go-ios v1.3.2"]
    fn real_device_session_starts_emits_and_stops() {
        use super::LogSessionState;
        use ios_core::{ConnectionState, DeviceCapability, TrustState};
        use std::{
            sync::{
                atomic::{AtomicUsize, Ordering},
                Arc,
            },
            time::Duration,
        };
        use tauri::Listener;

        let udid = std::env::var("IOS_TEST_UDID").expect("IOS_TEST_UDID");
        let runtime = IosRuntime::new(None);
        let report = doctor(&runtime);
        assert!(matches!(report.tool.status, DiagnosticStatus::Available));
        assert!(matches!(
            report.device_transport.status,
            DiagnosticStatus::Available
        ));
        let device = report
            .devices
            .iter()
            .find(|device| device.id == udid)
            .expect("target device in doctor report");
        assert_eq!(device.connection_state, ConnectionState::Online);
        assert_eq!(device.trust_state, TrustState::Trusted);
        assert!(device.capabilities.contains(&DeviceCapability::Syslog));

        let controller = IosLogController::default();
        let app = tauri::test::mock_app();
        let count = Arc::new(AtomicUsize::new(0));
        let count_for_event = count.clone();
        let listener = app.listen_any("ios-probe-logs", move |_| {
            count_for_event.fetch_add(1, Ordering::SeqCst);
        });

        controller
            .start(app.handle().clone(), &runtime, &udid, None, false)
            .expect("start real device syslog");
        std::thread::sleep(Duration::from_secs(2));
        assert!(matches!(
            controller.status().state,
            LogSessionState::Running
        ));
        assert!(count.load(Ordering::SeqCst) > 0, "expected syslog events");

        controller.stop();
        let status = controller.status();
        assert!(matches!(status.state, LogSessionState::Idle));
        assert!(status.received_count > 0);
        assert!(status.emitted_count > 0);
        assert!(status.received_count >= status.emitted_count);
        let session_dir = status.session_dir.expect("session dir");
        assert!(std::path::Path::new(&session_dir)
            .join("metadata.json")
            .is_file());
        assert!(std::path::Path::new(&session_dir)
            .join("records-0000.jsonl")
            .is_file());
        app.unlisten(listener);
        std::fs::remove_dir_all(session_dir).expect("cleanup real device test session");
    }
}
