"use client";

import { useEffect, useRef, useState } from "react";

type Prediction = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
};

type PredictionResponse = {
  predictions: Prediction[];
  image: { width: number; height: number } | null;
  error?: string;
};

const INFERENCE_INTERVAL_MS = 250;
const INFERENCE_WIDTH = 512;
const INFERENCE_HEIGHT = 288;
const JPEG_QUALITY = 0.45;

export function RoboflowWebcam() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [status, setStatus] = useState("Initializing camera...");
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [imageMeta, setImageMeta] = useState<{ width: number; height: number } | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastInferenceAt, setLastInferenceAt] = useState<number | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    const video = videoRef.current;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus("Camera ready");
      } catch (error) {
        console.error(error);
        setStatus("Camera access denied or unavailable");
      }
    };

    startCamera();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const drawLoop = () => {
      if (video.readyState >= 2 && isRunning) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (predictions.length > 0 && imageMeta) {
          const scaleX = canvas.width / imageMeta.width;
          const scaleY = canvas.height / imageMeta.height;

          ctx.lineWidth = 2;
          ctx.font = "14px ui-sans-serif, system-ui";
          predictions.forEach((prediction) => {
            const boxWidth = prediction.width * scaleX;
            const boxHeight = prediction.height * scaleY;
            const x = (prediction.x - prediction.width / 2) * scaleX;
            const y = (prediction.y - prediction.height / 2) * scaleY;

            ctx.strokeStyle = "#00e0ff";
            ctx.fillStyle = "rgba(0, 224, 255, 0.15)";
            ctx.fillRect(x, y, boxWidth, boxHeight);
            ctx.strokeRect(x, y, boxWidth, boxHeight);

            const label = `${prediction.class} ${(prediction.confidence * 100).toFixed(0)}%`;
            const textWidth = ctx.measureText(label).width + 10;
            ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
            ctx.fillRect(x, Math.max(0, y - 20), textWidth, 20);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(label, x + 5, Math.max(14, y - 6));
          });
        }
      }

      rafRef.current = requestAnimationFrame(drawLoop);
    };

    rafRef.current = requestAnimationFrame(drawLoop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [predictions, imageMeta, isRunning]);

  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      return;
    }

    const captureCanvas = captureCanvasRef.current ?? document.createElement("canvas");
    captureCanvasRef.current = captureCanvas;
    const captureCtx = captureCanvas.getContext("2d");

    if (!captureCtx) return;

    let isBusy = false;
    let pending = false;
    let timeoutId: number | null = null;

    const tick = async () => {
      if (isBusy) {
        pending = true;
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      captureCanvas.width = INFERENCE_WIDTH;
      captureCanvas.height = INFERENCE_HEIGHT;
      captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

      const dataUrl = captureCanvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const base64 = dataUrl.split(",")[1];

      isBusy = true;
      const start = performance.now();
      try {
        const response = await fetch("/api/roboflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64 }),
        });

        const data: PredictionResponse = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Roboflow request failed");
        }

        setPredictions(data.predictions ?? []);
        setImageMeta(
          data.image ?? {
            width: captureCanvas.width,
            height: captureCanvas.height,
          }
        );
        setLatencyMs(Math.round(performance.now() - start));
        setLastInferenceAt(Date.now());
        setStatus("Running");
      } catch (error) {
        console.error(error);
        setStatus("Inference error");
      } finally {
        isBusy = false;
        if (pending) {
          pending = false;
          void tick();
          return;
        }
        timeoutId = window.setTimeout(tick, INFERENCE_INTERVAL_MS);
      }
    };

    timeoutId = window.setTimeout(tick, INFERENCE_INTERVAL_MS);
    intervalRef.current = timeoutId;

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [isRunning]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Roboflow Live Test
          </p>
          <h1 className="text-3xl font-semibold">Webcam Workflow Preview</h1>
          <p className="text-sm text-muted-foreground">
            This page streams your webcam, sends periodic frames to the Roboflow workflow, and draws
            detections directly on the canvas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-secondary px-3 py-1">Status: {status}</span>
          <span className="rounded-full bg-secondary px-3 py-1">
            Interval: {INFERENCE_INTERVAL_MS}ms
          </span>
          <span className="rounded-full bg-secondary px-3 py-1">
            Inference: {INFERENCE_WIDTH}x{INFERENCE_HEIGHT}
          </span>
          <span className="rounded-full bg-secondary px-3 py-1">
            Latency: {latencyMs ? `${latencyMs}ms` : "--"}
          </span>
          <span className="rounded-full bg-secondary px-3 py-1">
            Age: {lastInferenceAt ? `${Math.max(0, Math.floor((Date.now() - lastInferenceAt) / 100) / 10)}s` : "--"}
          </span>
          <button
            type="button"
            className="rounded-full border border-border px-4 py-1.5 text-sm transition hover:bg-secondary"
            onClick={() => setIsRunning((prev) => !prev)}
          >
            {isRunning ? "Pause inference" : "Resume inference"}
          </button>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
          <video ref={videoRef} className="hidden" playsInline />
          <canvas ref={canvasRef} className="w-full h-auto" />
        </div>

        <div className="text-xs text-muted-foreground">
          Tip: if detections are slow, increase the interval or reduce the camera resolution.
        </div>
      </div>
    </div>
  );
}
