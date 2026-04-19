import { spawn } from 'child_process';
import { put } from '@vercel/blob';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  // 60s for ffmpeg cold start + frame extract
  maxDuration: 60,
};

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Server-side first-frame extractor for videos the browser couldn't
 * decode (e.g. iPhone HEVC). Streams the video into ffmpeg, captures
 * frame 0 as JPG, uploads it to Vercel Blob, returns the public URL.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { videoUrl } = req.body || {};
  if (!isHttpUrl(videoUrl)) {
    return res.status(400).json({ error: 'videoUrl required.' });
  }

  console.log('[extract-frame] start', { videoUrl });

  try {
    // Download the video from Blob into memory.
    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      throw new Error(`Could not fetch source video (${videoResp.status})`);
    }
    const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
    console.log('[extract-frame] downloaded', { bytes: videoBuffer.length });

    // ffmpeg: read mp4/mov from stdin, output a single JPG to stdout.
    const args = [
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-frames:v', '1',
      '-q:v', '3',
      '-f', 'image2',
      'pipe:1',
    ];

    const frameBuffer = await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegInstaller.path, args);
      const chunks = [];
      const errs = [];
      proc.stdout.on('data', (c) => chunks.push(c));
      proc.stderr.on('data', (c) => errs.push(c));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(
            new Error(
              `ffmpeg exited ${code}: ${Buffer.concat(errs).toString().slice(0, 500)}`
            )
          );
        }
        resolve(Buffer.concat(chunks));
      });
      proc.stdin.on('error', reject);
      proc.stdin.end(videoBuffer);
    });

    if (!frameBuffer.length) {
      throw new Error('ffmpeg produced no output');
    }
    console.log('[extract-frame] frame ok', { bytes: frameBuffer.length });

    const filename = `frames/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const blob = await put(filename, frameBuffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
    });

    console.log('[extract-frame] uploaded', { url: blob.url });
    return res.status(200).json({ frameUrl: blob.url });
  } catch (err) {
    console.error('[extract-frame] failed', err);
    return res
      .status(500)
      .json({ error: err.message || 'Server-side frame extraction failed.' });
  }
}
