import { S3agleSettings } from "../settings"
import { ObsHttpHandler } from "../helpers"
import { HttpRequest } from "@aws-sdk/protocol-http"
import { URL } from 'url'
import { EAGLE_API_ADD_FROM_URL_ENDPOINT, EAGLE_API_ADD_FROM_PATH_ENDPOINT } from "../constants"
import { getEagleFolderId } from "./getEagleFolderId"
import { getEagleItemId } from "./getEagleItemId"

// Upload file to Eagle using a URL

export const uploadToEagle = async (fileUrl: string, fileName: string, settings: S3agleSettings): Promise<string> => {
  const eagleApiUrl = settings.eagleApiUrl.endsWith("/")
    ? settings.eagleApiUrl.slice(0, -1)
    : settings.eagleApiUrl
  
  const isWebUrl = fileUrl.startsWith("http://") || fileUrl.startsWith("https://")
  const eagleApiEndpoint = isWebUrl ? EAGLE_API_ADD_FROM_URL_ENDPOINT : EAGLE_API_ADD_FROM_PATH_ENDPOINT

  const folderId = await getEagleFolderId(settings.eagleFolder, true, settings.eagleApiUrl) || ""

  const data = isWebUrl ? {
    url: fileUrl,
    name: fileName,
    tags: ["Obsidian"],
    folderId
  } : {
    path: fileUrl,
    name: fileName,
    tags: ["Obsidian"],
    folderId,
  }

  const obsHttpHandler = new ObsHttpHandler()

  // Parse eagleApiUrl to extract hostname and port
  const url = new URL(eagleApiUrl)
  const protocol = url.protocol
  const hostname = url.hostname
  const port = url.port || (protocol === "https:" ? "443" : "80")

  const httpRequest = new HttpRequest({
    protocol,
    hostname,
    port: parseInt(port, 10),
    method: "POST",
    path: eagleApiEndpoint,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  })

    const response = await obsHttpHandler.handle(httpRequest)
    if (response.response.statusCode !== 200) {
      // Output the response body
      const responseBody = await response.response.body.getReader().read().then(({ value }: { value: Uint8Array }) => new TextDecoder().decode(value))
      console.error(`Failed to upload file to Eagle: ${responseBody}`)
      throw new Error("Failed to upload file to Eagle.")
    }
    // Parse the response body to get the Eagle item ID
    const responseData = await response.response.body.getReader().read().then(({ value }: { value: Uint8Array }) => JSON.parse(new TextDecoder().decode(value)))
    // Get the item ID
    console.log("Eagle response data:", responseData.data)
    const id = (!responseData.data || responseData.data ==="undefined") ? await getEagleItemId(fileName, folderId, eagleApiUrl) : responseData.data
    console.log("Eagle item ID:", id)
    if (!id) throw new Error("Failed to get Eagle item ID.")

    return `eagle://item/${id}` // Return the Eagle item ID URI
}

