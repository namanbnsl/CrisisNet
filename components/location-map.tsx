"use client";

import { MapPin, Navigation, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGeolocation } from "@/lib/hooks/use-geolocation";

export function LocationMap() {
  const { latitude, longitude, accuracy, error, loading } = useGeolocation();

  const mapUrl =
    latitude && longitude
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${longitude - 0.01},${latitude - 0.01},${longitude + 0.01},${latitude + 0.01}&layer=mapnik&marker=${latitude},${longitude}`
      : null;

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-xl bg-emerald-500/10 p-3">
          <MapPin className="h-6 w-6 text-emerald-500" />
        </div>
        <div>
          <h3 className="font-semibold">Your Location</h3>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Getting location..."
              : error
                ? "Location unavailable"
                : "Live GPS tracking"}
          </p>
        </div>
        {!loading && !error && (
          <div className="ml-auto flex items-center gap-2">
            <Navigation className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground">
              ±{accuracy ? Math.round(accuracy) : "--"}m
            </span>
          </div>
        )}
      </div>

      <div
        className="relative overflow-hidden rounded-xl bg-secondary"
        style={{ minHeight: 200 }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-4">
            <MapPin className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <p className="text-xs text-muted-foreground">
              Please enable location access in your browser
            </p>
          </div>
        )}

        {mapUrl && !loading && !error && (
          <iframe
            src={mapUrl}
            className="h-full w-full border-0"
            style={{ minHeight: 200 }}
            title="Your location"
          />
        )}
      </div>

      {latitude && longitude && !loading && !error && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="flex gap-4">
            <span className="text-muted-foreground">
              Lat:{" "}
              <span className="font-mono text-foreground">
                {latitude.toFixed(6)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Lng:{" "}
              <span className="font-mono text-foreground">
                {longitude.toFixed(6)}
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
