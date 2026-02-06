import { AtpAgent } from "@atproto/api";
import { NextRequest, NextResponse } from "next/server";
import { startBlueskyCommentPolling } from "@/lib/bluesky-comments-poller";
import { setAlertLocation } from "@/lib/alert-location";

export async function POST(request: NextRequest) {
  try {
    const { lat, lng, radiusKm = 50, image } = await request.json();

    const agent = new AtpAgent({ service: "https://bsky.social" });
    await agent.login({
      identifier: process.env.BLUESKY_IDENTIFIER!,
      password: process.env.BLUESKY_PASSWORD!,
    });

    const mapUrl = `https://maps.geoapify.com/v1/staticmap?style=osm-bright-grey&width=600&height=400&geometry=circle:${lng},${lat},${radiusKm};fillcolor:%23ff4444;fillopacity:0.5&apiKey=${process.env.GEOAPIFY_API_KEY}`;

    const mapResponse = await fetch(mapUrl);
    const mapBuffer = Buffer.from(await mapResponse.arrayBuffer());

    const { data: mapData } = await agent.uploadBlob(mapBuffer, {
      encoding: "image/png",
    });

    const images = [
      {
        alt: `Map showing fire affected area at coordinates ${lat}, ${lng}`,
        image: mapData.blob,
      },
    ];

    if (image) {
      const imageBuffer = Buffer.from(image, "base64");
      const { data: webcamData } = await agent.uploadBlob(imageBuffer, {
        encoding: "image/jpeg",
      });

      images.unshift({
        alt: "Fire detected by webcam",
        image: webcamData.blob,
      });
    }

    await agent.post({
      text: `🔥 FIRE ALERT 🔥\n \n \nLocation: ${lat}, ${lng}\nGoogle Maps: https://www.google.com/maps/search/?api=1&query=${lat},${lng} \nStay safe and follow official guidance.`,
      embed: {
        $type: "app.bsky.embed.images",
        images,
      },
      langs: ["en-US"],
      createdAt: new Date().toISOString(),
    });

    if (typeof lat === "number" && typeof lng === "number") {
      setAlertLocation(lat, lng);
    }

    startBlueskyCommentPolling({
      durationMs: 10 * 60 * 1000, // 10 minutes
      intervalMs: 5 * 1000, // 15 seconds
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Fire detection error:", error);
    return NextResponse.json(
      { error: "Failed to post alert" },
      { status: 500 },
    );
  }
}
