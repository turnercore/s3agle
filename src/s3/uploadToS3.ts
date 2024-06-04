import { S3agleSettings } from "../settings"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

// Upload file to S3
export const uploadToS3 = async (file: File, settings: S3agleSettings): Promise<string> => {
  const s3Client = new S3Client({ region: settings.s3Region })
  const key = `${settings.s3Folder}/${file.name}`
  const buffer = await file.arrayBuffer()
  
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      Body: new Uint8Array(buffer),
      ContentType: file.type,
    }))
    return `${settings.contentUrl}/${key}`
  } catch (error) {
    throw new Error(`Error uploading to S3: ${error.message}`)
  }
}
