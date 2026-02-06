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
  if (state.isRunning) return;
  state.isRunning = true;
  try {
    await fetch(`${getBaseUrl()}/api/bluesky-comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Bluesky comment poller failed:", error);
  } finally {
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

  if (state.timer) return;

  void runOnce();

  state.timer = setInterval(() => {
    const now = Date.now();
    if (now > state.runningUntil) {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
      return;
    }
    void runOnce();
  }, intervalMs);
}
