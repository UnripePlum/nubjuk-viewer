"use client";

// Variation B — "Paper Terminal" 라이트 픽셀 아트 레트로
// 종이톤 + 그래프지 그리드 + 모노 폰트
// store-driven

import { useEffect, useState } from "react";
import { BrainStatusBadge, EStopBanner, failReasonLabel, NubjukViewer, ProtocolErrorBadge, VoiceVisualizer } from "../shared";
import type { ViewerStore } from "@/store/viewerStore";
import { useViewerStore } from "@/store/viewerStore";
import { selectIntentDisplay, selectVoicePhase, type IntentDisplay } from "@/store/selectors";

const B_INK       = "#1f2430";
const B_INK_DIM   = "#5b6473";
const B_INK_FAINT = "#9aa3b2";
const B_INK_GHOST = "#c8cfdb";
const B_PAPER     = "#f5f1e8";
const B_PAPER_2   = "#fbf8f0";
const B_GRID      = "rgba(31,36,48,0.045)";

interface Props {
  store: ViewerStore;
}

export function VariationB({ store }: Props) {
  const state = useViewerStore(store);
  const phase = selectVoicePhase(state);
  const intent = selectIntentDisplay(state);
  const { activeMotion, motionStatus, motionFailReason, currentPose, recentMessages, protocolErrors, lastBrainUnreachableAt } = state;
  const motionFiring = motionStatus === "started";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 480,
        minHeight: "100vh",
        background: B_PAPER,
        color: B_INK,
        padding: "16px 14px 20px",
        margin: "0 auto",
        position: "relative",
        fontFamily: "var(--font-mono)",
        overflow: "hidden",
        backgroundImage: `linear-gradient(${B_GRID} 1px, transparent 1px), linear-gradient(90deg, ${B_GRID} 1px, transparent 1px)`,
        backgroundSize: "16px 16px",
      }}
    >
      <EStopBanner motionStatus={motionStatus} failReason={motionFailReason} />
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: 12,
          borderBottom: `1px solid ${B_INK_GHOST}`,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", color: B_INK }}>
          <span style={{ color: B_INK_DIM }}>$</span> nubjuk<span style={{ color: "var(--accent)" }}>::viewer</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            maxWidth: "65%",
            rowGap: 4,
          }}
        >
          <BrainStatusBadge lastBrainUnreachableAt={lastBrainUnreachableAt} />
          <ProtocolErrorBadge count={protocolErrors.count} recent={protocolErrors.recent} />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              color: "#0d8a5e",
              letterSpacing: "0.1em",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                background: "#10b981",
                borderRadius: "50%",
                animation: "pulse-soft 2s ease-in-out infinite",
              }}
            />
            ESP·UP
          </div>
        </div>
      </header>

      <div style={{ fontSize: 10, color: B_INK_DIM, letterSpacing: "0.12em", marginBottom: 8 }}>
        [STATE]{" "}
        <span
          style={{
            color: phase === "rejected" ? "var(--error)" : "var(--accent)",
            fontWeight: 600,
          }}
        >
          {phase.toUpperCase()}
        </span>
      </div>

      <section
        style={{
          border: `1px solid ${B_INK_GHOST}`,
          borderRadius: 6,
          padding: "14px 12px 10px",
          marginBottom: 14,
          background: B_PAPER_2,
        }}
      >
        <div style={{ fontSize: 10, color: B_INK_FAINT, marginBottom: 6, letterSpacing: "0.1em" }}>
          ┌─ VOICE ──────────────┐
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <VoiceVisualizer phase={phase} width={260} height={56} />
        </div>
        <div
          style={{
            fontSize: 11,
            color: B_INK_DIM,
            marginTop: 8,
            textAlign: "center",
            minHeight: "1.4em",
          }}
        >
          {phase === "idle" && "// awaiting wake-word"}
          {phase === "listening" && <span style={{ color: "var(--accent)" }}>// capturing audio…</span>}
          {phase === "executing" && "// dispatching motion"}
          {phase === "rejected" && <span style={{ color: "var(--error)" }}>// rejected</span>}
        </div>
      </section>

      <section
        style={{
          border: `1px solid ${B_INK_GHOST}`,
          borderRadius: 6,
          padding: "12px 12px",
          marginBottom: 14,
          background: B_PAPER_2,
          height: 96,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: B_INK_FAINT,
            marginBottom: 6,
            letterSpacing: "0.1em",
          }}
        >
          <span>┌─ INTENT</span>
          {intent && !intent.rejected && (
            <span style={{ color: "var(--accent)" }}>conf·{(intent.confidence * 100).toFixed(0)}%</span>
          )}
        </div>
        <IntentLineDark intent={intent} />
      </section>

      <section
        style={{
          border: `1px solid ${B_INK_GHOST}`,
          borderRadius: 6,
          padding: "10px 12px 14px",
          marginBottom: 14,
          background: B_PAPER_2,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: B_INK_FAINT,
            marginBottom: 4,
            letterSpacing: "0.1em",
          }}
        >
          <span>┌─ MOTION</span>
          <span
            style={{
              color: motionFiring
                ? "var(--accent)"
                : motionStatus === "completed"
                ? "#0d8a5e"
                : motionStatus === "failed"
                ? "var(--error)"
                : B_INK_DIM,
              fontWeight: 600,
            }}
          >
            {activeMotion?.name?.toUpperCase() ?? "IDLE"} · {motionStatus === "failed" ? failReasonLabel(motionFailReason) : (motionStatus ?? "—").toUpperCase()}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: 220,
            position: "relative",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(0deg, transparent 0, transparent 3px, rgba(31,36,48,0.025) 3px, rgba(31,36,48,0.025) 4px)",
              pointerEvents: "none",
            }}
          />
          <NubjukViewer
            motion={motionFiring ? activeMotion : null}
            pose={currentPose}
            failed={motionStatus === "failed"}
            size={200}
          />
        </div>
        {activeMotion?.correlationId && (
          <div
            style={{
              fontSize: 9,
              color: B_INK_FAINT,
              textAlign: "center",
              letterSpacing: "0.1em",
            }}
          >
            cid·{activeMotion.correlationId}
          </div>
        )}
      </section>

      <section style={{ fontSize: 10, color: B_INK_DIM, lineHeight: 1.6, height: 96, overflow: "hidden" }}>
        <div style={{ marginBottom: 4, letterSpacing: "0.1em", color: B_INK_FAINT }}>┌─ TAIL</div>
        {recentMessages.slice(-4).map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <span style={{ color: B_INK_GHOST }}>›</span>
            <span style={{ color: B_INK_DIM }}>{m.type}</span>
            {m.type === "intent" && <span style={{ color: "var(--accent)" }}>{m.payload.intent}</span>}
            {m.type === "state" && <span style={{ color: "var(--accent)" }}>{m.payload.to}</span>}
            {m.type === "motion_started" && <span style={{ color: "var(--accent)" }}>{m.payload.intent}</span>}
            {m.type === "motion_failed" && <span style={{ color: "var(--error)" }}>{m.payload.reason}</span>}
            {m.type === "error" && <span style={{ color: "var(--error)" }}>{m.payload.code}</span>}
          </div>
        ))}
        {recentMessages.length === 0 && (
          <div style={{ color: B_INK_FAINT, fontStyle: "italic" }}>// no events</div>
        )}
      </section>
    </div>
  );
}

