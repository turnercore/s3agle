import { Folder } from "../types"
import { createEagleFolder } from "./createEagleFolder"
import { EAGLE_API_FOLDER_LIST_ENDPOINT } from "../constants"

  export const getEagleFolderId = async (
    folderPath: string,
    createPathIfNotExist = true,
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
        safeEagleApiUrl + EAGLE_API_FOLDER_LIST_ENDPOINT,
        requestOptions,
      )

      const result = await response.json()

      if (result.status === "success") {
        const folders: Folder[] = result.data
        const pathParts = folderPath.split("/")
        const parentId = ""
        const folder = await findFolderInTree(
          createPathIfNotExist,
          folders,
          pathParts,
          parentId,
          safeEagleApiUrl,
        )

        return folder ? folder.id : null
      } else {
        console.error("Failed to fetch folder list:", result)
        return null
      }
    } catch (error) {
      console.error("Failed to fetch folder list:", error)
      return null
    }
  }

    //Find a folder in the Eagle folder tree
const findFolderInTree = async (
    createPathIfNotExist: boolean,
    folders: Folder[],
    pathParts: string[],
    parentId = "",
    eagleApiUrl: string,
  ): Promise<Folder | undefined> => {
    if (pathParts.length === 0) {
      return
    }

    const folderName = pathParts[0]
    const endOfTree = pathParts.length === 1
    // Check for folder in the current list of folders
    const folder = folders.find((folder) => folder.name === folderName)
    if (folder && endOfTree) return folder
    if (folder && !endOfTree) {
      // Current folder is found, but we need to go deeper
      return findFolderInTree(
        createPathIfNotExist,
        folder.children,
        pathParts.slice(1),
        folder.id,
        eagleApiUrl,
      )
    }
    if (!folder && createPathIfNotExist) {
      // Folder is not found and we need to create it
      const folderId = await createEagleFolder(folderName, parentId, eagleApiUrl)

      if (folderId) {
        //Folder was created successfully we can create the next folder in the list if needed
        if (endOfTree) {
          return {
            id: folderId,
            name: folderName,
            parent: parentId,
            children: [],
          }
        } else {
          // Go deeper in the tree
          return findFolderInTree(
            createPathIfNotExist,
            folders,
            pathParts.slice(1),
            folderId,
            eagleApiUrl,
          )
        }
      } else return
    }
  }
