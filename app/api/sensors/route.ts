let latestSensorData: any = null;

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // ---- Basic validation ----
    if (
      typeof body.mq2 !== "number" ||
      typeof body.mq135 !== "number" ||
      typeof body.dhtTemp !== "number" ||
      typeof body.bnoTemp !== "number"
    ) {
      return new Response(JSON.stringify({ error: "Invalid sensor values" }), {
        status: 400,
      });
    }

    if (!body.orientation || !body.gyro || !body.accel || !body.calibration) {
      return new Response(JSON.stringify({ error: "Missing sensor objects" }), {
        status: 400,
      });
    }

    // ---- Store latest data (RAM) ----
    latestSensorData = {
      mq2: body.mq2,
      mq135: body.mq135,
      dhtTemp: body.dhtTemp,

      orientation: {
        x: body.orientation.x,
        y: body.orientation.y,
        z: body.orientation.z,
      },

      gyro: {
        x: body.gyro.x,
        y: body.gyro.y,
        z: body.gyro.z,
      },

      accel: {
        x: body.accel.x,
        y: body.accel.y,
        z: body.accel.z,
      },

      bnoTemp: body.bnoTemp,

      calibration: {
        sys: body.calibration.sys,
        gyro: body.calibration.gyro,
        accel: body.calibration.accel,
        mag: body.calibration.mag,
      },

      timestamp: Date.now(),
    };

    return Response.json({ success: true });
  } catch (error) {
    console.error("POST /api/sensors error:", error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
    });
  }
}

export async function GET() {
  return Response.json(latestSensorData ?? { error: "No data received yet" });
}
