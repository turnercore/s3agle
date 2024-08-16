import { S3agleSettings } from "../settings";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getDynamicFolderPath } from "../helpers";

export const uploadToS3 = async (file: File, settings: S3agleSettings): Promise<string> => {
  if (!settings.s3Url) {
    throw new Error("S3 URL is missing in the settings.");
  }

  const s3Client = new S3Client({
    region: settings.s3Region || undefined,  // Optional if the custom endpoint doesn't need it
    credentials: {
      accessKeyId: settings.accessKey,
      secretAccessKey: settings.secretKey,
    },
    endpoint: settings.s3Url.startsWith("http")
      ? settings.s3Url
      : `https://${settings.s3Url}`,  // Always use the s3Url from settings
  })

  const folderPath = getDynamicFolderPath(settings.s3Folder || "")
  const key = `${folderPath}/${file.name}`
  const buffer = await file.arrayBuffer()

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      Body: new Uint8Array(buffer),
      ContentType: file.type,
    }))

    // Generate the correct URL based on the contentUrl and ensure the folder path is included
    const filePrefix = settings.contentUrl.endsWith("/") ? settings.contentUrl : `${settings.contentUrl}/`
    const fileBucket = settings.bucket.endsWith("/") ? settings.bucket : `${settings.bucket}/`
    const folderPath = settings.s3Folder ? `${settings.s3Folder}/` : ""
    const fileUrl = `${filePrefix}${fileBucket}${folderPath}${file.name}`
    const escapedFileUrl = escapeFileUrl(fileUrl)

    return escapedFileUrl;  // Return the correct file URL for preview
  } catch (error) {
    throw new Error(`Error uploading to S3: ${error.message}`)
  }
}

const escapeFileUrl = (fileUrl: string): string => {
  //turn spaces into %20 and other special characters into their escaped values, get rid of double slashes
  return fileUrl.replace(/ /g, "%20")
}
