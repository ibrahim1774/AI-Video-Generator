import { handleUpload } from '@vercel/blob/client';

/*
 * Issues short-lived client upload tokens for @vercel/blob/client.
 *
 * The browser hits this route to authenticate, then PUTs the file
 * directly to *.blob.vercel-storage.com — bypassing Vercel's 4.5 MB
 * serverless body limit. Requires BLOB_READ_WRITE_TOKEN to be set in
 * the project env vars (auto-added when you create a Blob store in
 * the Vercel dashboard).
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const json = await handleUpload({
      request: req,
      body: req.body,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['video/*', 'image/*'],
        maximumSizeInBytes: 100 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // No-op for now. Could log the URL or schedule cleanup here.
      },
    });
    return res.status(200).json(json);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Upload token failed' });
  }
}
