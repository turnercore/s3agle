import { S3agleSettings } from "../settings"

// Upload file to Eagle
export const uploadToEagle = async (file: File, settings: S3agleSettings, s3Url: string): Promise<string> => {
  const eagleApiUrl = settings.eagleApiUrl.endsWith("/") 
    ? settings.eagleApiUrl.slice(0, -1)
    : settings.eagleApiUrl
  
  const data = {
    url: s3Url || "file location",
    name: file.name,
    // Add other necessary properties for Eagle upload
  }
  
  try {
    const response = await fetch(eagleApiUrl + "/api/item/addFromURL", {
      method: "POST",
      body: JSON.stringify(data),
    })
    if (!response.ok) throw new Error("Failed to upload file to Eagle.")
    const responseData = await response.json()
    return responseData.url
  } catch (error) {
    throw new Error(`Error uploading to Eagle: ${error.message}`)
  }
}
