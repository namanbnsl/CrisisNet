type PollerState = {
  timer: NodeJS.Timeout | null;
  runningUntil: number;
  isRunning: boolean;
};

const GLOBAL_KEY = "__bskyCommentsPollerState";

function getState(): PollerState {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: PollerState };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { timer: null, runningUntil: 0, isRunning: false };
  }
  return g[GLOBAL_KEY]!;
}

function getBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  return "http://localhost:3000";
}

async function runOnce() {
  const state = getState();
  if (state.isRunning) {
    console.log("Bluesky comment poller: skip run (already running)");
    return;
  }
  state.isRunning = true;
  const startedAt = Date.now();
  console.log("Bluesky comment poller: run start");
  try {
    await fetch(`${getBaseUrl()}/api/bluesky-comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    console.log("Bluesky comment poller: run success");
  } catch (error) {
    console.error("Bluesky comment poller failed:", error);
  } finally {
    const elapsedMs = Date.now() - startedAt;
    console.log(`Bluesky comment poller: run end (${elapsedMs}ms)`);
    state.isRunning = false;
  }
}

export function startBlueskyCommentPolling(options?: {
  durationMs?: number;
  intervalMs?: number;
}) {
  const durationMs = options?.durationMs ?? 10 * 60 * 1000;
  const intervalMs = options?.intervalMs ?? 10 * 1000;
  const state = getState();

  state.runningUntil = Math.max(state.runningUntil, Date.now() + durationMs);

  if (state.timer) {
    console.log(
      `Bluesky comment poller: already running (interval ${intervalMs}ms, running until ${new Date(
        state.runningUntil,
      ).toISOString()})`,
    );
    return;
  }

  console.log(
    `Bluesky comment poller: start (interval ${intervalMs}ms, running until ${new Date(
      state.runningUntil,
    ).toISOString()})`,
  );
  void runOnce();

  state.timer = setInterval(() => {
    const now = Date.now();
    if (now > state.runningUntil) {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
      console.log("Bluesky comment poller: stopped (duration elapsed)");
      return;
    }
    void runOnce();
  }, intervalMs);
}
