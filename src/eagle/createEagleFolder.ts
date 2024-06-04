import { Folder } from "../types"

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

      const response = await fetch(safeEagleApiUrl + "/api/folder/create", {
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