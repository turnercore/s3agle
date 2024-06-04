import { App, Notice, normalizePath } from "obsidian"
import { S3agleSettings } from "../settings"

  // Save the file locally in the vault
export const saveFileToVault = async (
    file: File,
    settings: S3agleSettings,
    app: App,
  ): Promise<string> => {
    const path = `${settings.localUploadFolder}/${file.name}`
    const data = await file.arrayBuffer()
    const localUploadFolder = settings.localUploadFolder
    // Check if the folder exists, create if not
    const folderPath = normalizePath(localUploadFolder)
    if (folderPath && !(await app.vault.adapter.exists(folderPath))) {
      await app.vault.createFolder(folderPath)
    }

    // Save the file in the vault
    try {
      await app.vault.createBinary(path, new Uint8Array(data))
      new Notice(`S3agle: File saved successfully in vault at: ${path}`)
      return path
    } catch (error) {
      new Notice("S3agle: Failed to save file in vault.")
      console.error("Error saving file in vault:", error)
      return ""
    }
  }