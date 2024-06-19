import { App, Notice, TFile, normalizePath } from "obsidian";
import { S3agleSettings } from "../settings";
import { hashFile, hashArrayBuffer, incrementFileName, sanitizeFileName } from "../helpers";

export const saveFileToVault = async (
  file: File,
  settings: S3agleSettings,
  app: App,
): Promise<string> => {
  let fileName = settings.hashFileName ? await hashFile(file, settings.hashSeed) : sanitizeFileName(file.name);

  const data = await file.arrayBuffer();
  const localUploadFolder = settings.localUploadFolder;
  const folderPath = normalizePath(localUploadFolder);

  // Check if the folder exists, create if not
  if (folderPath && !(await app.vault.adapter.exists(folderPath))) {
    await app.vault.createFolder(folderPath);
  }

  let filePath = `${folderPath}/${fileName}`;
  let fileExists = await app.vault.adapter.exists(filePath);
  let existingFile: TFile | null = null;

  // Check if file with the same name exists
  while (fileExists) {
    existingFile = app.vault.getAbstractFileByPath(filePath) as TFile;
    if (existingFile) {
      const existingFileData = await app.vault.readBinary(existingFile);
      const existingFileHash = hashArrayBuffer(existingFileData, settings.hashSeed);
      const newFileHash = hashArrayBuffer(data, settings.hashSeed);
      if (existingFileHash === newFileHash) {
        new Notice(`S3agle: "${fileName}" file exists, linking to existing file`);
        return filePath; // File is the same, link to existing
      } else {
        // Increment file name if the content is different
        fileName = incrementFileName(fileName);
        filePath = `${folderPath}/${fileName}`;
        fileExists = await app.vault.adapter.exists(filePath);
      }
    }
  }

  // Save the new file in the vault
  try {
    await app.vault.createBinary(filePath, new Uint8Array(data));
    new Notice(`S3agle: File saved successfully in vault at: ${filePath}`);
    return filePath;
  } catch (error) {
    new Notice("S3agle: Failed to save file in vault.");
    console.error("Error saving file in vault:", error);
    return "";
  }
};