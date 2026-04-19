import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { put } from '@vercel/blob';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

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
 * Server-side first-frame extractor for videos the browser couldn't
 * decode. Writes the input to /tmp so ffmpeg can seek (MOV requires
 * this — its moov atom is often at the end of the file).
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

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inPath = path.join(os.tmpdir(), `${id}-in`);
  const outPath = path.join(os.tmpdir(), `${id}.jpg`);

  try {
    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      throw new Error(`Could not fetch source video (${videoResp.status})`);
    }
    const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
    await fs.writeFile(inPath, videoBuffer);
    console.log('[extract-frame] written to tmp', { bytes: videoBuffer.length, inPath });

    const args = [
      '-y',
      '-loglevel', 'warning',
      '-i', inPath,
      '-frames:v', '1',
      '-q:v', '3',
      outPath,
    ];

    const { stderr } = await runFfmpeg(args);
    if (stderr) console.log('[extract-frame] ffmpeg stderr:', stderr.slice(-1000));

    let frameBuffer;
    try {
      frameBuffer = await fs.readFile(outPath);
    } catch (e) {
      throw new Error(`ffmpeg did not produce output file. stderr: ${stderr.slice(-500)}`);
    }
    if (!frameBuffer.length) {
      throw new Error('ffmpeg produced empty output file');
    }
    console.log('[extract-frame] frame ok', { bytes: frameBuffer.length });

    const filename = `frames/${id}.jpg`;
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
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}
