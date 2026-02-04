"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { connectors, webrtc, streams } from "@roboflow/inference-sdk";
import {
  Thermometer,
  Wind,
  Activity,
  AlertTriangle,
  Camera,
  Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Prediction = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
};

type SensorData = {
  mq2: number;
  mq135: number;
  dhtTemp: number;
  bnoTemp: number;
  orientation: { x: number; y: number; z: number };
  gyro: { x: number; y: number; z: number };
  accel: { x: number; y: number; z: number };
  calibration: { sys: number; gyro: number; accel: number; mag: number };
  timestamp: number;
};

const TEMP_THRESHOLD = 35; // Temperature threshold to trigger camera

export function CrisisDashboard() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const connectionRef = useRef<Awaited<
    ReturnType<typeof webrtc.useStream>
  > | null>(null);
  
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [fireDetected, setFireDetected] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [alertLevel, setAlertLevel] = useState<"normal" | "warning" | "danger">("normal");

  // Check if any prediction indicates fire
  const checkForFire = useCallback((preds: Prediction[]) => {
    const fireClasses = ["fire", "flame", "smoke", "Fire", "Flame", "Smoke"];
    const hasFire = preds.some(
      (p) => fireClasses.includes(p.class) && p.confidence > 0.5
    );
    setFireDetected(hasFire);
    if (hasFire) {
      setAlertLevel("danger");
    }
  }, []);

  // Start camera stream
  const startCamera = useCallback(async () => {
    if (streaming || connecting) return;
    
    setConnecting(true);
    setCameraVisible(true);
    
    try {
      const connector = connectors.withApiKey(
        process.env.NEXT_PUBLIC_ROBOFLOW_API_KEY!,
        { serverUrl: "https://serverless.roboflow.com" }
      );
      
      const stream = await streams.useCamera({
        video: { facingMode: "environment" },
      });

      connectionRef.current = await webrtc.useStream({
        source: stream,
        connector,
        wrtcParams: {
          workspaceName: "namanb",
          workflowId: "crisisnet-final",
          streamOutputNames: ["output_visualization_1"],
          dataOutputNames: ["predictions"],
          processingTimeout: 600,
          requestedPlan: "webrtc-gpu-medium",
          requestedRegion: "ap",
        },
        onData: (data) => {
          const dataObj = data as unknown as Record<string, unknown>;
          if (dataObj?.predictions && Array.isArray(dataObj.predictions)) {
            const preds = dataObj.predictions as Prediction[];
            setPredictions(preds);
            checkForFire(preds);
          }
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = await connectionRef.current.remoteStream();
      }
      setStreaming(true);
    } catch (error) {
      console.error("Failed to start stream:", error);
      setCameraVisible(false);
    } finally {
      setConnecting(false);
    }
  }, [streaming, connecting, checkForFire]);

  // Poll sensor data
  useEffect(() => {
    const fetchSensorData = async () => {
      try {
        const res = await fetch("/api/sensors");
        const data = await res.json();
        if (!data.error) {
          setSensorData(data);
          
          // Check temperature threshold
          if (data.dhtTemp >= TEMP_THRESHOLD || data.bnoTemp >= TEMP_THRESHOLD) {
            if (!streaming && !connecting) {
              setAlertLevel("warning");
              startCamera();
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch sensor data:", error);
      }
    };

    fetchSensorData();
    const interval = setInterval(fetchSensorData, 1000);
    return () => clearInterval(interval);
  }, [streaming, connecting, startCamera]);

  const getTemperatureColor = (temp: number) => {
    if (temp >= TEMP_THRESHOLD) return "text-red-500";
    if (temp >= TEMP_THRESHOLD - 5) return "text-orange-500";
    return "text-green-500";
  };

  const getGasLevel = (value: number) => {
    if (value > 2000) return { level: "High", color: "text-red-500" };
    if (value > 1000) return { level: "Medium", color: "text-orange-500" };
    return { level: "Low", color: "text-green-500" };
  };

  return (
    <div
      className={cn(
        "relative min-h-screen transition-colors duration-500",
        alertLevel === "danger" && "bg-red-950/20",
        alertLevel === "warning" && "bg-orange-950/10",
        alertLevel === "normal" && "bg-background"
      )}
    >
      {/* Fire Alert Overlay */}
      {fireDetected && (
        <div className="pointer-events-none fixed inset-0 z-50">
          <div className="animate-pulse absolute inset-0 bg-red-500/20" />
          <div className="absolute left-1/2 top-8 -translate-x-1/2 transform">
            <div className="flex animate-bounce items-center gap-3 rounded-full bg-red-600 px-6 py-3 text-white shadow-2xl">
              <Flame className="h-6 w-6 animate-pulse" />
              <span className="text-lg font-bold">FIRE DETECTED!</span>
              <Flame className="h-6 w-6 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              CrisisNet
            </p>
            <h1 className="text-3xl font-bold">Sensor Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "h-3 w-3 rounded-full",
                sensorData ? "animate-pulse bg-green-500" : "bg-gray-400"
              )}
            />
            <span className="text-sm text-muted-foreground">
              {sensorData ? "Connected" : "Waiting for sensor..."}
            </span>
          </div>
        </div>

        {/* Sensor Cards Grid */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Temperature Card */}
          <div
            className={cn(
              "rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300",
              sensorData?.dhtTemp && sensorData.dhtTemp >= TEMP_THRESHOLD &&
                "border-red-500 ring-2 ring-red-500/20"
            )}
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-orange-500/10 p-3">
                <Thermometer className="h-6 w-6 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Temperature</p>
                <p
                  className={cn(
                    "text-2xl font-bold",
                    sensorData?.dhtTemp && getTemperatureColor(sensorData.dhtTemp)
                  )}
                >
                  {sensorData?.dhtTemp ?? "--"}°C
                </p>
              </div>
            </div>
            {sensorData?.dhtTemp && sensorData.dhtTemp >= TEMP_THRESHOLD && (
              <div className="mt-3 flex items-center gap-2 text-sm text-red-500">
                <AlertTriangle className="h-4 w-4" />
                <span>Threshold exceeded!</span>
              </div>
            )}
          </div>

          {/* MQ2 Gas Sensor Card */}
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-500/10 p-3">
                <Wind className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">MQ2 (Smoke)</p>
                <p className="text-2xl font-bold">{sensorData?.mq2 ?? "--"}</p>
              </div>
            </div>
            {sensorData?.mq2 && (
              <div
                className={cn(
                  "mt-3 text-sm",
                  getGasLevel(sensorData.mq2).color
                )}
              >
                Level: {getGasLevel(sensorData.mq2).level}
              </div>
            )}
          </div>

          {/* MQ135 Air Quality Card */}
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-500/10 p-3">
                <Wind className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">MQ135 (Air)</p>
                <p className="text-2xl font-bold">{sensorData?.mq135 ?? "--"}</p>
              </div>
            </div>
            {sensorData?.mq135 && (
              <div
                className={cn(
                  "mt-3 text-sm",
                  getGasLevel(sensorData.mq135).color
                )}
              >
                Level: {getGasLevel(sensorData.mq135).level}
              </div>
            )}
          </div>

          {/* IMU/Activity Card */}
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-green-500/10 p-3">
                <Activity className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">BNO055 Temp</p>
                <p
                  className={cn(
                    "text-2xl font-bold",
                    sensorData?.bnoTemp && getTemperatureColor(sensorData.bnoTemp)
                  )}
                >
                  {sensorData?.bnoTemp ?? "--"}°C
                </p>
              </div>
            </div>
            {sensorData?.calibration && (
              <div className="mt-3 text-sm text-muted-foreground">
                Cal: Sys {sensorData.calibration.sys}/3
              </div>
            )}
          </div>
        </div>

        {/* Camera Feed Section */}
        <div
          className={cn(
            "overflow-hidden transition-all duration-700 ease-out",
            cameraVisible
              ? "max-h-[800px] opacity-100"
              : "max-h-0 opacity-0"
          )}
        >
          <div className="rounded-3xl border bg-card p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "rounded-xl p-3",
                    fireDetected ? "bg-red-500/20" : "bg-primary/10"
                  )}
                >
                  <Camera
                    className={cn(
                      "h-6 w-6",
                      fireDetected ? "text-red-500" : "text-primary"
                    )}
                  />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">Live Detection Feed</h2>
                  <p className="text-sm text-muted-foreground">
                    {connecting
                      ? "Connecting to camera..."
                      : streaming
                      ? `Detecting ${predictions.length} objects`
                      : "Camera ready"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {fireDetected && (
                  <span className="animate-pulse rounded-full bg-red-500 px-4 py-1.5 text-sm font-medium text-white">
                    🔥 Fire Detected
                  </span>
                )}
                <span
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm",
                    streaming
                      ? "bg-green-500/10 text-green-500"
                      : connecting
                      ? "bg-orange-500/10 text-orange-500"
                      : "bg-secondary text-muted-foreground"
                  )}
                >
                  {connecting ? "Connecting..." : streaming ? "Live" : "Ready"}
                </span>
              </div>
            </div>

            <div className="relative overflow-hidden rounded-2xl bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn(
                  "h-auto w-full transition-opacity duration-500",
                  streaming ? "opacity-100" : "opacity-0"
                )}
                style={{ minHeight: 400 }}
              />
              
              {!streaming && (
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{ minHeight: 400 }}
                >
                  {connecting ? (
                    <div className="flex flex-col items-center gap-4">
                      <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                      <p className="text-white">Initializing camera...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-4 text-center">
                      <Camera className="h-16 w-16 text-white/50" />
                      <p className="text-white/70">
                        Camera will activate when temperature exceeds {TEMP_THRESHOLD}°C
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Detection Stats */}
            {streaming && predictions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {predictions.map((pred, idx) => (
                  <span
                    key={idx}
                    className={cn(
                      "rounded-full px-3 py-1 text-sm",
                      pred.class.toLowerCase().includes("fire") ||
                        pred.class.toLowerCase().includes("flame") ||
                        pred.class.toLowerCase().includes("smoke")
                        ? "bg-red-500/20 text-red-400"
                        : "bg-secondary text-foreground"
                    )}
                  >
                    {pred.class}: {Math.round(pred.confidence * 100)}%
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* IMU Data Details */}
        {sensorData && (
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {/* Orientation */}
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <h3 className="mb-4 font-semibold">Orientation</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">X (Heading)</span>
                  <span>{sensorData.orientation.x.toFixed(2)}°</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Y (Roll)</span>
                  <span>{sensorData.orientation.y.toFixed(2)}°</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Z (Pitch)</span>
                  <span>{sensorData.orientation.z.toFixed(2)}°</span>
                </div>
              </div>
            </div>

            {/* Accelerometer */}
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <h3 className="mb-4 font-semibold">Accelerometer</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">X</span>
                  <span>{sensorData.accel.x.toFixed(2)} m/s²</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Y</span>
                  <span>{sensorData.accel.y.toFixed(2)} m/s²</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Z</span>
                  <span>{sensorData.accel.z.toFixed(2)} m/s²</span>
                </div>
              </div>
            </div>

            {/* Gyroscope */}
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <h3 className="mb-4 font-semibold">Gyroscope</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">X</span>
                  <span>{sensorData.gyro.x.toFixed(2)} rad/s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Y</span>
                  <span>{sensorData.gyro.y.toFixed(2)} rad/s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Z</span>
                  <span>{sensorData.gyro.z.toFixed(2)} rad/s</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer Status */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          {sensorData?.timestamp && (
            <p>
              Last update: {new Date(sensorData.timestamp).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
