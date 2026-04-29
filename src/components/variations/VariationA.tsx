"use client";

// Variation A — "Vertical Drop" (SHOWCASE.md 정석)
// CommandFlow: 위→아래 SVG 라인 stroke-dashoffset
// 모바일 폭 360, 세로 카드 layout
// store-driven (single source of truth via ViewerStore)

import { ConnectionBadge, IntentPanel, MotionChip, NubjukViewer, VoiceVisualizer } from "../shared";
import type { ViewerStore } from "@/store/viewerStore";
import { useViewerStore } from "@/store/viewerStore";
import { selectIntentDisplay, selectVoicePhase } from "@/store/selectors";

interface Props {
  store: ViewerStore;
  showDevHint?: boolean;
}

export function VariationA({ store, showDevHint = true }: Props) {
  const state = useViewerStore(store);
  const phase = selectVoicePhase(state);
  const intent = selectIntentDisplay(state);
  const { activeMotion, motionStatus, currentPose, connectionState } = state;

  const wakeFiring = phase === "listening";
  const intentFiring = !!intent;
  const motionFiring = !!activeMotion && motionStatus === "started";

  const connState =
    connectionState.kind === "connected"
      ? "connected"
      : connectionState.kind === "connecting" || connectionState.kind === "reconnecting"
      ? "connecting"
      : "disconnected";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 480,
        minHeight: "100vh",
        background: "var(--bg)",
        padding: "20px 16px 28px",
        margin: "0 auto",
        position: "relative",
        fontFamily: "var(--font-sans)",
        overflow: "hidden",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 360 720"
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}
        aria-hidden="true"
      >
        <line x1="180" y1="120" x2="180" y2="600" stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />

        <line
          x1="180"
          y1="120"
          x2="180"
          y2="290"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray="170"
          strokeLinecap="round"
          style={{
            strokeDashoffset: wakeFiring ? 0 : 170,
            transition: "stroke-dashoffset 0.6s cubic-bezier(.2,.7,.2,1)",
            opacity: wakeFiring ? 0.85 : 0,
          }}
        />
        <line
          x1="180"
          y1="290"
          x2="180"
          y2="430"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray="140"
          strokeLinecap="round"
          style={{
            strokeDashoffset: intentFiring ? 0 : 140,
            transition: "stroke-dashoffset 0.5s cubic-bezier(.2,.7,.2,1)",
            opacity: intentFiring ? 0.85 : 0,
          }}
        />
        <line
          x1="180"
          y1="430"
          x2="180"
          y2="560"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray="130"
          strokeLinecap="round"
          style={{
            strokeDashoffset: motionFiring ? 0 : 130,
            transition: "stroke-dashoffset 0.5s cubic-bezier(.2,.7,.2,1)",
            opacity: motionFiring ? 0.85 : 0,
          }}
        />

        {wakeFiring && (
          <circle cx="180" cy="120" r="4" fill="var(--accent)">
            <animate attributeName="r" values="4;7;4" dur="1s" repeatCount="indefinite" />
          </circle>
        )}
        {intentFiring && <circle cx="180" cy="290" r="4" fill="var(--accent)" />}
        {motionFiring && <circle cx="180" cy="430" r="4" fill="var(--accent)" />}
      </svg>

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, letterSpacing: "0.04em" }}>
            nubjuk<span style={{ color: "var(--accent)" }}>.viewer</span>
          </div>
          <ConnectionBadge state={connState} />
        </header>

        <section
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "20px 16px 16px",
            height: 168,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            flex: "0 0 auto",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--fg-faint)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            voice · {phase}
          </div>
          <VoiceVisualizer phase={phase} width={280} height={72} />
          <div style={{ fontSize: 13, color: "var(--fg-dim)", minHeight: "1.4em" }}>
            {phase === "idle" && "“헤이 넙죽아” 라고 말해보세요"}
            {phase === "listening" && <span style={{ color: "var(--accent)" }}>듣는 중…</span>}
            {phase === "executing" && "실행 중…"}
            {phase === "rejected" && <span style={{ color: "var(--error)" }}>인식 실패</span>}
          </div>
        </section>

        <section style={{ paddingTop: 12, minHeight: 116, flex: "0 0 auto" }}>
          <IntentPanel intent={intent} />
        </section>

        <section style={{ display: "flex", justifyContent: "center", paddingTop: 4, height: 28, flex: "0 0 auto" }}>
          <MotionChip motion={activeMotion?.name} status={motionStatus} />
        </section>

        <section
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            paddingTop: 8,
            height: 240,
            flex: "0 0 auto",
          }}
        >
          <NubjukViewer
            motion={motionStatus === "started" ? activeMotion : null}
            pose={currentPose}
            failed={motionStatus === "failed"}
            size={220}
          />
        </section>

        {showDevHint && (
          <footer
            style={{
              textAlign: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--fg-faint)",
              letterSpacing: "0.06em",
              paddingTop: 4,
            }}
          >
            default=B · ?layout=A|C · ?sequence=… · ?compare=1
          </footer>
        )}
      </div>
    </div>
  );
}
