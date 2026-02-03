"use client";

import { useEffect, useRef, useState } from "react";
import { connectors, webrtc, streams } from "@roboflow/inference-sdk";

type WebrtcConnection = {
  remoteStream: () => Promise<MediaStream>;
  cleanup: () => void;
};

export function WorkflowStream() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const connectionRef = useRef<WebrtcConnection | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState("Idle");

  useEffect(() => {
    return () => {
      connectionRef.current?.cleanup();
    };
  }, []);

  async function start() {
    if (connecting || streaming) return;
    setConnecting(true);
    setStatus("Connecting...");

    try {
      // ⚠️ Testing only - exposes API key in frontend. Use a backend proxy in production.
      const connector = connectors.withApiKey(
        process.env.NEXT_PUBLIC_ROBOFLOW_API_KEY,
        {
          serverUrl: "https://serverless.roboflow.com",
        },
      );

      const stream = await streams.useCamera({
        video: { facingMode: "environment" },
      });

      connectionRef.current = (await webrtc.useStream({
        source: stream,
        connector,
        wrtcParams: {
          workspaceName: "namanb",
          workflowId: "crisisnet-final",
          streamOutputNames: ["predictions"],
          dataOutputNames: ["output_visualisation_1"],
          processingTimeout: 600,
          requestedPlan: "webrtc-gpu-medium",
          requestedRegion: "us",
        },
        onData: (data) => {
          console.log("Predictions:", data);
          setStatus("Streaming");
        },
      })) as WebrtcConnection;

      if (videoRef.current) {
        videoRef.current.srcObject = await connectionRef.current.remoteStream();
      }

      setStreaming(true);
      setStatus("Streaming");
    } catch (error) {
      console.error(error);
      setStatus("Connection failed");
      connectionRef.current?.cleanup();
      connectionRef.current = null;
    } finally {
      setConnecting(false);
    }
  }

  function stop() {
    connectionRef.current?.cleanup();
    connectionRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStreaming(false);
    setStatus("Stopped");
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-12">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Roboflow Realtime
          </p>
          <h1 className="text-3xl font-semibold">Workflow WebRTC Stream</h1>
          <p className="text-sm text-muted-foreground">
            This connects your camera directly to the Roboflow workflow using
            WebRTC for realtime inference and visualization.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-secondary px-3 py-1">
            Status: {status}
          </span>
          <span className="rounded-full bg-secondary px-3 py-1">
            Region: us · Plan: webrtc-gpu-medium
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

        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-auto w-full"
          />
        </div>
      </div>
    </div>
  );
}
