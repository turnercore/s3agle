import { App, Command, Notice } from "obsidian";
import { extractFileNameFromUrl, isS3Url } from "../helpers";
import { S3agleSettings } from "../settings";
import { saveFileToVault } from "../vault/saveFileToVault";
import { downloadFileFromS3 } from "../s3/downloadFileFromS3";

export const downloadAllFilesCommand = (app: App, settings: S3agleSettings): Command => ({
  id: "download-all-files",
  name: "Download ALL files from S3 to local",
  callback: () => downloadAllFiles(app, settings),
});

const downloadAllFiles = async (app: App, settings: S3agleSettings) => {
  const noteFile = app.workspace.getActiveFile();
  if (!noteFile || !noteFile.name) return;

  const noteContent = await app.vault.read(noteFile);
  const urlToLocal = new Map<string, string>();
  const uniqueUrls = new Set<string>();

  const linkRegex = /\[.*?\]\((https?:\/\/.*?)\)/g;
  let match;

  while ((match = linkRegex.exec(noteContent)) !== null) {
    uniqueUrls.add(match[1]);
  }

  for (const url of uniqueUrls) {
    try {
      if (!isS3Url(url, settings.contentUrl)) continue;

      const fileName = extractFileNameFromUrl(url);
      const localPath = `${settings.localUploadFolder}/${fileName}`;
      const fileData = await downloadFileFromS3(url);
      const file = new File([fileData], fileName);

      await saveFileToVault(file, settings, app);
      urlToLocal.set(url, localPath);
    } catch (error) {
      console.error("Error downloading from URL:", url, error);
      new Notice(`S3agle: Failed to download file: ${url}`);
    }
  }

  let updatedContent = noteContent;
  urlToLocal.forEach((localPath, url) => {
    updatedContent = updatedContent.replace(new RegExp(url, 'g'), localPath);
  });

  await app.vault.modify(noteFile, updatedContent);
  new Notice("S3agle: All links have been updated to local paths.");
};
