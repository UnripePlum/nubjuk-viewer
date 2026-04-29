"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VariationA } from "@/components/variations/VariationA";
import { VariationB } from "@/components/variations/VariationB";
import { VariationC } from "@/components/variations/VariationC";
import { PoseEnginePanel } from "@/components/PoseEnginePanel";
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

function pickLayout(raw: string | null): LayoutKey {
  const v = raw?.toUpperCase();
  if (v === "A" || v === "C") return v;
  return "B";
}

function pickSequence(raw: string | null): SequenceKey {
  if (raw && VALID_SEQUENCES.has(raw as SequenceKey)) return raw as SequenceKey;
  return "sit-success";
}

interface Session {
  conn: MockViewerConnection;
  motion: WebMotionController;
  store: ViewerStore;
  dispatcher: IntentDispatcher;
}

function useViewerSession(sequenceKey: SequenceKey): Session {
  // useState lazy init은 strict mode에서도 한 번만 실행되며 캐시된 동일 인스턴스를 반환.
  // useMemo와 달리 effect cleanup에서 dispatcher.dispose()를 호출해도 두 번째 mount에서
  // dispatcher가 살아있는 보장이 깨지지 않음.
  const [session] = useState<Session>(() => {
    const conn = new MockViewerConnection([], { loop: true, loopDelayMs: 2000 });
    const motion = new WebMotionController();
    const store = new ViewerStore();
    const dispatcher = new IntentDispatcher(conn, motion, store);
    return { conn, motion, store, dispatcher };
  });

  // unmount cleanup: conn 종료 + motion watchdog 정리. dispatcher는 page lifetime 동안 살아있음 (page unmount = GC).
  // motion.stop()을 안 부르면 watchdog setTimeout이 unmount 후에도 ticking → 고아 store에 emit (Codex P2 fix).
  useEffect(() => {
    void session.conn.connect("mock://nubjuk");
    return () => {
      session.conn.disconnect();
      session.motion.stop();
    };
  }, [session]);

  useEffect(() => {
    const meta = SEQUENCES[sequenceKey];
    session.conn.loadSequence(meta.steps, { loop: true, loopDelayMs: meta.loopDelayMs });
  }, [sequenceKey, session]);

  return session;
}

function VariationByLayout({
  layout,
  store,
}: {
  layout: LayoutKey;
  store: ViewerStore;
}) {
  if (layout === "A") return <VariationA store={store} />;
  if (layout === "C") return <VariationC store={store} />;
  return <VariationB store={store} />;
}

function SingleView({ layout, sequenceKey }: { layout: LayoutKey; sequenceKey: SequenceKey }) {
  const { store, conn } = useViewerSession(sequenceKey);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 24,
        padding: 24,
        alignItems: "flex-start",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg)",
      }}
    >
      <div style={{ flex: "1 1 360px", maxWidth: 480, alignSelf: "stretch" }}>
        <VariationByLayout layout={layout} store={store} />
      </div>
      <div style={{ flex: "0 1 400px", maxWidth: 400, alignSelf: "flex-start" }}>
        <PoseEnginePanel store={store} conn={conn} />
      </div>
    </div>
  );
}

function CompareView({ sequenceKey }: { sequenceKey: SequenceKey }) {
  const a = useViewerSession(sequenceKey);
  const b = useViewerSession(sequenceKey);
  const c = useViewerSession(sequenceKey);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
        gap: 24,
        padding: 24,
        minHeight: "100vh",
        background: "var(--bg)",
        alignItems: "start",
      }}
    >
      <CompareCell label="A · Vertical Drop">
        <VariationA store={a.store} showDevHint={false} />
      </CompareCell>
      <CompareCell label="B · Paper Terminal">
        <VariationB store={b.store} />
      </CompareCell>
      <CompareCell label="C · Stage Spotlight">
        <VariationC store={c.store} />
      </CompareCell>
      <CompareCell label="Pose Engine (B 연결)">
        <PoseEnginePanel store={b.store} conn={b.conn} />
      </CompareCell>
    </div>
  );
}

function CompareCell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        {label}
      </div>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--surface)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Stage() {
  const params = useSearchParams();
  const layout = pickLayout(params.get("layout"));
  const sequenceKey = pickSequence(params.get("sequence"));
  const compare = params.get("compare") === "1";

  if (compare) return <CompareView sequenceKey={sequenceKey} />;
  return <SingleView layout={layout} sequenceKey={sequenceKey} />;
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
