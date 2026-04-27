"use client";

// Variation C — "Stage Spotlight"
// 넙죽이가 무대 주인공. radial spotlight + ring-out 펄스
// store-driven

import { useEffect, useState } from "react";
import { ConnectionBadge, MotionChip, NubjukViewer, VoiceVisualizer } from "../shared";
import type { ViewerStore } from "@/store/viewerStore";
import { useViewerStore } from "@/store/viewerStore";
import { selectIntentDisplay, selectVoicePhase, type IntentDisplay } from "@/store/selectors";

interface Props {
  store: ViewerStore;
}

export function VariationC({ store }: Props) {
  const state = useViewerStore(store);
  const phase = selectVoicePhase(state);
  const intent = selectIntentDisplay(state);
  const { activeMotion, motionStatus, currentPose, connectionState } = state;
  const motionFiring = motionStatus === "started";

  const connState =
    connectionState.kind === "connected"
      ? "connected"
      : connectionState.kind === "connecting" || connectionState.kind === "reconnecting"
      ? "connecting"
      : "disconnected";

  return (
    <div
      style={{
        width: 360,
        minHeight: 720,
        background: "#fafafa",
        padding: "16px 16px 20px",
        position: "relative",
        fontFamily: "var(--font-sans)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <ConnectionBadge state={connState} />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--fg-faint)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {phase}
        </div>
      </header>

      <section
        style={{
          flex: "0 0 auto",
          position: "relative",
          height: 380,
          margin: "12px -16px 16px",
          background: motionFiring
            ? "radial-gradient(circle at 50% 60%, var(--accent-soft) 0%, transparent 55%)"
            : phase === "rejected"
            ? "radial-gradient(circle at 50% 60%, #fef2f2 0%, transparent 55%)"
            : "radial-gradient(circle at 50% 60%, #f3f4f6 0%, transparent 55%)",
          transition: "background 0.6s",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {motionFiring && (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "60%",
                  width: 200,
                  height: 200,
                  marginLeft: -100,
                  marginTop: -100,
                  border: "1px solid var(--accent)",
                  borderRadius: "50%",
                  opacity: 0.4,
                  animation: "ring-out 1.8s ease-out infinite",
                  animationDelay: `${i * 0.6}s`,
                  pointerEvents: "none",
                }}
              />
            ))}
            <style>{`
              @keyframes ring-out {
                0%   { transform: scale(0.5); opacity: 0.5; }
                100% { transform: scale(1.6); opacity: 0; }
              }
            `}</style>
          </>
        )}

        <div style={{ position: "absolute", top: 24, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <VoiceVisualizer phase={phase} width={220} height={48} />
        </div>

        <div style={{ marginTop: 60 }}>
          <NubjukViewer
            motion={motionFiring ? activeMotion : null}
            pose={currentPose}
            failed={motionStatus === "failed"}
            size={220}
          />
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          {(activeMotion || motionStatus) && <MotionChip motion={activeMotion?.name} status={motionStatus} />}
        </div>
      </section>

      <section style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
        <IntentPanelBig intent={intent} phase={phase} />
      </section>
    </div>
  );
}

function IntentPanelBig({ intent, phase }: { intent: IntentDisplay | null; phase: string }) {
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
    }, 55);
    return () => clearInterval(id);
  }, [text]);

  const empty = !intent;
  const rejected = intent?.rejected;

  return (
    <div
      style={{
        padding: "20px 18px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        height: 152,
        position: "relative",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -2,
          left: 14,
          fontSize: 56,
          lineHeight: 1,
          color: "var(--accent-soft)",
          fontFamily: "Georgia, serif",
          fontWeight: 700,
          pointerEvents: "none",
        }}
      >
        “
      </div>

      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-faint)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 10,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>intent</span>
        {!empty && !rejected && intent && (
          <span style={{ color: "var(--accent)" }}>
            {intent.intent} · {(intent.confidence * 100).toFixed(0)}%
          </span>
        )}
        {rejected && <span style={{ color: "var(--error)" }}>rejected</span>}
      </div>

      {empty && (
        <div style={{ color: "var(--fg-faint)", fontSize: 16 }}>
          {phase === "listening" ? "듣고 있어요…" : "“헤이 넙죽아” 라고 말해보세요"}
        </div>
      )}
      {!empty && (
        <div
          style={{
            fontSize: 22,
            lineHeight: 1.3,
            fontWeight: 500,
            color: rejected ? "var(--error)" : "var(--fg)",
            minHeight: "1.3em",
            letterSpacing: "-0.01em",
          }}
        >
          {shown || (rejected ? "(인식 실패)" : "")}
          {shown.length < text.length && (
            <span style={{ animation: "blink 0.8s step-end infinite", color: "var(--accent)", fontWeight: 400 }}>▍</span>
          )}
        </div>
      )}

      {rejected && intent && (
        <div style={{ fontSize: 12, color: "var(--fg-dim)", fontFamily: "var(--font-mono)", marginTop: 8 }}>
          reason: {intent.reason ?? "unknown"}
        </div>
      )}

      {!empty && !rejected && intent && (
        <div style={{ marginTop: 14, height: 3, borderRadius: 999, background: "var(--accent-soft)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${intent.confidence * 100}%`,
              background: "var(--accent)",
              transition: "width 0.4s cubic-bezier(.2,.7,.2,1)",
            }}
          />
        </div>
      )}
    </div>
  );
}
