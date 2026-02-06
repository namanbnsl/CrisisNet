"use client";

import { useRef, useState, useEffect } from "react";
import { connectors, webrtc, streams } from "@roboflow/inference-sdk";
import { Thermometer, Wind, AlertTriangle, Camera, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { LocationMap } from "@/components/location-map";
import { useGeolocation } from "@/lib/hooks/use-geolocation";

type Prediction = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
  class_name?: string;
  className?: string;
  label?: string;
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

const TEMP_THRESHOLD = 40;

const MQ2_CLEAN = 300;
const MQ2_LIGHT = 600;

const MQ135_GOOD = 400;
const MQ135_MODERATE = 800;
const FIRE_CLASS = "fire";

type CameraStatus = "idle" | "connecting" | "live" | "error";

type AlertStatus =
  | "idle"
  | "queued_for_location"
  | "sending"
  | "sent"
  | "error";

type AlertState = { status: AlertStatus; error: string | null };

const ALERT_INITIAL: AlertState = { status: "idle", error: null };

function useLatest(value: any) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

const extractPredictions = (data: Record<string, unknown>): Prediction[] => {
  // @ts-ignore
  const preds = data.serialized_output_data?.predictions?.predictions;
  return Array.isArray(preds) ? (preds as Prediction[]) : [];
};

export function CrisisDashboard() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const connectionRef = useRef<Awaited<
    ReturnType<typeof webrtc.useStream>
  > | null>(null);

  const { latitude, longitude, accuracy, error, loading } = useGeolocation();
  const [sensorData, setSensorData] = useState<SensorData | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [alert, setAlert] = useState<AlertState>(ALERT_INITIAL);

  const pendingImageRef = useRef<string | null>(null);

  const alertRef = useLatest(alert);
  const cameraVisibleRef = useLatest(cameraVisible);

  const fireDetected = predictions.some((p) => p.class === FIRE_CLASS);
  const alertLevel: "normal" | "warning" | "danger" = fireDetected
    ? "danger"
    : "normal";

  const captureFrame = async () => {
    const video = videoRef.current;
    if (!video) return null;
    if (
      video.readyState < 2 ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener("loadeddata", finish);
          video.removeEventListener("canplay", finish);
          resolve(null);
        };
        setTimeout(finish, 600);
        video.addEventListener("loadeddata", finish, { once: true });
        video.addEventListener("canplay", finish, { once: true });
      });
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    if ("requestVideoFrameCallback" in video) {
      await new Promise<void>((resolve) =>
        (
          video as HTMLVideoElement & {
            requestVideoFrameCallback: (cb: () => void) => void;
          }
        ).requestVideoFrameCallback(() => resolve()),
      );
    } else {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  };

  const hasLocation =
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  const sendFireAlert = async (image: string | null) => {
    const current = alertRef.current.status;
    if (current === "sending" || current === "sent") return false;
    setAlert({ status: "sending", error: null });
    try {
      const response = await fetch("/api/fire-detection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: hasLocation ? latitude : undefined,
          lng: hasLocation ? longitude : undefined,
          radiusKm: 50,
          image,
        }),
      });
      if (!response.ok) {
        const message = await response.text().catch(() => "");
        console.error("Fire alert failed:", response.status, message);
        setAlert({
          status: "error",
          error: message
            ? `Failed: ${response.status} ${message}`
            : `Failed: ${response.status}`,
        });
        return false;
      }
      setAlert({ status: "sent", error: null });
      return true;
    } catch (err) {
      console.error("Failed to send fire alert:", err);
      setAlert({
        status: "error",
        error: "Network error while sending alert.",
      });
      return false;
    }
  };

  const queueOrSendAlert = async (image: string | null) => {
    const current = alertRef.current.status;
    if (current === "sent" || current === "sending") return false;
    if (!hasLocation) {
      pendingImageRef.current = image;
      setAlert({ status: "queued_for_location", error: null });
      return false;
    }
    const ok = await sendFireAlert(image);
    if (!ok && alertRef.current.status !== "sent") {
      setAlert(ALERT_INITIAL);
    }
    return ok;
  };

  useEffect(() => {
    let mounted = true;

    const initCamera = async () => {
      if (connectionRef.current) return;

      setCameraStatus("connecting");

      try {
        const connector = connectors.withApiKey(
          process.env.NEXT_PUBLIC_ROBOFLOW_API_KEY!,
          { serverUrl: "https://serverless.roboflow.com" },
        );

        const stream = await streams.useCamera({
          video: { facingMode: "environment" },
        });

        if (!mounted) return;

        connectionRef.current = await webrtc.useStream({
          source: stream,
          connector,
          wrtcParams: {
            workspaceName: "namanb",
            workflowId: "crisisnet-hf-model",
            streamOutputNames: ["output_image"],
            dataOutputNames: ["predictions"],
            processingTimeout: 600,
            requestedPlan: "webrtc-gpu-medium",
            requestedRegion: "ap",
          },
          onData: (data) => {
            if (!cameraVisibleRef.current) return;
            const dataObj = data as unknown as Record<string, unknown>;
            const rawPreds = extractPredictions(dataObj);
            if (!rawPreds.length) {
              setPredictions([]);
              return;
            }

            const preds = rawPreds.map((pred) => ({
              ...pred,
              class: pred.class,
            }));

            setPredictions(preds);

            const hasFire = preds.some((p) => p.class == FIRE_CLASS);
            const alertStatus = alertRef.current.status;
            if (
              hasFire &&
              alertStatus !== "sent" &&
              alertStatus !== "sending"
            ) {
              (async () => {
                const frame = await captureFrame();
                await queueOrSendAlert(frame);
              })();
            }
          },
        });

        if (!mounted) return;

        setCameraStatus("live");
      } catch (err) {
        console.error("Failed to initialize camera:", err);
        if (mounted) setCameraStatus("error");
      }
    };

    initCamera();

    return () => {
      mounted = false;
      connectionRef.current?.cleanup();
    };
  }, []);

  useEffect(() => {
    const attachStream = async () => {
      if (cameraVisible && videoRef.current && connectionRef.current) {
        try {
          videoRef.current.srcObject =
            await connectionRef.current.remoteStream();
          await videoRef.current.play().catch(() => null);
        } catch (err) {
          console.error("Failed to attach stream:", err);
        }
      }
    };
    attachStream();
  }, [cameraVisible]);

  useEffect(() => {
    if (alert.status !== "queued_for_location") return;
    if (!hasLocation) return;
    (async () => {
      const frame = pendingImageRef.current ?? (await captureFrame());
      pendingImageRef.current = null;
      await sendFireAlert(frame);
    })();
  }, [hasLocation, alert.status]);

  useEffect(() => {
    const fetchSensorData = async () => {
      try {
        const res = await fetch("/api/sensors");
        const data = await res.json();
        if (!data.error) {
          setSensorData(data);
          setCameraVisible((prev) => prev || data.dhtTemp >= TEMP_THRESHOLD);
        }
      } catch (err) {
        console.error("Failed to fetch sensor data:", err);
      }
    };

    fetchSensorData();
    const interval = setInterval(fetchSensorData, 1000);
    return () => clearInterval(interval);
  }, [cameraVisible]);

  const getTemperatureColor = (temp: number) => {
    if (temp >= TEMP_THRESHOLD) return "text-red-500";
    if (temp >= TEMP_THRESHOLD - 5) return "text-orange-500";
    return "text-green-500";
  };

  const getMQ2Level = (value: number) => {
    if (value > MQ2_LIGHT)
      return { level: "High smoke/gas", color: "text-red-500" };
    if (value > MQ2_CLEAN)
      return { level: "Light smoke/gas", color: "text-orange-500" };
    return { level: "Clean air", color: "text-green-500" };
  };

  const getMQ135Level = (value: number) => {
    if (value > MQ135_MODERATE)
      return { level: "Poor air", color: "text-red-500" };
    if (value > MQ135_GOOD)
      return { level: "Moderate", color: "text-orange-500" };
    return { level: "Very good", color: "text-green-500" };
  };

  return (
    <div
      className={cn(
        "relative min-h-screen transition-colors duration-500",
        alertLevel === "danger" && "bg-red-950/20",
        alertLevel === "normal" && "bg-background",
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
            <p className="text-lg font-semibold">CrisisNet</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "h-3 w-3 rounded-full",
                  sensorData ? "animate-pulse bg-green-500" : "bg-gray-400",
                )}
              />
              <span className="text-sm text-muted-foreground">
                {sensorData ? "Sensors" : "Waiting..."}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "h-3 w-3 rounded-full",
                  cameraStatus === "live"
                    ? "bg-green-500"
                    : cameraStatus === "connecting"
                      ? "animate-pulse bg-orange-500"
                      : "bg-gray-400",
                )}
              />
              <span className="text-sm text-muted-foreground">
                {cameraStatus === "live"
                  ? "Camera ready"
                  : cameraStatus === "connecting"
                    ? "Loading camera..."
                    : "Camera"}
              </span>
            </div>
          </div>
        </div>

        {/* Main Two-Column Layout: Sensors Left, Video Right */}
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Left Column: Sensor Details */}
          <div className="space-y-6">
            {/* Sensor Cards Grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Temperature Card */}
              <div
                className={cn(
                  "rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300",
                  sensorData?.dhtTemp &&
                    sensorData.dhtTemp >= TEMP_THRESHOLD &&
                    "border-red-500 ring-2 ring-red-500/20",
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
                        sensorData?.dhtTemp &&
                          getTemperatureColor(sensorData.dhtTemp),
                      )}
                    >
                      {sensorData?.dhtTemp != null
                        ? Math.round(sensorData.dhtTemp)
                        : "--"}
                      °C
                    </p>
                  </div>
                </div>
                {sensorData?.dhtTemp &&
                  sensorData.dhtTemp >= TEMP_THRESHOLD && (
                    <div className="mt-3 flex items-center gap-2 text-sm text-red-500">
                      <AlertTriangle className="h-4 w-4" />
                      <span>Threshold exceeded!</span>
                    </div>
                  )}
              </div>

              {/* MQ2 Gas Sensor Card */}
              <div
                className={cn(
                  "rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300",
                  sensorData?.mq2 &&
                    sensorData.mq2 > MQ2_LIGHT &&
                    "border-red-500 ring-2 ring-red-500/20",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-purple-500/10 p-3">
                    <Wind className="h-6 w-6 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      MQ-2 (Smoke/Gas)
                    </p>
                    <p className="text-2xl font-bold">
                      {sensorData?.mq2 != null
                        ? Math.round(sensorData.mq2)
                        : "--"}
                    </p>
                  </div>
                </div>
                {sensorData?.mq2 !== undefined && (
                  <div
                    className={cn(
                      "mt-3 text-sm",
                      getMQ2Level(sensorData.mq2).color,
                    )}
                  >
                    {getMQ2Level(sensorData.mq2).level}
                  </div>
                )}
              </div>

              {/* MQ135 Air Quality Card */}
              <div
                className={cn(
                  "rounded-2xl border bg-card p-6 shadow-sm transition-all duration-300",
                  sensorData?.mq135 &&
                    sensorData.mq135 > MQ135_MODERATE &&
                    "border-red-500 ring-2 ring-red-500/20",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-blue-500/10 p-3">
                    <Wind className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      MQ-135 (Air Quality)
                    </p>
                    <p className="text-2xl font-bold">
                      {sensorData?.mq135 != null
                        ? Math.round(sensorData.mq135)
                        : "--"}
                    </p>
                  </div>
                </div>
                {sensorData?.mq135 !== undefined && (
                  <div
                    className={cn(
                      "mt-3 text-sm",
                      getMQ135Level(sensorData.mq135).color,
                    )}
                  >
                    {getMQ135Level(sensorData.mq135).level}
                  </div>
                )}
              </div>

              {/* Location Map Card */}
              <LocationMap
                location={{ latitude, longitude, accuracy, error, loading }}
              />
            </div>

            {/* IMU Data Details */}
            {sensorData && (
              <div className="grid gap-4 sm:grid-cols-3">
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
          </div>

          {/* Right Column: Camera Feed - Hidden until threshold exceeded */}
          {cameraVisible && (
            <div className="overflow-hidden transition-all duration-700 ease-out animate-in fade-in slide-in-from-right">
              <div className="rounded-3xl border bg-card p-6 shadow-lg h-full">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "rounded-xl p-3",
                        fireDetected ? "bg-red-500/20" : "bg-primary/10",
                      )}
                    >
                      <Camera
                        className={cn(
                          "h-6 w-6",
                          fireDetected ? "text-red-500" : "text-primary",
                        )}
                      />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">
                        Live Detection Feed
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {cameraStatus === "connecting"
                          ? "Connecting to camera..."
                          : cameraStatus === "live"
                            ? `Detecting ${predictions.length} objects`
                            : "Camera ready"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={async () => {
                        if (!fireDetected || alert.status === "sent") return;
                        const frame = captureFrame();
                        queueOrSendAlert(await frame);
                      }}
                      disabled={alert.status === "sent"}
                      className={cn(
                        "rounded-full px-4 py-1.5 text-sm font-medium",
                        alert.status === "sent"
                          ? "bg-gray-500 text-white cursor-not-allowed"
                          : "bg-red-600 text-white hover:bg-red-700",
                      )}
                    >
                      {alert.status === "sent"
                        ? "Alert Sent"
                        : alert.status === "queued_for_location"
                          ? "Queued..."
                          : alert.status === "sending"
                            ? "Sending..."
                            : "🚨 Report Fire"}
                    </button>
                    <span
                      className={cn(
                        "rounded-full px-4 py-1.5 text-sm",
                        cameraStatus === "live"
                          ? "bg-green-500/10 text-green-500"
                          : cameraStatus === "connecting"
                            ? "bg-orange-500/10 text-orange-500"
                            : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {cameraStatus === "connecting"
                        ? "Connecting..."
                        : cameraStatus === "live"
                          ? "Live"
                          : "Ready"}
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
                      cameraStatus === "live" ? "opacity-100" : "opacity-0",
                    )}
                    style={{ minHeight: 300 }}
                  />

                  {cameraStatus !== "live" && (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ minHeight: 300 }}
                    >
                      <div className="flex flex-col items-center gap-4">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                        <p className="text-white">Initializing camera...</p>
                      </div>
                    </div>
                  )}
                </div>

                {alert.error && (
                  <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {alert.error}
                  </div>
                )}

                {/* Detection Stats */}
                {cameraStatus === "live" && predictions.length > 0 && (
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
                            : "bg-secondary text-foreground",
                        )}
                      >
                        {pred.class}: {Math.round(pred.confidence * 100)}%
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

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