function IntentLineDark({ intent }: { intent: IntentDisplay | null }) {
  const text = intent?.raw ?? "";
  const [shown, setShown] = useState("");

  useEffect(() => {
    setShown("");
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [text]);

  if (!intent) {
    return (
      <div style={{ fontSize: 12, color: B_INK_FAINT, fontStyle: "italic", padding: "4px 0" }}>
        $ awaiting…
      </div>
    );
  }

  return (
    <div style={{ padding: "4px 0" }}>
      <div
        style={{
          fontSize: 13,
          color: intent.rejected ? "var(--error)" : B_INK,
          fontFamily: "var(--font-sans)",
        }}
      >
        <span style={{ color: B_INK_FAINT }}>›</span> {shown || (intent.rejected ? "(인식 실패)" : "")}
        {shown.length < text.length && (
          <span style={{ animation: "blink 0.8s step-end infinite", color: "var(--accent)" }}>▍</span>
        )}
      </div>
      {intent.rejected && (
        <div style={{ fontSize: 10, color: "var(--error)", marginTop: 4 }}>
          ! reason: {intent.reason ?? "unknown"}
        </div>
      )}
      {!intent.rejected && (
        <div style={{ marginTop: 8, fontSize: 9, color: B_INK_DIM, letterSpacing: "0.1em" }}>
          [
          <span style={{ color: "var(--accent)" }}>{"█".repeat(Math.round(intent.confidence * 14))}</span>
          {"·".repeat(14 - Math.round(intent.confidence * 14))}]
        </div>
      )}
    </div>
  );
}
