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
 * Concatenate a list of generated videos into a single MP4.
 *
 * Fast path: ffmpeg concat demuxer with `-c copy` — no re-encode.
 * Works when inputs share codec / resolution / fps (Kling outputs
 * generally do). Takes a second or two per scene.
 *
 * Slow path: filter_complex concat with re-encode. Used as fallback
 * if the fast path errors. Always safe but slower.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getUserFromRequest(req, res);
  if (!session) return res.status(401).json({ error: 'Authentication required.' });

  const { videoUrls } = req.body || {};
  if (!Array.isArray(videoUrls) || videoUrls.length < 2) {
    return res.status(400).json({ error: 'Provide at least 2 video URLs.' });
  }
  if (videoUrls.length > 5) {
    return res.status(400).json({ error: 'Up to 5 videos supported.' });
  }
  for (const u of videoUrls) {
    if (!isHttpUrl(u)) {
      return res.status(400).json({ error: `Invalid URL: ${u}` });
    }
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmp = os.tmpdir();
  const inPaths = videoUrls.map((_, i) => path.join(tmp, `${id}-${i}.mp4`));
  const listPath = path.join(tmp, `${id}-list.txt`);
  const outPath = path.join(tmp, `${id}-out.mp4`);

  try {
    // Download all clips in parallel to /tmp.
    await Promise.all(
      videoUrls.map(async (url, i) => {
        const resp = await fetch(url);
        if (!resp.ok) {
          throw new Error(`Could not fetch clip ${i + 1} (${resp.status})`);
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        await fs.writeFile(inPaths[i], buf);
      })
    );

    // Build concat list file with one "file '<path>'" line per input.
    // -safe 0 is required when absolute paths are used.
    const listBody = inPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
    await fs.writeFile(listPath, listBody);

    const fastArgs = [
      '-y',
      '-loglevel', 'warning',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      outPath,
    ];

    let used = 'copy';
    try {
      await runFfmpeg(fastArgs);
      const st = await fs.stat(outPath).catch(() => null);
      if (!st || st.size === 0) throw new Error('empty output');
    } catch (copyErr) {
      console.warn('[concat-videos] fast path failed, falling back to re-encode:', copyErr.message);
      // Filter_complex re-encode fallback — rescales every input to
      // match the first, which guarantees concat works even if codecs
      // or resolutions differ.
      const inputArgs = inPaths.flatMap((p) => ['-i', p]);
      const n = inPaths.length;
      const scaled = Array.from({ length: n }, (_, i) =>
        `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
      ).join(';');
      const chain =
        scaled +
        ';' +
        Array.from({ length: n }, (_, i) => `[v${i}][${i}:a]`).join('') +
        `concat=n=${n}:v=1:a=1[v][a]`;
      const slowArgs = [
        '-y',
        '-loglevel', 'warning',
        ...inputArgs,
        '-filter_complex', chain,
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '128k',
        outPath,
      ];
      await runFfmpeg(slowArgs);
      used = 'reencode';
    }

    const outBuffer = await fs.readFile(outPath);
    if (!outBuffer.length) {
      throw new Error('Concatenation produced empty output.');
    }

    const filename = `combined/${id}.mp4`;
    const blob = await put(filename, outBuffer, {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
    });

    return res.status(200).json({
      combinedUrl: blob.url,
      size: outBuffer.length,
      method: used,
    });
  } catch (err) {
    console.error('[concat-videos] failed', err);
    return res.status(500).json({
      error: err.message || 'Video concatenation failed.',
    });
  } finally {
    Promise.all([
      ...inPaths.map((p) => fs.unlink(p).catch(() => {})),
      fs.unlink(listPath).catch(() => {}),
      fs.unlink(outPath).catch(() => {}),
    ]);
  }
}
