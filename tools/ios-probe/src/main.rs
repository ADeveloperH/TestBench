mod syslog;
mod tool;

use std::{env, process::ExitCode};

use ios_core::{list_devices, ProbeError, ProbeErrorKind};
use serde::Serialize;
use tool::locate_cli_tool;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!(
                "{}",
                serde_json::to_string_pretty(&error).unwrap_or_else(|_| error.to_string())
            );
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), ProbeError> {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some(command) = args.first().map(String::as_str) else {
        print_help();
        return Ok(());
    };

    match command {
        "doctor" => doctor(),
        "list" => list(),
        "logs" => logs(&args[1..]),
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        unknown => Err(ProbeError::new(
            ProbeErrorKind::InvalidArguments,
            format!("未知命令：{unknown}"),
        )),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DoctorReport {
    platform: &'static str,
    architecture: &'static str,
    tool_path: String,
    tool_version: String,
    device_access: bool,
    device_count: usize,
}

fn doctor() -> Result<(), ProbeError> {
    let tool = locate_cli_tool()?;
    let version = tool.version()?;
    let devices = list_devices(&tool)?;
    print_json(&DoctorReport {
        platform: env::consts::OS,
        architecture: env::consts::ARCH,
        tool_path: tool.path().display().to_string(),
        tool_version: version,
        device_access: true,
        device_count: devices.len(),
    })
}

fn list() -> Result<(), ProbeError> {
    let tool = locate_cli_tool()?;
    tool.version()?;
    print_json(&list_devices(&tool)?)
}

fn logs(args: &[String]) -> Result<(), ProbeError> {
    let Some(udid) = args.first() else {
        return Err(ProbeError::new(
            ProbeErrorKind::InvalidArguments,
            "logs 命令需要设备 UDID",
        ));
    };

    let mut process_filter = None;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--process" => {
                let Some(value) = args.get(index + 1) else {
                    return Err(ProbeError::new(
                        ProbeErrorKind::InvalidArguments,
                        "--process 后需要进程名",
                    ));
                };
                process_filter = Some(value.as_str());
                index += 2;
            }
            unknown => {
                return Err(ProbeError::new(
                    ProbeErrorKind::InvalidArguments,
                    format!("未知 logs 参数：{unknown}"),
                ));
            }
        }
    }

    let tool = locate_cli_tool()?;
    tool.version()?;
    syslog::stream_logs(&tool, udid, process_filter)
}

fn print_json<T: Serialize>(value: &T) -> Result<(), ProbeError> {
    let json = serde_json::to_string_pretty(value).map_err(|error| {
        ProbeError::new(
            ProbeErrorKind::OutputParseFailed,
            format!("JSON 序列化失败：{error}"),
        )
    })?;
    println!("{json}");
    Ok(())
}

fn print_help() {
    println!(
        "\
TestBench iOS Probe

用法：
  ios-probe doctor
  ios-probe list
  ios-probe logs <UDID> [--process <进程名>]

工具查找顺序：
  1. IOS_TOOL_PATH
  2. src-tauri/bin/<platform>/ios[.exe]
  3. PATH 中的 ios"
    );
}
