"use client";

// Pose engine 시각화 — Unity Animator 풍 node + line graph.
// SVG + foreignObject로 button을 SVG 좌표계 안에 두어 line과 1:1 align.

import type { MotionName } from "@/data/motion-registry";
import { useViewerStore, type ViewerStore } from "@/store/viewerStore";
import type { ViewerConnection } from "@/ws/ViewerConnection";

type Category = "root" | "persistent" | "reset" | "transient";

interface NodeSpec {
  x: number;
  y: number;
  category: Category;
}

const W = 400;
const H = 360;
const NODE_W = 92;
const NODE_H = 30;
const ANCHOR_GAP = 4;

// Layout: idle 위, 좌측 sit/stand chain, 중앙 hand, 우측 transient column.
const NODES: Record<MotionName, NodeSpec> = {
  idle:       { x: 200, y: 40,  category: "root" },
  sit:        { x: 70,  y: 140, category: "persistent" },
  stand:      { x: 70,  y: 220, category: "reset" },
  hand:       { x: 200, y: 140, category: "persistent" },
  roll_left:  { x: 330, y: 140, category: "transient" },
  roll_right: { x: 330, y: 220, category: "transient" },
  surprise:   { x: 330, y: 300, category: "transient" },
};

const ALL: MotionName[] = ["idle", "sit", "hand", "stand", "roll_left", "roll_right", "surprise"];

interface Props {
  store: ViewerStore;
  conn: ViewerConnection;
}

