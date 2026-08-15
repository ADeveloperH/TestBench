import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import type { PairingInfo } from "../../core/types";

interface Props {
  onChanged: () => void;
}

export function WifiPanel({ onChanged }: Props) {
  const [pairAddr, setPairAddr] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [connectAddr, setConnectAddr] = useState("");
  const [qr, setQr] = useState<PairingInfo | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrStatus, setQrStatus] = useState("");
  const [msg, setMsg] = useState("");
  const pairingRef = useRef(false);

  const startQr = async () => {
    setMsg("");
    try {
      const info = await invoke<PairingInfo>("generate_pairing");
      setQr(info);
      setQrStatus("请用手机：开发者选项 → 无线调试 → 使用二维码配对设备");
      setQrBusy(true);
    } catch (e) {
      setMsg(String(e));
    }
  };

  const cancelQr = () => {
    pairingRef.current = false;
    setQr(null);
    setQrBusy(false);
    setQrStatus("");
  };

  // 轮询 mDNS 发现手机，发现后自动执行 adb pair。
  useEffect(() => {
    if (!qrBusy || !qr) return;
    const timer = setInterval(async () => {
      if (pairingRef.current) return;
      try {
        const addr = await invoke<string | null>("mdns_pairing_address");
        if (!addr) return;
        pairingRef.current = true;
        setQrStatus(`发现设备 ${addr}，配对中…`);
        const i = addr.lastIndexOf(":");
        const ip = addr.slice(0, i);
        const port = addr.slice(i + 1);
        try {
          const out = await invoke<string>("pair_device", {
            ip,
            port,
            code: qr.code,
          });
          setMsg(`配对成功：${out}`);
          setQr(null);
          setQrBusy(false);
          setQrStatus("");
          onChanged();
        } catch (e) {
          setMsg(`配对失败：${String(e)}`);
          setQr(null);
          setQrBusy(false);
          setQrStatus("");
        } finally {
          pairingRef.current = false;
        }
      } catch (e) {
        setMsg(String(e));
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [qrBusy, qr, onChanged]);

  const splitAddr = (s: string): [string, string] | null => {
    const i = s.lastIndexOf(":");
    if (i <= 0) return null;
    return [s.slice(0, i), s.slice(i + 1)];
  };

  const doPair = async () => {
    setMsg("");
    const parts = splitAddr(pairAddr);
    if (!parts) {
      setMsg("配对地址格式应为 ip:port");
      return;
    }
    const [ip, port] = parts;
    try {
      const out = await invoke<string>("pair_device", {
        ip,
        port,
        code: pairCode,
      });
      setMsg(`配对成功：${out}`);
      onChanged();
    } catch (e) {
      setMsg(String(e));
    }
  };

  const doConnect = async () => {
    setMsg("");
    const parts = splitAddr(connectAddr);
    if (!parts) {
      setMsg("连接地址格式应为 ip:port");
      return;
    }
    const [ip, port] = parts;
    try {
      const out = await invoke<string>("connect_device", { ip, port });
      setMsg(`连接成功：${out}`);
      onChanged();
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <div className="wifi-panel">
      <div className="wifi-form">
        <label>配对地址(ip:port)</label>
        <input
          placeholder="192.168.1.5:37000"
          value={pairAddr}
          onChange={(e) => setPairAddr(e.target.value)}
        />
        <label>配对码</label>
        <input
          placeholder="6 位码"
          value={pairCode}
          onChange={(e) => setPairCode(e.target.value)}
        />
        <button onClick={doPair}>配对</button>
      </div>

      <div className="wifi-form">
        <label>连接地址(ip:port)</label>
        <input
          placeholder="192.168.1.5:5555"
          value={connectAddr}
          onChange={(e) => setConnectAddr(e.target.value)}
        />
        <button onClick={doConnect}>连接</button>
      </div>

      <div className="wifi-form">
        {!qrBusy && <button onClick={startQr}>生成二维码配对</button>}
        {qrBusy && qr && (
          <>
            <QRCodeSVG value={qr.payload} size={160} />
            <div className="qr-side">
              <div className="qr-status">{qrStatus}</div>
              <button onClick={cancelQr}>取消</button>
            </div>
          </>
        )}
      </div>

      {msg && <span className="wifi-msg">{msg}</span>}
    </div>
  );
}
