fn main() {
    // 图标在 `tauri::generate_context!` 宏展开期被嵌入二进制，cargo 默认不跟踪
    // 图标文件的变化（只改 icons/ 不会触发重编译，dev 里会一直显示旧图标）。
    // 分两步解决：
    //   1. cargo:rerun-if-changed —— 图标变化时让 build 脚本重新执行；
    //   2. cargo:rustc-env —— 把图标内容哈希写进环境变量，哈希变化使下游 crate 重编译。
    use std::hash::{Hash, Hasher};
    let icons = [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico",
        "icons/icon.png",
    ];
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for icon in icons {
        println!("cargo:rerun-if-changed={icon}");
        if let Ok(bytes) = std::fs::read(icon) {
            bytes.hash(&mut hasher);
        }
    }
    println!("cargo:rustc-env=TESTBENCH_ICON_HASH={}", hasher.finish());
    tauri_build::build()
}

