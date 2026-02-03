import { NextResponse } from "next/server";

type RoboflowPrediction = {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
};

export async function POST(request: Request) {
  try {
    const { imageBase64 } = (await request.json()) as { imageBase64?: string };

    if (!imageBase64) {
      return NextResponse.json({ error: "Missing imageBase64" }, { status: 400 });
    }

    const apiKey = process.env.ROBOFLOW_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ROBOFLOW_API_KEY is not set" }, { status: 500 });
    }

    const response = await fetch(
      "https://serverless.roboflow.com/namanb/workflows/find-people-candles-and-flames",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          inputs: {
            image: {
              type: "base64",
              value: imageBase64,
            },
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error ?? "Roboflow request failed" },
        { status: response.status }
      );
    }

    const output = data?.outputs?.[0]?.predictions ?? null;
    const predictions = (output?.predictions ?? []) as RoboflowPrediction[];
    const image = output?.image ?? null;

    return NextResponse.json({ predictions, image });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
