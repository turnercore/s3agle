import { App, Notice } from "obsidian";
import { extractFileNameFromUrl, isS3Url } from "../helpers";
import { S3agleSettings } from "../settings";
import { saveFileToVault } from "../vault/saveFileToVault";
import { downloadFileFromS3 } from "../s3/downloadFileFromS3";
import { FileReference } from "../types";

export const downloadOneFile = async (app: App, settings: S3agleSettings, file: FileReference) => {
  try {
    if (!isS3Url(file.path, settings.contentUrl)) {
      new Notice("S3agle: Not an S3 URL.");
      return;
    }

    const fileName = extractFileNameFromUrl(file.path);
    const localPath = `${settings.localUploadFolder}/${fileName}`;

    if (await app.vault.adapter.exists(localPath)) {
      new Notice(`S3agle: File already exists at ${localPath}`);
      return;
    }

    const fileData = await downloadFileFromS3(file.path);
    const fileToSave = new File([fileData], fileName);
    await saveFileToVault(fileToSave, settings, app);

    new Notice(`S3agle: File downloaded to ${localPath}`);
  } catch (error) {
    console.error("Error downloading file:", error);
    new Notice("S3agle: Failed to download file. Check the console for details.");
  }
};
