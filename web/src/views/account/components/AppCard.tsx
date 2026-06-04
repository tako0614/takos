import { A } from "@solidjs/router";
import { Box, GitBranch, Server } from "lucide-solid";
import type { Installation } from "../lib/api.ts";
import AppStatusPill from "./AppStatusPill.tsx";

/** Ported from takosumi dashboard-ui/src/components/apps/AppCard.tsx. */
export default function AppCard(props: { app: Installation }) {
  const ref = () => props.app.sourceRef ?? "main";
  const repoLabel = () => {
    const url = props.app.sourceGitUrl;
    if (!url) return props.app.appId;
    try {
      const u = new URL(url);
      return u.pathname.replace(/^\/+|\.git$/g, "");
    } catch {
      return url;
    }
  };
  return (
    <A
      href={`/apps/${encodeURIComponent(props.app.installationId)}`}
      class="app-card"
    >
      <div class="app-card-head">
        <Box size={18} />
        <span class="app-card-name">{props.app.appId}</span>
        <AppStatusPill status={props.app.status} />
      </div>
      <div class="app-card-meta">
        <span class="app-card-meta-item">
          <GitBranch size={13} /> {repoLabel()} @ {ref()}
        </span>
        <span class="app-card-meta-item">
          <Server size={13} /> {props.app.mode ?? "—"}
        </span>
      </div>
    </A>
  );
}
