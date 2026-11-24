import { useEffect, useRef } from "react";
import { canHandleLogShortcut } from "./logShortcuts";

export function useLogWorkspaceShortcuts(actions: {
  enabled: boolean; canPause: boolean; canExport: boolean; onPause: () => void; onClear: () => void;
  onExport: () => void; onCopy?: () => void;
}) {
  const current = useRef(actions);
  current.current = actions;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = current.current;
      if (!action.enabled || !canHandleLogShortcut(event)) return;
      if (event.key === " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (action.canPause) { event.preventDefault(); action.onPause(); }
        return;
      }
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;
      switch (event.key.toLowerCase()) {
        case "l": event.preventDefault(); action.onClear(); break;
        case "e": if (action.canExport) { event.preventDefault(); action.onExport(); } break;
        case "c": if (action.onCopy && window.getSelection()?.isCollapsed) { event.preventDefault(); action.onCopy(); } break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
