import { AtpAgent } from '@atproto/api'
import "dotenv/config"

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

import fs from 'fs';

const file = fs.readFileSync('./img.png'); // Read the image file
const image = Buffer.from(file); 
const { data } = await agent.uploadBlob(image, { encoding:'image/jpeg'} ); 
// 'data.blob' will contain the blob reference needed for the post


// Using the blob reference obtained from the uploadBlob step
await agent.post({
    text: 'Check out this new post with media!',
    embed: {
        $type: 'app.bsky.embed.images', // Specifies an image embed type
        images: [{ 
            alt: 'A description of the image', // Optional alt text
            image: data.blob // The blob reference
        }]
    },
    langs: ['en-US'],
    createdAt: new Date().toISOString()
});
