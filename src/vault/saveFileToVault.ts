import { App, Notice, normalizePath, TFile } from "obsidian";
import { S3agleSettings } from "../settings";

// Save the file locally in the vault
export const saveFileToVault = async (
  file: File,
  settings: S3agleSettings,
  app: App,
): Promise<string> => {
  let fileName = file.name;
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
      const existingFileHash = await hashFileData(new Uint8Array(existingFileData));
      const newFileHash = await hashFileData(new Uint8Array(data));
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

// Helper function to hash file data
const hashFileData = async (data: Uint8Array): Promise<string> => {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

// Helper function to increment file name
const incrementFileName = (fileName: string): string => {
  const nameParts = fileName.match(/(.*?)(\d+)?(\.[^.]*$|$)/);
  if (!nameParts) return fileName;
  const baseName = nameParts[1];
  const ext = nameParts[3];
  const num = nameParts[2] ? parseInt(nameParts[2]) + 1 : 2;
  return `${baseName}${num}${ext}`;
};
