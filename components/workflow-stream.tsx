"use client";

import { useRef, useState } from "react";
import { connectors, webrtc, streams } from "@roboflow/inference-sdk";

type Prediction = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
};

export function WorkflowStream() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const connectionRef = useRef<Awaited<
    ReturnType<typeof webrtc.useStream>
  > | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  async function start() {
    setConnecting(true);
    try {
      // ⚠️ Testing only - exposes API key in frontend. Use a backend proxy in production
      const connector = connectors.withApiKey(
        process.env.NEXT_PUBLIC_ROBOFLOW_API_KEY!,
        {
          serverUrl: "https://serverless.roboflow.com",
        },
      );
      const stream = await streams.useCamera({
        video: { facingMode: "environment" },
      });

      connectionRef.current = await webrtc.useStream({
        source: stream,
        connector,
        wrtcParams: {
          workspaceName: "namanb",
          workflowId: "crisisnet-hf-model",
          streamOutputNames: ["output_image"],
          dataOutputNames: ["predictions"],
          processingTimeout: 600,
          requestedPlan: "webrtc-gpu-medium", // Options: webrtc-gpu-small, webrtc-gpu-medium, webrtc-gpu-large
          requestedRegion: "us", // Options: us, eu, ap
        },
        onData: (data) => {
          console.log("Predictions:", data);
          const start = performance.now();
          const dataObj = data as unknown as Record<string, unknown>;
          if (dataObj?.predictions && Array.isArray(dataObj.predictions)) {
            setPredictions(dataObj.predictions as Prediction[]);
          }
          setLatencyMs(Math.round(performance.now() - start));
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = await connectionRef.current.remoteStream();
      }
      setStreaming(true);
    } catch (error) {
      console.error("Failed to start stream:", error);
    } finally {
      setConnecting(false);
    }
  }

  function stop() {
    connectionRef.current?.cleanup();
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPredictions([]);
    setLatencyMs(null);
    setStreaming(false);
  }

  const status = connecting ? "Connecting..." : streaming ? "Running" : "Idle";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            CrisisNet Detection
          </p>
          <h1 className="text-3xl font-semibold">Live Camera Feed</h1>
          <p className="text-sm text-muted-foreground">
            Streams your camera via WebRTC to Roboflow for real-time detection.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-secondary px-3 py-1">
            Status: {status}
          </span>
          <span className="rounded-full bg-secondary px-3 py-1">
            Latency: {latencyMs ? `${latencyMs}ms` : "--"}
          </span>
          <span className="rounded-full bg-secondary px-3 py-1">
            Detections: {predictions.length}
          </span>
          <button
            type="button"
            className="rounded-full border border-border px-4 py-1.5 text-sm transition hover:bg-secondary"
            onClick={streaming ? stop : start}
            disabled={connecting}
          >
            {connecting ? "Connecting..." : streaming ? "Stop" : "Start"}
          </button>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-auto w-full"
            style={{ minHeight: 480 }}
          />
          {!streaming && !connecting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <button
                type="button"
                className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                onClick={start}
              >
                Start Camera
              </button>
            </div>
          )}
          {connecting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <p className="text-sm text-white">Connecting to Roboflow...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
