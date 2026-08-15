import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import type { PairingInfo } from "../../core/types";

interface Props {
  onChanged: () => void;
}

const HISTORY_KEY = "wifi-addr-history-v1";
const MAX_HISTORY = 20;

function loadHistory(): { pair: string[]; connect: string[] } {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.pair) && Array.isArray(d.connect)) {
        return { pair: d.pair, connect: d.connect };
      }
    }
  } catch {
    // 忽略损坏的缓存
  }
  return { pair: [], connect: [] };
}

function splitAddr(s: string): [string, string] | null {
  const i = s.lastIndexOf(":");
  if (i <= 0) return null;
  return [s.slice(0, i), s.slice(i + 1)];
}

/** 带历史下拉的地址输入框（复用现有 history-dropdown 样式）。 */
function AddrInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  history: string[];
  onPick: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="history-input" ref={rootRef}>
      <input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      {open && props.history.length > 0 && (
        <div className="history-dropdown">
          <div className="history-title">历史</div>
          {props.history.map((h) => (
            <div key={h} className="history-item">
              <span
                className="history-text"
                onMouseDown={(e) => {
                  e.preventDefault();
                  props.onPick(h);
                  setOpen(false);
                }}
              >
                {h}
              </span>
              <button
                className="history-btn danger"
                title="删除"
                onMouseDown={(e) => {
                  e.preventDefault();
                  props.onRemove(h);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WifiPanel({ onChanged }: Props) {
  const [pairAddr, setPairAddr] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [connectAddr, setConnectAddr] = useState("");
  const [history, setHistory] = useState(loadHistory);
  const [qr, setQr] = useState<PairingInfo | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrStatus, setQrStatus] = useState("");
  const [msg, setMsg] = useState("");
  const pairingRef = useRef(false);

  // 历史持久化
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // 忽略写入失败
    }
  }, [history]);

  const addHistory = (kind: "pair" | "connect", v: string) => {
    const s = v.trim();
    if (!s) return;
    setHistory((h) => ({
      ...h,
      [kind]: [s, ...h[kind].filter((x) => x !== s)].slice(0, MAX_HISTORY),
    }));
  };

  const removeHistory = (kind: "pair" | "connect", v: string) => {
    setHistory((h) => ({ ...h, [kind]: h[kind].filter((x) => x !== v) }));
  };

  // 配对成功后自动用 mDNS 发现连接地址并连接（配对与连接是两个步骤）。
  const autoConnectAfterPair = async () => {
    setMsg("配对成功，正在自动连接…");
    for (let i = 0; i < 10; i++) {
      try {
        const addr = await invoke<string | null>("mdns_connect_address");
        if (addr) {
          const parts = splitAddr(addr);
          if (parts) {
            const out = await invoke<string>("connect_device", {
              ip: parts[0],
              port: parts[1],
            });
            setMsg(`已连接：${out}`);
            addHistory("connect", addr);
            onChanged();
            return;
          }
        }
      } catch (e) {
        setMsg(`自动连接失败：${String(e)}，请手动填写连接地址`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setMsg(
      "配对成功，但未自动发现设备。请查看手机「无线调试」页面的 IP 地址和端口，填写到「连接地址」并点「连接」",
    );
  };

  // 二维码配对：PC 生成服务名+配对码 → 手机扫码 → 手机开始广播配对服务 → PC 轮询发现并配对。
  const startQr = async () => {
    setMsg("");
    try {
      const info = await invoke<PairingInfo>("generate_pairing");
      setQr(info);
      setQrStatus("请用手机：开发者选项 → 无线调试 → 扫码配对，扫描下方二维码");
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

  // 轮询 mDNS 发现手机广播的配对服务，发现后自动执行 adb pair。
  useEffect(() => {
    if (!qrBusy || !qr) return;
    const timer = setInterval(async () => {
      if (pairingRef.current) return;
      try {
        const addr = await invoke<string | null>("mdns_pairing_address");
        if (!addr) return;
        pairingRef.current = true;
        setQrStatus(`发现设备 ${addr}，配对中…`);
        const parts = splitAddr(addr);
        if (!parts) return;
        try {
          await invoke<string>("pair_device", {
            ip: parts[0],
            port: parts[1],
            code: qr.code,
          });
          setQr(null);
          setQrBusy(false);
          setQrStatus("");
          addHistory("pair", addr);
          onChanged();
          autoConnectAfterPair();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrBusy, qr, onChanged]);

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
      addHistory("pair", pairAddr);
      onChanged();
      autoConnectAfterPair();
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
      addHistory("connect", connectAddr);
      onChanged();
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <div className="wifi-panel">
      <div className="wifi-form">
        <label>配对地址</label>
        <AddrInput
          value={pairAddr}
          onChange={setPairAddr}
          placeholder="192.168.1.5:37000"
          history={history.pair}
          onPick={setPairAddr}
          onRemove={(v) => removeHistory("pair", v)}
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
        <label>连接地址</label>
        <AddrInput
          value={connectAddr}
          onChange={setConnectAddr}
          placeholder="192.168.1.5:5555"
          history={history.connect}
          onPick={setConnectAddr}
          onRemove={(v) => removeHistory("connect", v)}
        />
        <button onClick={doConnect}>连接</button>
      </div>

      <div className="wifi-form">
        {!qrBusy && <button onClick={startQr}>生成二维码配对</button>}
        {qrBusy && qr && (
          <>
            <QRCodeSVG
              value={qr.payload}
              size={220}
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
              includeMargin
            />
            <div className="qr-side">
              <div className="qr-status">{qrStatus}</div>
              <button onClick={cancelQr}>取消</button>
            </div>
          </>
        )}
      </div>

      <div className="wifi-msg">
        提示：手机「开发者选项 → 无线调试」里，「使用配对码配对设备」给出配对地址与
        配对码；页面顶部的「IP 地址和端口」是连接地址。配对成功后会自动尝试连接。
      </div>

      {msg && <span className="wifi-msg">{msg}</span>}
    </div>
  );
}
