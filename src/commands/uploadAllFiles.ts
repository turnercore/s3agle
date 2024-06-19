import { App, Command, Notice, TFile } from "obsidian";
import { extractLocalFileLinks, getNoteContent, getObsidianMimeType, hashFile, sanitizeFileName } from "../helpers";
import { processFile } from "../processFile";
import { S3agleSettings } from "../settings";

export const uploadAllFilesCommand = (app: App, settings: S3agleSettings): Command => {
  return {
    id: "upload-all-files",
    name: "Upload ALL files in document to S3/Eagle",
    callback: () => uploadAllFiles(app, settings),
  }
}

// Upload all Files to S3/Eagle
const uploadAllFiles = async (app: App, settings: S3agleSettings) => {
  // Try to find all the files and create a list of files to upload
  const uploads = []
  const uploadsLocalFallback = []
  const localUpload = settings.localUpload
  const editor = app.workspace.activeEditor?.editor
  if (!editor) throw new Error("No active editor found.")

  try {
    // Get the note content
    const noteContent = await getNoteContent(app)
    const fileReferences = await extractLocalFileLinks(noteContent, app)

    if (!fileReferences) throw new Error("No file references found.")

    for (const fileReference of fileReferences) {
      const filePath = fileReference.path
      const placeholder = fileReference.reference

      const file = app.vault.getAbstractFileByPath(filePath)
      if (file instanceof TFile) {
        const blob = await app.vault.readBinary(file)
        const fileToUpload = new File(
          [blob],
          settings.hashFileName ? await hashFile(new File([blob], file.name), settings.hashSeed) : sanitizeFileName(file.name),
          {
            type: getObsidianMimeType(file.extension),
          },
        )

        if (settings.useS3 || settings.useEagle) {
          uploads.push(
            processFile(
              fileToUpload,
              settings,
              app,
              placeholder,
            ),
          )
        } else {
          // If neither S3 nor Eagle is enabled, fallback to local upload
          uploads.push(
            processFile(
              fileToUpload,
              settings,
              app,
              placeholder,
            ),
          )
        }

        if (!localUpload) {
          uploadsLocalFallback.push(
            processFile(
              fileToUpload,
              settings,
              app,
              placeholder,
            ),
          )
        }
      }
    }
  } catch (error) {
    console.error("Error finding local files:", error)
    new Notice(`S3agle: ${error.message}`)
    return
  }

  // Try to upload all the files at once
  try {
    await Promise.all(uploads).then(() => {
      new Notice("S3agle: All files processed and uploaded to S3 and/or Eagle.")
    })
  } catch (error) {
    console.error("Error uploading all files:", error)
    // Try to upload all the files to local storage instead if S3 is on and fails.
    if (!localUpload) {
      try {
        await Promise.all(uploadsLocalFallback).then(() => {
          new Notice(
            "S3agle: Files failed to upload to S3/Eagle.\n All files processed and uploaded to local storage.",
          )
        })
      } catch (error) {
        console.error("Error uploading all files:", error)
        new Notice(
          "S3agle: Failed to upload files. Check the console for details.",
        )
      }
    }
  }
}
