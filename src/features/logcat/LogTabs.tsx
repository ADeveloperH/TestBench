import { useEffect, useRef, useState } from "react";
import type { LogTabState } from "./useLogTabs";

interface Props {
  tabs: LogTabState[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onCreateLog: () => void;
  onCreateTest: () => void;
  onDuplicate: () => void;
  onClose: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export function LogTabs(props: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLDivElement>(null);

  const startRename = (tab: LogTabState) => {
    setEditingId(tab.id);
    setDraftName(tab.name);
  };

  const finishRename = () => {
    if (!editingId) return;
    props.onRename(editingId, draftName);
    setEditingId(null);
  };

  useEffect(() => {
    if (editingId) inputRef.current?.select();
  }, [editingId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "F2") {
        const tab = props.tabs.find((item) => item.id === props.activeTabId);
        if (tab) {
          event.preventDefault();
          startRename(tab);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.activeTabId, props.tabs]);

  useEffect(() => {
    if (!showCreateMenu) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!createRef.current?.contains(event.target as Node)) {
        setShowCreateMenu(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowCreateMenu(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showCreateMenu]);

  return (
    <div className="log-tabs-bar" aria-label="日志监控标签页">
      <div className="log-tabs-scroll" role="tablist">
        {props.tabs.map((tab) => {
          const active = tab.id === props.activeTabId;
          return (
            <div
              key={tab.id}
              className={`log-tab ${tab.kind === "test" ? "log-tab-test" : ""} ${active ? "active" : ""}`}
              role="tab"
              aria-selected={active}
              title={`${tab.name}（双击或按 F2 重命名）`}
              onClick={() => props.onSelect(tab.id)}
              onDoubleClick={() => startRename(tab)}
            >
              <span className={`log-tab-status ${tab.pausedAtId != null ? "paused" : "live"}`} />
              <span className="log-tab-kind" aria-hidden="true">
                {tab.kind === "test" ? "✓" : ""}
              </span>
              {editingId === tab.id ? (
                <input
                  ref={inputRef}
                  className="log-tab-name-input"
                  value={draftName}
                  maxLength={32}
                  onChange={(event) => setDraftName(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onBlur={finishRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") finishRename();
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span className="log-tab-name">{tab.name}</span>
              )}
              <button
                className="log-tab-close"
                disabled={props.tabs.length <= 1}
                title={props.tabs.length <= 1 ? "至少保留一个日志 Tab" : "关闭 Tab"}
                aria-label={`关闭 ${tab.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClose(tab.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="log-tab-create" ref={createRef}>
        <button
          className="log-tab-add"
          title="新建 Tab"
          aria-expanded={showCreateMenu}
          onClick={() => setShowCreateMenu((shown) => !shown)}
        >
          +
        </button>
        {showCreateMenu && (
          <div className="log-tab-create-menu">
            <button
              onClick={() => {
                setShowCreateMenu(false);
                props.onCreateLog();
              }}
            >
              <span className="log-tab-create-icon">≡</span>
              <span>
                <strong>普通日志</strong>
                <small>自由使用搜索、Tag 和级别过滤</small>
              </span>
            </button>
            <button
              onClick={() => {
                setShowCreateMenu(false);
                props.onCreateTest();
              }}
            >
              <span className="log-tab-create-icon">✓</span>
              <span>
                <strong>测试用例监控</strong>
                <small>固定应用，保留完整日志用于用例判定和定位</small>
              </span>
            </button>
          </div>
        )}
      </div>
      <button className="log-tab-duplicate" title="复制当前 Tab" onClick={props.onDuplicate}>
        复制
      </button>
      <span className="log-tabs-hint">双击名称或 F2 重命名</span>
    </div>
  );
}
