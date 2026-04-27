"use client";

import { Suspense, useEffect, useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { VariationA } from "@/components/variations/VariationA";
import { VariationB } from "@/components/variations/VariationB";
import { VariationC } from "@/components/variations/VariationC";
import { MockViewerConnection } from "@/ws/MockViewerConnection";
import { WebMotionController } from "@/controller/WebMotionController";
import { ViewerStore } from "@/store/viewerStore";
import { IntentDispatcher } from "@/motion/intentDispatcher";
import { SEQUENCES, type SequenceKey } from "@/data/sequences";

type LayoutKey = "A" | "B" | "C";

const VALID_SEQUENCES: ReadonlySet<SequenceKey> = new Set<SequenceKey>([
  "sit-success",
  "low-confidence-reject",
  "motion-timeout-fail",
  "boot-id-change",
  "stale-motion",
]);

function PhoneFrame({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div
        style={{
          display: "inline-block",
          padding: 12,
          background: "#0a0a0a",
          borderRadius: 36,
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05) inset",
        }}
      >
        <div
          style={{
            width: 360,
            height: 720,
            borderRadius: 26,
            overflow: "hidden",
            background: "#fff",
            position: "relative",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 24,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0 18px",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--fg-dim)",
              zIndex: 100,
              background: "transparent",
              letterSpacing: "0.04em",
            }}
          >
            <span>9:41</span>
            <span>● ● ●</span>
          </div>
          <div style={{ height: "100%", paddingTop: 24, overflow: "auto" }}>{children}</div>
        </div>
      </div>
      {label && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            color: "var(--fg-dim)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

function pickLayout(raw: string | null): LayoutKey {
  const v = raw?.toUpperCase();
  if (v === "A" || v === "C") return v;
  return "B";
}

function pickSequence(raw: string | null): SequenceKey {
  if (raw && VALID_SEQUENCES.has(raw as SequenceKey)) return raw as SequenceKey;
  return "sit-success";
}

// 한 viewer 인스턴스 — Mock connection + motion controller + store + dispatcher.
function useViewerSession(sequenceKey: SequenceKey) {
  const session = useMemo(() => {
    const conn = new MockViewerConnection([], { loop: true, loopDelayMs: 2000 });
    const motion = new WebMotionController();
    const store = new ViewerStore();
    const dispatcher = new IntentDispatcher(conn, motion, store);
    return { conn, motion, store, dispatcher };
  }, []);

  // 첫 mount 시 connect, unmount 시 정리
  useEffect(() => {
    const meta = SEQUENCES[sequenceKey];
    session.conn.loadSequence(meta.steps, { loop: true, loopDelayMs: meta.loopDelayMs });
    void session.conn.connect("mock://nubjuk");
    return () => {
      session.dispatcher.dispose();
      session.conn.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // sequence 변경 시 reload
  useEffect(() => {
    const meta = SEQUENCES[sequenceKey];
    session.conn.loadSequence(meta.steps, { loop: true, loopDelayMs: meta.loopDelayMs });
  }, [sequenceKey, session]);

  return session.store;
}

function SingleVariation({ layout, sequenceKey }: { layout: LayoutKey; sequenceKey: SequenceKey }) {
  const store = useViewerSession(sequenceKey);
  if (layout === "A") return <VariationA store={store} />;
  if (layout === "C") return <VariationC store={store} />;
  return <VariationB store={store} />;
}

// compare mode — 3개 phone frame 각각 독립 store 인스턴스
function CompareView({ sequenceKey }: { sequenceKey: SequenceKey }) {
  const storeA = useViewerSession(sequenceKey);
  const storeB = useViewerSession(sequenceKey);
  const storeC = useViewerSession(sequenceKey);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 32,
        padding: 32,
        justifyContent: "center",
        minHeight: "100vh",
        background: "#ececec",
        alignItems: "flex-start",
      }}
    >
      <PhoneFrame label="A · Vertical Drop">
        <VariationA store={storeA} showDevHint={false} />
      </PhoneFrame>
      <PhoneFrame label="B · Paper Terminal">
        <VariationB store={storeB} />
      </PhoneFrame>
      <PhoneFrame label="C · Stage Spotlight">
        <VariationC store={storeC} />
      </PhoneFrame>
    </div>
  );
}

function Stage() {
  const params = useSearchParams();
  const layout = pickLayout(params.get("layout"));
  const sequenceKey = pickSequence(params.get("sequence"));
  const compare = params.get("compare") === "1";

  if (compare) return <CompareView sequenceKey={sequenceKey} />;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        minHeight: "100vh",
        padding: 24,
        background: "#ececec",
      }}
    >
      <PhoneFrame label={`${layout} · ${sequenceKey}`}>
        <SingleVariation layout={layout} sequenceKey={sequenceKey} />
      </PhoneFrame>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-mono)",
            color: "var(--fg-dim)",
          }}
        >
          loading…
        </div>
      }
    >
      <Stage />
    </Suspense>
  );
}
