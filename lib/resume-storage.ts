import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const BUCKET = "candidate-resumes";

function getS3Client() {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
    throw new Error("Neon Object Storage credentials are missing. Run `neon env pull`.");
  }
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export async function storeResume(fileName: string, contentType: string, body: Buffer) {
  const safeName = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-80) || "resume";
  const key = `uploads/${crypto.randomUUID()}-${safeName}`;
  await getS3Client().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || "application/octet-stream",
  }));
  return key;
}

export async function deleteResumeObject(key: string) {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
