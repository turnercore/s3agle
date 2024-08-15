import { App, Command, Notice, TFile } from "obsidian";
import { extractLocalFileLinks, getNoteContent, getObsidianMimeType, hashFile, sanitizeFileName } from "../helpers";
import { processFile } from "../processFile";
import { S3agleSettings } from "../settings";

export const uploadAllFilesCommand = (app: App, settings: S3agleSettings): Command => ({
  id: "upload-all-files",
  name: "Upload ALL files in document to S3/Eagle",
  callback: () => uploadAllFiles(app, settings),
});

const uploadAllFiles = async (app: App, settings: S3agleSettings) => {
  const uploads: Promise<void>[] = [];
  const uploadsLocalFallback: Promise<void>[] = [];
  const editor = app.workspace.activeEditor?.editor;

  if (!editor) throw new Error("No active editor found.");

  try {
    const noteContent = await getNoteContent(app);
    const fileReferences = await extractLocalFileLinks(noteContent, app);

    if (!fileReferences.length) throw new Error("No file references found.");

    for (const fileReference of fileReferences) {
      const filePath = fileReference.path;
      const placeholder = fileReference.reference;

      const file = app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        const blob = await app.vault.readBinary(file);
        const fileToUpload = new File(
          [blob],
          settings.hashFileName ? await hashFile(new File([blob], file.name), settings.hashSeed) : sanitizeFileName(file.name),
          { type: getObsidianMimeType(file.extension) }
        );

        if (settings.useS3 || settings.useEagle) {
          uploads.push(processFile(fileToUpload, settings, app, placeholder));
        } else if (!settings.localUpload) {
          uploadsLocalFallback.push(processFile(fileToUpload, settings, app, placeholder));
        }
      }
    }
  } catch (error) {
    console.error("Error finding local files:", error);
    new Notice(`S3agle: ${error.message}`);
    return;
  }

  try {
    await Promise.all(uploads);
    new Notice("S3agle: All files processed and uploaded to S3 and/or Eagle.");
  } catch (error) {
    console.error("Error uploading all files:", error);
    if (!settings.localUpload) {
      try {
        await Promise.all(uploadsLocalFallback);
        new Notice("S3agle: Files failed to upload to S3/Eagle. All files processed and uploaded to local storage.");
      } catch (localError) {
        console.error("Error uploading all files locally:", localError);
        new Notice("S3agle: Failed to upload files. Check the console for details.");
      }
    }
  }
};
