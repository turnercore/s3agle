import { S3agleSettings } from "../settings";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getDynamicFolderPath, hashFile } from "../helpers";

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
  const fileName = settings.hashFileName ? await hashFile(file, settings.hashSeed) : file.name
  const folderPath = getDynamicFolderPath(settings.s3Folder || "")
  const key = `${folderPath}/${fileName}`
  const buffer = await file.arrayBuffer()

  try {
    // This is where we upload the file to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      Body: new Uint8Array(buffer),
      ContentType: file.type,
    }))
  } catch (error) {
    throw new Error(`Error uploading to S3: ${error.message}`)
  }

  // Generate the correct URL based on the contentUrl and ensure the folder path is included
  const s3Url = settings.s3Url ? settings.s3Url : "https://s3.amazonaws.com/" // This is the default URL if nothing is entered
  const contentUrl = (settings.useCustomContentUrl && settings.customContentUrl) ? settings.customContentUrl : s3Url
  const httpOrHttps = contentUrl.startsWith("http://") ? "http://" : "https://"
  const strippedContentUrl = contentUrl.replace(httpOrHttps, "")
  const path = settings.s3Folder ? `${settings.s3Folder}` : ""

  // Remove trailing / if exists
  const filePrefix = strippedContentUrl.endsWith("/") ? strippedContentUrl.slice(0, -1) : strippedContentUrl
  const fileBucket = settings.bucket.endsWith("/") ? settings.bucket.slice(0, -1) : settings.bucket
  const fileFolderPath = path.endsWith("/") ? path.slice(0, -1) : path
  const fileUrl = settings.useBucketSubdomain ? `${httpOrHttps}${fileBucket}.${filePrefix}/${fileFolderPath}/${fileName}` : `${httpOrHttps}${filePrefix}/${fileBucket}/${fileFolderPath}/${fileName}`
  const escapedFileUrl = escapeFileUrl(fileUrl)

  return escapedFileUrl;  // Return the correct file URL for preview
}

const escapeFileUrl = (fileUrl: string): string => {
  //turn spaces into %20 and other special characters into their escaped values, get rid of double slashes
  return fileUrl.replace(/ /g, "%20")
}
