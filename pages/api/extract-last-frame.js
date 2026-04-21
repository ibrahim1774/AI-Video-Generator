import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { put } from '@vercel/blob';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

import { getUserFromRequest } from '../../lib/supabaseServer';

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegInstaller.path, args);
    const errs = [];
    proc.stderr.on('data', (c) => errs.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      const stderr = Buffer.concat(errs).toString();
      if (code !== 0) {
        return reject(
          new Error(`ffmpeg exited ${code}: ${stderr.slice(-1000) || '<no stderr>'}`)
        );
      }
      resolve({ stderr });
    });
  });
}

/**
 * Extract the LAST frame of a generated video and upload it to Vercel
 * Blob as a JPEG. Used by the UGC storyboard chain: the last frame of
 * scene N becomes the starting image of scene N+1.
 *
 * `-sseof -1` seeks one second from the end before reading — a cheap
 * way to land on the last frame without scanning the whole file.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const { videoUrl } = req.body || {};
  if (!isHttpUrl(videoUrl)) {
    return res.status(400).json({ error: 'videoUrl required.' });
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inPath = path.join(os.tmpdir(), `${id}-in.mp4`);
  const outPath = path.join(os.tmpdir(), `${id}.jpg`);

  try {
    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      throw new Error(`Could not fetch source video (${videoResp.status})`);
    }
    const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
    await fs.writeFile(inPath, videoBuffer);

    // Two-stage fallback: sseof is fast but can fail on non-keyframe
    // endings; if it doesn't produce output, fall back to seeking most
    // of the way through and reading the last frame linearly.
    const args1 = [
      '-y',
      '-loglevel', 'warning',
      '-sseof', '-1',
      '-i', inPath,
      '-update', '1',
      '-q:v', '3',
      outPath,
    ];

    let okOutput = false;
    try {
      await runFfmpeg(args1);
      const st = await fs.stat(outPath).catch(() => null);
      okOutput = !!(st && st.size > 0);
    } catch {
      okOutput = false;
    }

    if (!okOutput) {
      // Fallback: read all frames and keep writing the last one.
      const args2 = [
        '-y',
        '-loglevel', 'warning',
        '-i', inPath,
        '-vf', 'select=eq(n\\,NB_FRAMES-1)',
        '-vsync', 'vfr',
        '-q:v', '3',
        outPath,
      ];
      try {
        await runFfmpeg(args2);
      } catch {
        // Second fallback: just grab the frame at 90% of duration.
        const args3 = [
          '-y',
          '-loglevel', 'warning',
          '-i', inPath,
          '-vf', "select='gte(t,n_seconds-0.1)'",
          '-frames:v', '1',
          '-q:v', '3',
          outPath,
        ];
        await runFfmpeg(args3);
      }
    }

    const frameBuffer = await fs.readFile(outPath);
    if (!frameBuffer.length) {
      throw new Error('ffmpeg produced empty output file.');
    }

    const filename = `frames/${id}-last.jpg`;
    const blob = await put(filename, frameBuffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
    });

    return res.status(200).json({ frameUrl: blob.url });
  } catch (err) {
    console.error('[extract-last-frame] failed', err);
    return res
      .status(500)
      .json({ error: err.message || 'Last-frame extraction failed.' });
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}
