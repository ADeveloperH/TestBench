import type { ReactNode } from "react";
export function LogWorkspaceFrame({ children, sidebar }: { children: ReactNode; sidebar?: ReactNode }) {
  return <div className="log-main"><div className="log-left">{children}</div>{sidebar}</div>;
}