export function PoseEnginePanel({ store, conn }: Props) {
  const currentPose = useViewerStore(store, (s) => s.currentPose);
  const motionStatus = useViewerStore(store, (s) => s.motionStatus);
  const activeMotion = useViewerStore(store, (s) => s.activeMotion);
  const isRunning = motionStatus === "started";
  const runningName = isRunning ? activeMotion?.name : undefined;

  const trigger = (m: MotionName) => {
    conn.send({ v: 1, type: "manual_trigger", payload: { intent: m, slots: {} } });
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: W,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "16px 14px 14px",
        fontFamily: "var(--font-mono)",
        color: "var(--fg)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          color: "var(--fg-faint)",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        ┌─ pose engine
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 10,
          paddingBottom: 10,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.08em" }}>now</span>
        <span style={{ fontSize: 18, fontWeight: 600, color: "var(--accent)", fontFamily: "var(--font-sans)" }}>
          {currentPose}
        </span>
        {runningName && (
          <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--accent)" }}>
            ▶ {runningName}
          </span>
        )}
      </div>

      <Graph runningName={runningName} currentPose={currentPose} onTrigger={trigger} />

      <div
        style={{
          fontSize: 9,
          color: "var(--fg-faint)",
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid var(--border)",
          letterSpacing: "0.06em",
          lineHeight: 1.5,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span>
          <span style={{ color: "var(--accent)" }}>●</span> persistent (loop)
        </span>
        <span>
          <span style={{ color: "var(--fg-dim)" }}>●</span> reset (→idle)
        </span>
        <span>
          <span style={{ color: "var(--fg-faint)" }}>●</span> transient (--→prev)
        </span>
      </div>
      <div style={{ fontSize: 9, color: "var(--fg-faint)", marginTop: 6, letterSpacing: "0.06em" }}>
        클릭 시 진행 시퀀스 중단 후 해당 motion 단발 재생.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Graph (SVG + foreignObject buttons)
// ─────────────────────────────────────────────
function Graph({
  runningName,
  currentPose,
  onTrigger,
}: {
  runningName: string | undefined;
  currentPose: string;
  onTrigger: (m: MotionName) => void;
}) {
  const STROKE = "var(--border-strong)";
  const STROKE_ACTIVE = "var(--accent)";

  const bot = (n: MotionName) => ({ x: NODES[n].x, y: NODES[n].y + NODE_H / 2 + ANCHOR_GAP });
  const top = (n: MotionName) => ({ x: NODES[n].x, y: NODES[n].y - NODE_H / 2 - ANCHOR_GAP });
  const leftAnchor = (n: MotionName) => ({ x: NODES[n].x - NODE_W / 2 - ANCHOR_GAP, y: NODES[n].y });
  const rightAnchor = (n: MotionName) => ({ x: NODES[n].x + NODE_W / 2 + ANCHOR_GAP, y: NODES[n].y });

  type EdgeType = "trigger" | "loop" | "back-idle" | "back-prev" | "chain";
  const edges: { d: string; type: EdgeType; target: MotionName }[] = [];

  // idle → 6 motions
  const idleAnchor = bot("idle");
  for (const m of ALL) {
    if (m === "idle") continue;
    const t = top(m);
    const midY = (idleAnchor.y + t.y) / 2;
    edges.push({
      d: `M ${idleAnchor.x} ${idleAnchor.y} C ${idleAnchor.x} ${midY}, ${t.x} ${midY}, ${t.x} ${t.y}`,
      type: "trigger",
      target: m,
    });
  }

  // sit → stand sequential
  {
    const sB = bot("sit");
    const sT = top("stand");
    edges.push({
      d: `M ${sB.x} ${sB.y} L ${sT.x} ${sT.y}`,
      type: "chain",
      target: "stand",
    });
  }

  // persistent self-loops (sit, hand)
  for (const m of ["sit", "hand"] as MotionName[]) {
    const r = rightAnchor(m);
    edges.push({
      d: `M ${r.x} ${r.y - 6} C ${r.x + 22} ${r.y - 14}, ${r.x + 22} ${r.y + 14}, ${r.x} ${r.y + 6}`,
      type: "loop",
      target: m,
    });
  }

  // stand → idle (left side curve back up)
  {
    const sL = leftAnchor("stand");
    const iL = leftAnchor("idle");
    edges.push({
      d: `M ${sL.x} ${sL.y} C ${sL.x - 30} ${sL.y - 30}, ${iL.x - 30} ${iL.y + 30}, ${iL.x} ${iL.y}`,
      type: "back-idle",
      target: "stand",
    });
  }

  // transient back-prev (small dashed loops)
  for (const m of ["roll_left", "roll_right", "surprise"] as MotionName[]) {
    const l = leftAnchor(m);
    edges.push({
      d: `M ${l.x} ${l.y} C ${l.x - 14} ${l.y + 14}, ${l.x - 14} ${l.y + 26}, ${l.x - 2} ${l.y + 30}`,
      type: "back-prev",
      target: m,
    });
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMin meet"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE} />
        </marker>
        <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE_ACTIVE} />
        </marker>
      </defs>

      {edges.map((e, i) => {
        // running motion의 *결과* edge만 active 표시:
        //   sit/hand running → self loop active (persistent)
        //   stand running    → back-idle arc active (reset)
        //   roll_*/surprise  → back-prev dashed active (transient)
        // trigger (idle → motion)와 chain (sit → stand)은 항상 정적.
        const isActive =
          runningName === e.target &&
          (e.type === "loop" || e.type === "back-idle" || e.type === "back-prev");
        const isDashed = e.type === "back-prev";
        const isLoop = e.type === "loop";
        return (
          <path
            key={i}
            d={e.d}
            stroke={isActive ? STROKE_ACTIVE : STROKE}
            strokeWidth={isActive ? 1.8 : 1}
            fill="none"
            strokeDasharray={isDashed ? "3 3" : isLoop ? "2 2" : undefined}
            markerEnd={isActive ? "url(#arrow-active)" : "url(#arrow)"}
            style={{
              opacity: isActive ? 1 : isDashed || isLoop ? 0.55 : 0.75,
              transition: "stroke 0.2s, opacity 0.2s",
            }}
          />
        );
      })}

      {ALL.map((name) => {
        const spec = NODES[name];
        return (
          <SvgNode
            key={name}
            name={name}
            spec={spec}
            isCurrent={currentPose === name}
            isRunning={runningName === name}
            onClick={() => onTrigger(name)}
          />
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────
// SVG-native node (rect + text + click). HTML button 대신 SVG group.
// ─────────────────────────────────────────────
function SvgNode({
  name,
  spec,
  isCurrent,
  isRunning,
  onClick,
}: {
  name: MotionName;
  spec: NodeSpec;
  isCurrent: boolean;
  isRunning: boolean;
  onClick: () => void;
}) {
  const catColor: Record<Category, string> = {
    root: "var(--fg)",
    persistent: "var(--accent)",
    reset: "var(--fg-dim)",
    transient: "var(--fg-faint)",
  };
  const dotColor = catColor[spec.category];

  const bg = isRunning ? "var(--accent)" : isCurrent ? "var(--accent-soft)" : "var(--surface)";
  const fg = isRunning ? "#ffffff" : isCurrent ? "var(--accent)" : "var(--fg)";
  const border = isRunning || isCurrent ? "var(--accent)" : "var(--border-strong)";

  const x = spec.x - NODE_W / 2;
  const y = spec.y - NODE_H / 2;
  const dotX = x + 12;
  const textX = x + 22;

  return (
    <g
      onClick={onClick}
      style={{ cursor: "pointer" }}
      role="button"
      aria-label={`${spec.category} ${name}`}
    >
      <title>{`${spec.category} · ${name}`}</title>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={6}
        fill={bg}
        stroke={border}
        strokeWidth={1}
        style={{
          transition: "fill 0.15s, stroke 0.15s",
          filter: isRunning ? "drop-shadow(0 0 8px var(--accent-soft))" : "none",
        }}
      />
      <circle cx={dotX} cy={spec.y} r={2.5} fill={isRunning ? "#ffffff" : dotColor} />
      <text
        x={textX}
        y={spec.y}
        fontSize={11}
        fontFamily="var(--font-mono)"
        fontWeight={spec.category === "root" ? 600 : 500}
        fill={fg}
        dominantBaseline="middle"
        style={{ userSelect: "none", transition: "fill 0.15s" }}
      >
        {name}
      </text>
    </g>
  );
}
