const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl: s3GetSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client = null;

function getClient() {
  if (!client) {
    client = new S3Client({
      endpoint: process.env.DO_SPACES_ENDPOINT,
      region: process.env.DO_SPACES_REGION || 'nyc3',
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET,
      },
      forcePathStyle: false,
    });
  }
  return client;
}

function getBucket() {
  return process.env.DO_SPACES_BUCKET || 'proof-coi-uploads';
}

/**
 * Upload a file buffer to DigitalOcean Spaces.
 * Returns the object key (filename) stored in Spaces.
 */
async function uploadFile(buffer, filename, mimetype, prefix = 'cois') {
  const s3 = getClient();
  const key = `${prefix}/${filename}`;

  await s3.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: buffer,
    ContentType: mimetype || 'application/pdf',
    ACL: 'private',
  }));

  return key;
}

/**
 * Generate a temporary signed URL for secure file access.
 * URL expires after 15 minutes by default.
 */
async function getSignedUrl(key, expiresIn = 900) {
  const s3 = getClient();

  const url = await s3GetSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }),
    { expiresIn }
  );

  return url;
}

/**
 * Download a file from Spaces and return it as a Buffer.
 */
async function downloadFile(key) {
  const s3 = getClient();

  const response = await s3.send(new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  }));

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Delete a file from Spaces.
 */
async function deleteFile(key) {
  const s3 = getClient();

  await s3.send(new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: key,
  }));
}

module.exports = { uploadFile, getSignedUrl, downloadFile, deleteFile };
