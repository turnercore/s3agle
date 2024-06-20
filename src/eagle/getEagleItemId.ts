import { EAGLE_API_FOLDER_LIST_ENDPOINT } from "../constants"

export const getEagleItemId = async (
  fileName: string,
  folderId: string,
  eagleApiUrl: string,
): Promise<string | null> => {
  try {
    const requestOptions: RequestInit = {
      method: "GET",
      redirect: "follow",
    }

    let safeEagleApiUrl = eagleApiUrl
    if (safeEagleApiUrl.endsWith("/")) {
      //remove trailing slash
      safeEagleApiUrl = safeEagleApiUrl.slice(0, -1)
    }
    const response = await fetch(
      safeEagleApiUrl + EAGLE_API_FOLDER_LIST_ENDPOINT + `?keyword=${fileName}&folders=${folderId}`,
      requestOptions,
    )

    const results = await response.json()

    if (results.status === "success") {
      //find the item id by file name in the results
      const item = results.data.find((item: any) => item.name === fileName)
      const result = item ? item.id : null
      return result
    } else {
      console.error("Failed to fetch item list:", results)
      return null
    }
  } catch (error) {
    console.error("Failed to fetch item list:", error)
    return null
  }
}