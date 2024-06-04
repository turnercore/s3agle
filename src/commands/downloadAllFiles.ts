import { App, Command, Notice } from "obsidian";
import { extractFileNameFromUrl, isS3Url } from "../helpers";
import { S3agleSettings } from "../settings";
import { saveFileToVault } from "../vault/saveFileToVault";
import { downloadFileFromS3 } from "../s3/downloadFileFromS3";

export const downloadAllFilesCommand = (app: App, settings: S3agleSettings): Command => {
  return {
      id: "download-all-files",
      name: "Download ALL files from S3 to local",
      callback: () => downloadAllFiles(app, settings),
    }
  }

const downloadAllFiles = async (app:App, settings:S3agleSettings ) => {
    const noteFile = app.workspace.getActiveFile()
    if (!noteFile || !noteFile.name) return

    const noteContent = await app.vault.read(noteFile)
    const urlToLocal = new Map() // To store URL to local path mapping
    const uniqueUrls = new Set<string>() // To avoid downloading the same URL multiple times

    // Regex to extract all links starting with http:// or https:// within markdown links
    const linkRegex = /\[.*?\]\((https?:\/\/.*?)\)/g
    let match

    // Find all unique URLs
    while ((match = linkRegex.exec(noteContent)) !== null) {
      uniqueUrls.add(match[1])
    }

    // Download each file and map the URL to a local path
    for (const url of uniqueUrls) {
      try {
        if (!isS3Url(url, settings.contentUrl)) continue
        const fileName = extractFileNameFromUrl(url)
        const localPath = `${settings.localUploadFolder}/${fileName}`
        const fileData = await downloadFileFromS3(url) // Adjust this method to actually download files via HTTP
        const file = new File([fileData], fileName)
        await saveFileToVault(file, settings, app)
        urlToLocal.set(url, localPath)
      } catch (error) {
        console.error("Error downloading from URL:", url, error)
        new Notice("S3agle: Failed to download file: " + url)
      }
    }

    // Replace all URLs in the document content with local paths
    let updatedContent = noteContent
    urlToLocal.forEach((localPath, url) => {
      updatedContent = updatedContent.split(url).join(localPath) // Replace all instances of URL
    })

    // Save the updated note content
    await app.vault.modify(noteFile, updatedContent)
    new Notice("S3agle: All links have been updated to local paths.")
  }
