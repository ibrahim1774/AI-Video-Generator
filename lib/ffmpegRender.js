import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { put } from '@vercel/blob';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

import { effectiveDuration } from './editPlan';

/*
 * Compiles an edit plan into an ffmpeg invocation and renders to MP4.
 *
 * Approach: build a single -filter_complex graph that applies every
 * operation in order, then pipe to a tmp file and upload to Vercel
 * Blob. Simpler and more portable than spawning multiple ffmpeg
 * passes — at the cost of some filter-graph complexity.
 *
 * Returns: { outputUrl, size }
 */

function escFfmpegText(s) {
  // drawtext is picky about colons, single-quotes, percents, backslashes.
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
    .replace(/%/g, '\\%');
}

function positionExpr(position) {
  switch (position) {
    case 'top': return 'x=(w-text_w)/2:y=h*0.08';
    case 'bottom': return 'x=(w-text_w)/2:y=h*0.85';
    case 'top-left': return 'x=w*0.04:y=h*0.08';
    case 'top-right': return 'x=w-text_w-w*0.04:y=h*0.08';
    case 'bottom-left': return 'x=w*0.04:y=h*0.85';
    case 'bottom-right': return 'x=w-text_w-w*0.04:y=h*0.85';
    case 'center':
    default:
      return 'x=(w-text_w)/2:y=(h-text_h)/2';
  }
}

function aspectToWH(aspectRatio, srcW, srcH) {
  // Crop the source to the requested aspect ratio while keeping the
  // larger side intact, then return the explicit w:h to crop to. We
  // crop centered.
  const [aw, ah] = aspectRatio.split(':').map((n) => parseInt(n, 10));
  const targetRatio = aw / ah;
  const srcRatio = srcW / srcH;
  if (srcRatio > targetRatio) {
    // Source is wider — crop sides.
    const newW = Math.round(srcH * targetRatio);
    return { w: newW, h: srcH };
  }
  // Source is taller — crop top/bottom.
  const newH = Math.round(srcW / targetRatio);
  return { w: srcW, h: newH };
}

/**
 * Build the -filter_complex string and the list of extra inputs the
 * graph references (e.g. an audio track). Returns { graph, extraInputs,
 * audioMaps } where audioMaps tells us how to emit the final -map.
 */
function buildFilterGraph(plan) {
  const { width, height, operations } = plan;

  // Track the current "labels" in the graph. Start with the source
  // video and audio.
  let vLabel = '[0:v]';
  let aLabel = '[0:a]';
  const chunks = [];
  const extraInputs = []; // additional -i URLs (e.g. audioTrack)

  let nextLabel = 1;
  const newV = () => `[v${nextLabel++}]`;
  const newA = () => `[a${nextLabel++}]`;

  for (const op of operations) {
    if (op.type === 'trim') {
      const out = newV();
      const aOut = newA();
      chunks.push(`${vLabel}trim=start=${op.start}:end=${op.end},setpts=PTS-STARTPTS${out}`);
      chunks.push(`${aLabel}atrim=start=${op.start}:end=${op.end},asetpts=PTS-STARTPTS${aOut}`);
      vLabel = out;
      aLabel = aOut;
    } else if (op.type === 'speed') {
      const out = newV();
      const aOut = newA();
      const factor = op.factor;
      chunks.push(`${vLabel}setpts=PTS/${factor}${out}`);
      // atempo only handles 0.5..2.0 per stage — chain stages for
      // anything outside that range.
      const stages = [];
      let remaining = factor;
      while (remaining > 2.0) { stages.push(2.0); remaining /= 2.0; }
      while (remaining < 0.5) { stages.push(0.5); remaining /= 0.5; }
      stages.push(remaining);
      const atempoChain = stages.map((s) => `atempo=${s}`).join(',');
      chunks.push(`${aLabel}${atempoChain}${aOut}`);
      vLabel = out;
      aLabel = aOut;
    } else if (op.type === 'textOverlay') {
      const out = newV();
      const fontSize = op.fontSize || 48;
      const color = op.color || '#ffffff';
      const pos = positionExpr(op.position || 'center');
      chunks.push(
        `${vLabel}drawtext=text='${escFfmpegText(op.text)}':fontsize=${fontSize}:fontcolor=${color}:` +
        `${pos}:enable='between(t,${op.start},${op.end})':box=1:boxcolor=black@0.4:boxborderw=10${out}`
      );
      vLabel = out;
    } else if (op.type === 'captions') {
      // Captions = bottom-anchored drawtext per segment.
      const fontSize = 38;
      let cur = vLabel;
      for (const seg of op.segments) {
        const out = newV();
        chunks.push(
          `${cur}drawtext=text='${escFfmpegText(seg.text)}':fontsize=${fontSize}:fontcolor=#ffffff:` +
          `x=(w-text_w)/2:y=h*0.85:enable='between(t,${seg.start},${seg.end})':` +
          `box=1:boxcolor=black@0.55:boxborderw=12${out}`
        );
        cur = out;
      }
      vLabel = cur;
    } else if (op.type === 'audioTrack') {
      // Add the URL as an additional input. The input index is
      // 1 + extraInputs.length so far (source is 0).
      const inputIdx = 1 + extraInputs.length;
      extraInputs.push(op.url);
      const aOut = newA();
      const vol = op.volume === undefined ? 0.5 : op.volume;
      chunks.push(
        `[${inputIdx}:a]volume=${vol}[ax${inputIdx}];` +
        `${aLabel}[ax${inputIdx}]amix=inputs=2:duration=first:dropout_transition=2${aOut}`
      );
      aLabel = aOut;
    } else if (op.type === 'fade') {
      const out = newV();
      const aOut = newA();
      const dur = effectiveDuration(plan);
      const startFade = op.direction === 'in' ? 0 : Math.max(0, dur - op.duration);
      chunks.push(`${vLabel}fade=t=${op.direction}:st=${startFade}:d=${op.duration}${out}`);
      chunks.push(`${aLabel}afade=t=${op.direction}:st=${startFade}:d=${op.duration}${aOut}`);
      vLabel = out;
      aLabel = aOut;
    } else if (op.type === 'crop') {
      const { w, h } = aspectToWH(op.aspectRatio, width, height);
      const out = newV();
      chunks.push(`${vLabel}crop=${w}:${h}:(in_w-${w})/2:(in_h-${h})/2${out}`);
      vLabel = out;
    } else if (op.type === 'filter') {
      const parts = [];
      if (op.brightness !== undefined) parts.push(`brightness=${op.brightness}`);
      if (op.contrast !== undefined) parts.push(`contrast=${op.contrast}`);
      if (op.saturation !== undefined) parts.push(`saturation=${op.saturation}`);
      if (parts.length === 0) continue;
      const out = newV();
      chunks.push(`${vLabel}eq=${parts.join(':')}${out}`);
      vLabel = out;
    } else if (op.type === 'reverse') {
      const out = newV();
      const aOut = newA();
      chunks.push(`${vLabel}reverse${out}`);
      chunks.push(`${aLabel}areverse${aOut}`);
      vLabel = out;
      aLabel = aOut;
    }
  }

  return {
    graph: chunks.join(';'),
    extraInputs,
    finalVideo: vLabel,
    finalAudio: aLabel,
  };
}

