"use client";

// 공유 컴포넌트 — 모든 변형이 사용
// ConnectionBadge / VoiceVisualizer / IntentPanel / NubjukViewer / MotionChip

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MOTION_REGISTRY, type MotionName } from "@/data/motion-registry";
import type { Pose } from "@/data/pose-engine";
import type { ActiveMotion, MotionUiStatus } from "@/store/viewerStore";
import type { IntentDisplay } from "@/store/selectors";
import type { MotionFailReason } from "@/types/protocol";
import { brainStatusRemainingS, brainStatusVisible } from "@/data/brainStatus";

// ───────────────────────────────────────────
// Connection Badge
// ───────────────────────────────────────────
export type ConnectionUiState = "connecting" | "connected" | "disconnected";

const CONNECTION_MAP: Record<ConnectionUiState, { dot: string; label: string }> = {
  connecting:   { dot: "var(--fg-dim)",  label: "ESP 연결 중…" },
  connected:    { dot: "var(--success)", label: "연결됨" },
  disconnected: { dot: "var(--error)",   label: "연결 끊김" },
};

export function ConnectionBadge({ state = "connected" }: { state?: ConnectionUiState }) {
  const cfg = CONNECTION_MAP[state];
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--fg-dim)",
        letterSpacing: "0.02em",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: cfg.dot,
          animation: state === "connected" ? "pulse-soft 2.4s ease-in-out infinite" : undefined,
        }}
      />
      <span>{cfg.label}</span>
    </div>
  );
}

// ───────────────────────────────────────────
// VoiceVisualizer — SVG waveform morphing
// ───────────────────────────────────────────
export type VoicePhase = "idle" | "listening" | "wake" | "rejected" | "executing" | string;

