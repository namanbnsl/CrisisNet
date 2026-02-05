import { AtpAgent } from '@atproto/api'
import "dotenv/config"
import fs from 'fs';

const agent = new AtpAgent({
  service: 'https://bsky.social'
})
await agent.login({
  identifier: process.env.BLUESKY_IDENTIFIER,
  password: process.env.BLUESKY_PASSWORD
})

await agent.post({
  text: 'Hello world! I posted this via the API.',
  createdAt: new Date().toISOString()
})

const lat = 12.949490;
const lng = 77.620810;
const radiusKm = 5;
const zoom = 13;
const width = 600;
const height = 400;

const mapUrl = `https://maps.geoapify.com/v1/staticmap?style=osm-bright-grey&width=${width}&height=${height}&geometry=circle:7.445297742419882,46.948361872425124,30;fillcolor:%23f9a9eb;fillopacity:0.5|circle:7.438301614578734,46.94649487478634,20;fillcolor:%23293a77|circle:7.441672476175171,46.94811873223475,100;fillcolor:%236ded83;fillopacity:0.5&apiKey=${process.env.GEOAPIFY_API_KEY}`

const mapResponse = await fetch(mapUrl);
const mapBuffer = Buffer.from(await mapResponse.arrayBuffer());
fs.writeFileSync('./disaster_map.png', mapBuffer);

const { data } = await agent.uploadBlob(mapBuffer, { encoding: 'image/png' });

await agent.post({
    text: `🚨 DISASTER ALERT 🚨\nAffected Area: ${radiusKm}km radius\nLocation: ${lat}, ${lng}\nStay safe and follow official guidance.`,
    embed: {
        $type: 'app.bsky.embed.images',
        images: [{
            alt: `Map showing disaster affected area with ${radiusKm}km radius at coordinates ${lat}, ${lng}`,
            image: data.blob
        }]
    },
    langs: ['en-US'],
    createdAt: new Date().toISOString()
});