function runFfmpeg(args, onProgress, totalSeconds) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegInstaller.path, args);
    const errs = [];
    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      errs.push(chunk);
      if (onProgress && totalSeconds > 0) {
        // ffmpeg writes "time=HH:MM:SS.ms" to stderr during encode.
        const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const elapsed = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
          onProgress(elapsed / totalSeconds);
        }
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      const stderr = Buffer.concat(errs).toString();
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1200) || '<no stderr>'}`));
      }
      resolve({ stderr });
    });
  });
}

export async function renderEditPlan(plan, { onProgress } = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmp = os.tmpdir();
  const inPath = path.join(tmp, `${id}-in.mp4`);
  const outPath = path.join(tmp, `${id}-out.mp4`);
  const extraPaths = [];

  try {
    // Download source.
    const srcResp = await fetch(plan.sourceUrl);
    if (!srcResp.ok) throw new Error(`Could not fetch source video (${srcResp.status})`);
    await fs.writeFile(inPath, Buffer.from(await srcResp.arrayBuffer()));

    const { graph, extraInputs, finalVideo, finalAudio } = buildFilterGraph(plan);

    // Download any extra inputs (audio tracks).
    for (let i = 0; i < extraInputs.length; i++) {
      const p = path.join(tmp, `${id}-extra-${i}`);
      const r = await fetch(extraInputs[i]);
      if (!r.ok) throw new Error(`Could not fetch extra input ${i + 1} (${r.status})`);
      await fs.writeFile(p, Buffer.from(await r.arrayBuffer()));
      extraPaths.push(p);
    }

    const inputArgs = ['-i', inPath, ...extraPaths.flatMap((p) => ['-i', p])];

    // If the operation list is empty we still re-encode (cheap) so the
    // user always gets a fresh file.
    const filterArgs = graph
      ? ['-filter_complex', graph, '-map', finalVideo, '-map', finalAudio]
      : [];

    const ffArgs = [
      '-y',
      '-loglevel', 'warning',
      ...inputArgs,
      ...filterArgs,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outPath,
    ];

    const total = effectiveDuration(plan);
    await runFfmpeg(ffArgs, onProgress, total);

    const buf = await fs.readFile(outPath);
    if (!buf.length) throw new Error('Render produced empty output.');

    const filename = `video-edits/${id}.mp4`;
    const blob = await put(filename, buf, {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
    });

    return { outputUrl: blob.url, size: buf.length };
  } finally {
    Promise.all([
      fs.unlink(inPath).catch(() => {}),
      fs.unlink(outPath).catch(() => {}),
      ...extraPaths.map((p) => fs.unlink(p).catch(() => {})),
    ]);
  }
}
