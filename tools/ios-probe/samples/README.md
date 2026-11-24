# 脱敏样本

本目录只保存人工构造或完成脱敏的 go-ios 输出，用于解析器回归测试。

不得提交真实 UDID、序列号、IMEI、MAC 地址、账号、网络地址或业务敏感日志。

- `syslog-unity.jsonl`：基础 syslog 信封与字段解析。
- `syslog-unity-capabilities.jsonl`：根据 iOS 18 真机结果人工脱敏重建，覆盖 Unity 语义级别、乱码检测、原生日志和截断标记；不包含真实设备标识与本地路径。
