fn main() {
    // 图标在 `tauri::generate_context!` 宏展开期被嵌入二进制，cargo 不跟踪
    // 图标文件的变化（只改 icons/ 不会触发重编译，dev 里会一直显示旧图标）。
    // 这里把图标内容哈希写入 rustc-env：图标一变哈希就变，从而强制重编译。
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
        if let Ok(bytes) = std::fs::read(icon) {
            bytes.hash(&mut hasher);
        }
    }
    println!("cargo:rustc-env=TESTBENCH_ICON_HASH={}", hasher.finish());
    tauri_build::build()
}
