import type { ReactNode } from "react";

export type IconName =
  | "play"
  | "stop"
  | "pause"
  | "trash"
  | "export"
  | "wifi"
  | "tools"
  | "tests"
  | "more"
  | "settings"
  | "bookmark"
  | "font"
  | "theme"
  | "edit"
  | "move-top"
  | "move-up"
  | "move-down"
  | "move-bottom";

export function Icon({ name, className = "ui-icon" }: { name: IconName; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  const paths: Record<IconName, ReactNode> = {
    edit: <><path d="m15 5 4 4M5 15 15 5a2.8 2.8 0 0 1 4 4L9 19l-5 1 1-5Z" /></>,
    "move-top": <path d="M5 4h14M12 20V8m-5 5 5-5 5 5" />,
    "move-up": <path d="M12 20V4m-5 5 5-5 5 5" />,
    "move-down": <path d="M12 4v16m-5-5 5 5 5-5" />,
    "move-bottom": <path d="M5 20h14M12 4v12m-5-5 5 5 5-5" />,
    play: <path d="m9 7 7 5-7 5V7Z" />,
    stop: <rect x="8" y="8" width="8" height="8" rx="1" />,
    pause: <><path d="M9 7v10M15 7v10" /></>,
    trash: <><path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" /></>,
    export: <><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 14v5h14v-5" /></>,
    wifi: <><path d="M3.5 9.5a12 12 0 0 1 17 0M6.8 12.8a7.4 7.4 0 0 1 10.4 0M10.1 16.1a2.7 2.7 0 0 1 3.8 0" /><circle cx="12" cy="19" r=".8" fill="currentColor" stroke="none" /></>,
    tools: <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17a2 2 0 1 0 3 3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.2-2.2 2.6-2.6Z" /></>,
    tests: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m9 11 2 2 4-4M9 16h6" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-2.1 2.1-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.1h-3v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1-2.1-2.1.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1h-.1v-3h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1 2.1-2.1.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5v-.1h3v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1 2.1 2.1-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1h.1v3h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
    bookmark: <><path d="M7 4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V21l-5-3-5 3V4.5Z" /><path d="M12 7v6M9 10h6" /></>,
    font: <><path d="M5 19 10 5h4l5 14M7 14h10" /></>,
    theme: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  };
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" strokeLinecap="round" strokeLinejoin="round" {...common}>{paths[name]}</svg>;
}
