import fs from 'fs';
import path from 'path';
import formidable from 'formidable';
import { v4 as uuidv4 } from 'uuid';

import { createJob, updateJob } from '../../lib/jobs';
import {
  getUploadUrl,
  uploadToPresignedUrl,
  createFaceSwapJob,
} from '../../lib/magichour';

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;

function parseForm(req) {
  const form = formidable({
    maxFileSize: MAX_FILE_SIZE,
    multiples: false,
    keepExtensions: true,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

function firstOf(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore — temp file may already be gone
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let videoTemp = null;
  let faceTemp = null;
  const jobId = uuidv4();

  try {
    const { fields, files } = await parseForm(req);

    const videoFile = firstOf(files.video);
    const faceFile = firstOf(files.face);

    if (!videoFile || !faceFile) {
      return res
        .status(400)
        .json({ error: 'Both a source video and a reference face photo are required.' });
    }

    videoTemp = videoFile.filepath;
    faceTemp = faceFile.filepath;

    const videoName = videoFile.originalFilename || path.basename(videoTemp);
    const faceName = faceFile.originalFilename || path.basename(faceTemp);
    const videoType = videoFile.mimetype || 'video/mp4';
    const faceType = faceFile.mimetype || 'image/jpeg';

    const startSeconds = Number(firstOf(fields.startSeconds)) || 0;
    const endSeconds = Number(firstOf(fields.endSeconds)) || 10;

    createJob({
      jobId,
      status: 'queued',
      videoFileName: videoName,
      faceFileName: faceName,
      startSeconds,
      endSeconds,
    });

    const [videoBuffer, faceBuffer] = await Promise.all([
      fs.promises.readFile(videoTemp),
      fs.promises.readFile(faceTemp),
    ]);

    const [videoUpload, faceUpload] = await Promise.all([
      getUploadUrl(videoName, 'video'),
      getUploadUrl(faceName, 'image'),
    ]);

    await Promise.all([
      uploadToPresignedUrl(videoUpload.uploadUrl, videoBuffer, videoType),
      uploadToPresignedUrl(faceUpload.uploadUrl, faceBuffer, faceType),
    ]);

    updateJob(jobId, { status: 'processing' });

    const project = await createFaceSwapJob(
      videoUpload.filePath,
      faceUpload.filePath,
      startSeconds,
      endSeconds
    );

    updateJob(jobId, { projectId: project.projectId, status: 'processing' });

    return res.status(200).json({
      jobId,
      projectId: project.projectId,
      status: 'processing',
    });
  } catch (err) {
    updateJob(jobId, {
      status: 'error',
      error: err.message || 'Unknown error',
    });
    return res.status(500).json({
      jobId,
      error: err.message || 'Face swap failed to start.',
    });
  } finally {
    await Promise.all([safeUnlink(videoTemp), safeUnlink(faceTemp)]);
  }
}
