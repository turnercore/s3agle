import { Folder } from "../types"
import { EAGLE_API_CREATE_FOLDER_ENDPOINT } from "../constants"

  //Create a folder in Eagle
  export const createEagleFolder = async (
    folderName: string,
    parentId: string,
    eagleApiUrl: string,
  ): Promise<string | null> => {
    try {
      let safeEagleApiUrl = eagleApiUrl
      if (safeEagleApiUrl.endsWith("/")) {
        //remove trailing slash
        safeEagleApiUrl = safeEagleApiUrl.slice(0, -1)
      }

      const data = {
        folderName,
        parent: parentId,
      }

      const response = await fetch(safeEagleApiUrl + EAGLE_API_CREATE_FOLDER_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error("Failed to create folder in Eagle.")
      }

      interface expectedResponse {
        status: string
        data: Folder
      }

      const dataObject: expectedResponse = await response.json()

      return dataObject.data.id || null
    } catch (error) {
      console.error("Failed to create folder in Eagle:", error)
      return null
    }
  }