export function VoiceVisualizer({
  phase = "idle",
  width = 200,
  height = 64,
}: {
  phase?: VoicePhase;
  width?: number;
  height?: number;
}) {
  const [t, setT] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const bars = 13;
  const cy = height / 2;
  const slot = width / (bars + 1);
  const barW = Math.max(3, slot * 0.45);

  const amp = (i: number): number => {
    const center = (bars - 1) / 2;
    const dist = Math.abs(i - center);
    const falloff = Math.exp(-(dist * dist) / 14);

    if (phase === "idle") {
      return 4 + Math.sin(t * 1.6 + i * 0.5) * 1.5 * falloff;
    }
    if (phase === "listening") {
      const noise =
        Math.sin(t * 5.3 + i * 0.9) * 0.5 +
        Math.sin(t * 9.1 + i * 1.3) * 0.3 +
        Math.sin(t * 13.7 + i * 0.4) * 0.2;
      return 6 + (Math.abs(noise) * 18 + 6) * falloff;
    }
    if (phase === "wake") {
      const wave = Math.exp(-Math.pow(t * 1.5 - dist * 0.3, 2) * 2);
      return 4 + wave * 22;
    }
    if (phase === "rejected") {
      return 3 + Math.sin(t * 22 + i) * 1.5 * falloff;
    }
    if (phase === "executing") {
      return 4 + falloff * 4;
    }
    return 4;
  };

  const color =
    phase === "rejected" ? "var(--error)" :
    phase === "listening" || phase === "wake" ? "var(--accent)" :
    "var(--fg-faint)";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`음성 상태: ${phase}`}
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {Array.from({ length: bars }).map((_, i) => {
          const a = Math.min(amp(i), height / 2 - 2);
          const x = slot * (i + 1) - barW / 2;
          return (
            <rect
              key={i}
              x={x}
              y={cy - a}
              width={barW}
              height={a * 2}
              rx={barW / 2}
              fill={color}
              style={{ transition: "fill 0.3s" }}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ───────────────────────────────────────────
// IntentPanel — 타이핑 reveal + confidence bar
// ───────────────────────────────────────────
export function IntentPanel({
  intent,
  variant = "card",
}: {
  intent: IntentDisplay | null;
  variant?: "card" | "ghost";
}) {
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

  const empty = !intent;
  const rejected = intent?.rejected;
  const conf = intent?.confidence ?? 0;

  return (
    <div
      style={{
        width: "100%",
        padding: "14px 16px",
        background: variant === "ghost" ? "transparent" : "var(--surface)",
        border: variant === "ghost" ? "1px dashed var(--border)" : "1px solid var(--border)",
        borderRadius: 12,
        height: 104,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--fg-faint)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <span>intent</span>
        {intent && !rejected && (
          <span style={{ color: "var(--fg-dim)" }}>
            {intent.intent} · {(conf * 100).toFixed(0)}%
          </span>
        )}
        {rejected && <span style={{ color: "var(--error)" }}>rejected</span>}
      </div>

      {empty && (
        <div style={{ color: "var(--fg-faint)", fontSize: 15 }}>…명령을 기다리는 중</div>
      )}
      {!empty && (
        <div
          style={{
            fontSize: 18,
            lineHeight: 1.35,
            fontWeight: 500,
            color: rejected ? "var(--error)" : "var(--fg)",
            minHeight: "1.35em",
          }}
        >
          “{shown}
          {shown.length < text.length && (
            <span style={{ animation: "blink 0.8s step-end infinite", color: "var(--accent)" }}>▍</span>
          )}
          ”
        </div>
      )}
      {rejected && intent && (
        <div style={{ fontSize: 12, color: "var(--fg-dim)", fontFamily: "var(--font-mono)" }}>
          reason: {intent.reason}
        </div>
      )}
      {!empty && !rejected && (
        <div
          style={{
            height: 4,
            borderRadius: 999,
            background: "var(--accent-soft)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${conf * 100}%`,
              background: "var(--accent)",
              transition: "width 0.4s cubic-bezier(.2,.7,.2,1)",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────
// NubjukViewer — 단일 active GIF만 render. 새 motion(cid)마다 src에 cid query 붙여 *새 URL*로 fetch
// → 브라우저가 새 GIF instance로 처리 → frame 1부터 decode 보장.
// preloader는 의도적으로 두지 않음. preloader가 있으면 cache instance 공유로 mid-cycle frame 발생 가능.
// ───────────────────────────────────────────
const NUBJUK_NAMES: MotionName[] = ["idle", "sit", "stand", "roll_left", "roll_right", "surprise", "hand"];
void NUBJUK_NAMES; // reserved for future preload via Cache API if needed

export function NubjukViewer({
  motion = null,
  pose = "idle",
  failed = false,
  size = 220,
}: {
  motion?: ActiveMotion | null;
  pose?: Pose;
  failed?: boolean;
  size?: number;
}) {
  const [progress, setProgress] = useState(0);
  const motionRef = useRef(motion);
  motionRef.current = motion;

  useEffect(() => {
    if (!motion) {
      setProgress(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      const m = motionRef.current;
      if (!m) return;
      const elapsed = performance.now() - m.startedAt;
      const p = Math.min(1, elapsed / m.durationMs);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [motion?.correlationId]);

  const activeName: MotionName = (motion?.name ?? pose ?? "idle") as MotionName;
  const imgSize = Math.round(size * 0.82);
  const entry = MOTION_REGISTRY[activeName] ?? MOTION_REGISTRY.idle;
  // motion이 진행 중이면 cid로, 아니면 pose name으로 key. src에도 cid query 붙여 *새 URL* 강제 (frame 1 보장).
  const remountKey = motion ? `${activeName}::${motion.correlationId}` : `pose::${activeName}`;
  const imgSrc = motion ? `${entry.gif}?cid=${encodeURIComponent(motion.correlationId)}` : entry.gif;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {motion && !failed && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -8,
            borderRadius: "50%",
            background: "radial-gradient(circle, var(--accent-soft) 0%, transparent 65%)",
            animation: "pulse-soft 1.2s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      )}

      <div style={{ position: "relative", width: imgSize, height: imgSize, zIndex: 1 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={remountKey}
          src={imgSrc}
          alt={`넙죽이 ${activeName} 모션`}
          width={imgSize}
          height={imgSize}
          style={{
            display: "block",
            imageRendering: "pixelated",
            filter: failed ? "grayscale(0.6)" : "none",
            transition: "filter 0.4s",
            pointerEvents: "none",
          }}
        />
      </div>

      {failed && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 100 100">
            <line x1="20" y1="20" x2="80" y2="80" stroke="var(--error)" strokeWidth="6" strokeLinecap="round" />
            <line x1="80" y1="20" x2="20" y2="80" stroke="var(--error)" strokeWidth="6" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {motion && !failed && (
        <div
          style={{
            position: "absolute",
            bottom: 4,
            left: "10%",
            right: "10%",
            height: 3,
            background: "var(--accent-soft)",
            borderRadius: 999,
            overflow: "hidden",
            zIndex: 3,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress * 100}%`,
              background: "var(--accent)",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────
// ProtocolErrorBadge — schema/parse 위반 카운터 + 최근 메시지 hover
// Phase 2 Gate: 위반 발생 시 UI 표시 의무
// ───────────────────────────────────────────
export function ProtocolErrorBadge({
  count,
  recent,
}: {
  count: number;
  recent: readonly string[];
}) {
  if (count === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      title={recent.slice(-5).join("\n") || `${count} protocol errors`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 999,
        background: "#fef2f2",
        color: "var(--error)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        border: "1px solid #fecaca",
        cursor: "help",
      }}
    >
      <span aria-hidden="true">⚠</span>
      <span>proto·{count}</span>
    </div>
  );
}

// ───────────────────────────────────────────
// Motion label chip — reason별 시각 차별화 (Phase 3)
// ───────────────────────────────────────────
const CHIP_MAP: Record<NonNullable<MotionUiStatus>, { color: string; bg: string; label: string }> = {
  started:   { color: "var(--accent)",  bg: "var(--accent-soft)", label: "RUNNING" },
  completed: { color: "var(--success)", bg: "#ecfdf5",            label: "DONE" },
  failed:    { color: "var(--error)",   bg: "#fef2f2",            label: "FAILED" },
  cancelled: { color: "var(--fg-dim)",  bg: "var(--bg)",          label: "CANCELLED" },
};

// motion_failed.reason → 시각 (Phase 3 motion_serial → hardware 전환 대비).
// MotionFailReason exhaustive — 신규 reason 추가 시 컴파일러가 누락 알림.
const FAIL_REASON_DISPLAY: Record<MotionFailReason, { label: string; emphasis: boolean }> = {
  timeout:      { label: "TIMEOUT",   emphasis: false },
  hardware:     { label: "HW·FAIL",   emphasis: true  },
  e_stop:       { label: "E·STOP",    emphasis: true  },
  precondition: { label: "PRECOND",   emphasis: false },
  unknown:      { label: "UNKNOWN",   emphasis: false },
};

// reason → 표시 label (B variation의 inline rendering도 같은 mapping 사용 — A/C와 일관성).
export function failReasonLabel(reason: MotionFailReason | null | undefined): string {
  if (!reason) return "FAILED";
  return FAIL_REASON_DISPLAY[reason]?.label ?? reason.toUpperCase();
}

export function MotionChip({
  motion,
  status,
  failReason,
}: {
  motion?: string | null;
  status: MotionUiStatus;
  failReason?: MotionFailReason | null;
}) {
  if (!motion && !status) return null;
  const cfg = status ? CHIP_MAP[status] : { color: "var(--fg-dim)", bg: "var(--bg)", label: "—" };

  // failed 상태에서 reason 정보가 있으면 label에 끼워넣기
  const reasonInfo =
    status === "failed" && failReason ? FAIL_REASON_DISPLAY[failReason] : undefined;
  const finalLabel = reasonInfo ? reasonInfo.label : cfg.label;
  const emphasized = reasonInfo?.emphasis ?? false;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        borderRadius: 999,
        background: cfg.bg,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        color: cfg.color,
        border: `1px solid ${emphasized ? cfg.color : `${cfg.color}22`}`,
        fontWeight: emphasized ? 700 : 500,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: cfg.color,
          animation: status === "started"
            ? "pulse-soft 1s ease-in-out infinite"
            : emphasized
            ? "pulse-soft 0.8s ease-in-out infinite"
            : undefined,
        }}
      />
      <span>{motion ?? "—"}</span>
      <span style={{ opacity: 0.6 }}>·</span>
      <span>{finalLabel}</span>
    </div>
  );
}

// ───────────────────────────────────────────
// BrainStatusBadge — brain dual ↔ mcu fallback informational (Phase 4)
// error{code:"brain_unreachable"} 수신 후 5초간 표시, 그 후 자동 dismiss.
// 시간 계산은 src/data/brainStatus.ts 순수 helper로 위임 — 단위 테스트 가능.
// ───────────────────────────────────────────

export function BrainStatusBadge({ lastBrainUnreachableAt }: { lastBrainUnreachableAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (lastBrainUnreachableAt === null) return;
    setNow(Date.now());
    if (!brainStatusVisible(lastBrainUnreachableAt, Date.now())) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!brainStatusVisible(lastBrainUnreachableAt, t)) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [lastBrainUnreachableAt]);

  if (!brainStatusVisible(lastBrainUnreachableAt, now)) return null;
  const remainingS = brainStatusRemainingS(lastBrainUnreachableAt, now);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: 999,
        background: "#fffbeb",
        color: "#b45309",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        border: "1px solid #fde68a",
      }}
      title={`brain unreachable ${remainingS}s remaining`}
    >
      <span aria-hidden="true">⚡</span>
      <span>brain·fallback</span>
      <span style={{ opacity: 0.6 }}>·{remainingS}s</span>
    </div>
  );
}

// ───────────────────────────────────────────
// EStopBanner — e-stop 발생 시 빨간 배너 (Phase 3)
// motionStatus === 'failed' && reason === 'e_stop'일 때만 노출.
// 다음 motion_started로 motionStatus 바뀌면 자동 dismiss.
// ───────────────────────────────────────────
export function EStopBanner({
  motionStatus,
  failReason,
}: {
  motionStatus: MotionUiStatus;
  failReason: MotionFailReason | null;
}) {
  if (motionStatus !== "failed" || failReason !== "e_stop") return null;
  // pulse-soft 사용 X — 전체 banner를 fade하면 비상 알림 가시성이 오히려 약해짐 (Codex P3).
  // diagonal hazard stripe만 슬라이드 → 텍스트는 항상 100% opacity로 명료.
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        background:
          "repeating-linear-gradient(45deg, var(--error) 0 12px, #b91c1c 12px 24px)",
        backgroundSize: "34px 34px",
        color: "#ffffff",
        padding: "10px 16px",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        textAlign: "center",
        zIndex: 50,
        boxShadow: "0 2px 8px rgba(220, 38, 38, 0.4)",
        animation: "estop-stripe 1.2s linear infinite",
      }}
    >
      ⚠ E-STOP · 비상정지 발동
    </div>
  );
}
