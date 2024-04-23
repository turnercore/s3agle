import {
  Editor,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  EditorPosition,
  FileSystemAdapter,
  RequestUrlParam,
  requestUrl,
  normalizePath,
  TFile,
} from "obsidian"
import {
  S3Client,
  PutObjectCommand,
  ListObjectsCommand,
} from "@aws-sdk/client-s3"
import { buildQueryString } from "@aws-sdk/querystring-builder"
import type { HttpHandlerOptions } from "@aws-sdk/types"
import {
  FetchHttpHandler,
  FetchHttpHandlerOptions,
} from "@aws-sdk/fetch-http-handler"
import { HttpRequest, HttpResponse } from "@aws-sdk/protocol-http"
import { requestTimeout } from "@smithy/fetch-http-handler/dist-es/request-timeout"

/**
 * Defines the settings structure for the S3agle Obsidian Plugin.
 */
interface S3agleSettings {
  s3Url: string // URL to the S3 server
  accessKey: string // AWS Access Key for S3 access
  secretKey: string // AWS Secret Key for S3 access
  region: string // AWS Region where the S3 bucket is located
  bucket: string // The name of the S3 bucket to use
  folder: string // Default folder path within the S3 bucket
  eagleApiUrl: string // URL to the Eagle API, usually localhost
  uploadOnDrag: boolean // Enable uploading files on drag-and-drop
  localFirst: boolean // Prefer local storage over S3 initially
  useEagle: boolean // Enable integration with Eagle software
  useS3: boolean // Enable integration with Amazon S3
  bypassCors: boolean // Bypass CORS restrictions
  forcePathStyle: boolean // Force path style URLs
  useCustomContentUrl: boolean // Use custom content URL bool
  customContentUrl: string // Custom content URL
  useCustomEndpoint: boolean // Use custom endpoint bool
  localUpload: boolean // Use local storage for uploads
  localUploadFolder: string // Folder in the local storage to save files
  uploadVideo: boolean // Upload video files
  uploadAudio: boolean // Upload audio files
  uploadPdf: boolean // Upload PDF files
  contentUrl: string // Content URL
}

/**
 * Default settings for the plugin.
 */
const DEFAULT_SETTINGS: S3agleSettings = {
  accessKey: "",
  secretKey: "",
  region: "",
  bucket: "",
  folder: "",
  useCustomEndpoint: false,
  s3Url: "",
  eagleApiUrl: "http://localhost:41595/",
  uploadOnDrag: true,
  localFirst: false,
  useEagle: true,
  useS3: true,
  bypassCors: false,
  forcePathStyle: false,
  useCustomContentUrl: false,
  customContentUrl: "",
  contentUrl: "",
  localUpload: false,
  localUploadFolder: "/attachments",
  uploadVideo: true,
  uploadAudio: true,
  uploadPdf: true,
}

interface pasteFunction {
  (this: HTMLElement, event: ClipboardEvent | DragEvent): void
}

type Folder = {
  id: string
  name: string
  parent: string
  children: Folder[]
}

/**
 * Main class for the S3agle Obsidian Plugin, extending the base Plugin class.
 */
export default class S3aglePlugin extends Plugin {
  settings: S3agleSettings
  s3: S3Client
  pasteFunction: pasteFunction

  private replaceText(
    editor: Editor,
    target: string,
    replacement: string,
  ): void {
    target = target.trim()
    const lines = editor.getValue().split("\n")
    for (let i = 0; i < lines.length; i++) {
      const ch = lines[i].indexOf(target)
      if (ch !== -1) {
        const from = { line: i, ch: ch } as EditorPosition
        const to = {
          line: i,
          ch: ch + target.length,
        } as EditorPosition
        editor.setCursor(from)
        editor.replaceRange(replacement, from, to)
        break
      }
    }
  }

  async pasteHandler(
    ev: ClipboardEvent | DragEvent,
    editor: Editor,
  ): Promise<void> {
    if (ev.defaultPrevented) return

    const noteFile = this.app.workspace.getActiveFile()
    if (!noteFile || !noteFile.name) return

    const fm = this.app.metadataCache.getFileCache(noteFile)?.frontmatter
    const localUpload =
      fm?.S3agleLocalOnly !== undefined
        ? fm?.S3agleLocalOnly
        : this.settings.localFirst || this.settings.useS3 === false

    let files: File[] = []
    switch (ev.type) {
      case "paste":
        files = Array.from((ev as ClipboardEvent).clipboardData?.files || [])
        break
      case "drop":
        if (!this.settings.uploadOnDrag && !(fm && fm.uploadOnDrag)) return
        files = Array.from((ev as DragEvent).dataTransfer?.files || [])
        break
    }

    if (files.length > 0) {
      ev.preventDefault()

      const uploads = files.map(async (file) => {
        const placeholder = `![Uploading ${file.name}…]()`
        editor.replaceSelection(placeholder)
        try {
          await this.processAndUploadFile(
            file,
            localUpload,
            editor,
            placeholder,
          )
        } catch (error) {
          // If there is an error and localUpload is false, try it again with localUpload set to true
          if (!localUpload) {
            try {
              await this.processAndUploadFile(file, true, editor, placeholder)
              new Notice(
                `S3agle: Error uploading file to S3.\n Reverted to local storage instead.`,
              )
            } catch (error) {
              console.error("Error uploading file:", error)
              new Notice(
                `S3agle: Error uploading file.\n Local Storage failed as well... Check console for details.`,
              )
            }
          }
        }
      })

      await Promise.all(uploads).then(() => {
        new Notice("S3agle: All files processed.")
      })
    }
  }

  async onload() {
    await this.loadSettings()

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new S3agleSettingTab(this.app, this))

    const apiEndpoint = this.settings.useCustomEndpoint
      ? this.settings.s3Url
      : `https://s3.${this.settings.region}.amazonaws.com/`

    // Set the content URL based on the settings and the API endpoint
    this.settings.contentUrl = this.settings.forcePathStyle
      ? apiEndpoint + this.settings.bucket + "/"
      : apiEndpoint.replace("://", `://${this.settings.bucket}.`)

    if (this.settings.useCustomContentUrl) {
      this.settings.contentUrl = this.settings.customContentUrl
      // Check to see if the custom content URL ends with a slash
      if (!this.settings.contentUrl.endsWith("/")) {
        this.settings.contentUrl += "/"
      }
      // Add the bucket name to the custom content URL if it's not already there
      if (!this.settings.contentUrl.includes(this.settings.bucket)) {
        this.settings.contentUrl += this.settings.bucket + "/"
      }
    }

    if (this.settings.bypassCors) {
      this.s3 = new S3Client({
        region: this.settings.region,
        credentials: {
          // clientConfig: { region: this.settings.region },
          accessKeyId: this.settings.accessKey,
          secretAccessKey: this.settings.secretKey,
        },
        endpoint: apiEndpoint,
        forcePathStyle: this.settings.forcePathStyle,
        requestHandler: new ObsHttpHandler(),
      })
    } else {
      this.s3 = new S3Client({
        region: this.settings.region,
        credentials: {
          // clientConfig: { region: this.settings.region },
          accessKeyId: this.settings.accessKey,
          secretAccessKey: this.settings.secretKey,
        },
        endpoint: apiEndpoint,
        forcePathStyle: this.settings.forcePathStyle,
        requestHandler: new ObsHttpHandler(),
      })
    }

    this.pasteFunction = this.pasteHandler.bind(this)

    this.registerEvent(
      this.app.workspace.on("editor-paste", this.pasteFunction),
    )
    this.registerEvent(this.app.workspace.on("editor-drop", this.pasteFunction))

    // Add command for uploading all linked local files in the current document to S3 and Eagle
    this.addCommand({
      id: "upload-all-files",
      name: "Upload ALL files in document to S3/Eagle",
      callback: () => this.uploadAllFiles(),
    })

    this.addCommand({
      id: "upload-one-file",
      name: "Upload ONE file in the document to S3/Eagle",
      callback: () => this.uploadOneFile(),
    })

    // Add command for downloading all linked S3 files in the current document to local storage
    this.addCommand({
      id: "download-all-files",
      name: "Download ALL files from S3 to local",
      callback: () => this.downloadAllFiles(),
    })

    this.addCommand({
      id: "download-one-file",
      name: "Download ONE file from S3 to local",
      callback: () => this.downloadOneFile(),
    })
  }

  onunload() {}

  // Main function that uploads the file to S3/Eagle and updates the document with the link
  async processAndUploadFile(
    file: File,
    localUpload: boolean,
    editor: Editor,
    placeholder: string,
  ): Promise<void> {
    let folder = localUpload
      ? this.settings.localUploadFolder
      : this.settings.folder
    const currentDate = new Date()
    folder = folder
      .replace("${year}", currentDate.getFullYear().toString())
      .replace("${month}", String(currentDate.getMonth() + 1).padStart(2, "0"))
      .replace("${day}", String(currentDate.getDate()).padStart(2, "0"))
    const sanitizedFileName = this.sanitizeFileName(file.name)
    const key = `${folder}/${sanitizedFileName}`
    let url = ""

    if (this.settings.useS3) {
      // Check to see if the file exists on S3
      let exists = false
      try {
        console.log(`checking if file exists: ${key}`)
        const response = await this.s3.send(
          new ListObjectsCommand({
            Bucket: this.settings.bucket,
            Prefix: key,
          }),
        )
        exists =
          response.Contents?.some((object) => object.Key === key) || false
      } catch (error) {
        console.log("Error checking if file exists:", error)
      }

      try {
        const buf = await file.arrayBuffer()
        if (!localUpload) {
          if (exists) {
            new Notice(
              `S3agle: File ${file.name} already exists in S3. Using existing URL.`,
            )
          } else {
            await this.s3.send(
              new PutObjectCommand({
                Bucket: this.settings.bucket,
                Key: key,
                Body: new Uint8Array(buf),
                ContentType: file.type,
              }),
            )
          }
          url = this.settings.contentUrl + key
        } else {
          await this.app.vault.adapter.writeBinary(key, new Uint8Array(buf))
          url =
            this.app.vault.adapter instanceof FileSystemAdapter
              ? this.app.vault.adapter.getFilePath(key)
              : key
        }
        const imgMarkdownText = wrapFileDependingOnType(
          url,
          this.detectFileType(file),
          "",
        )
        this.replaceText(editor, placeholder, imgMarkdownText)
      } catch (error) {
        console.error("Error uploading file:", error)
        new Notice(`S3agle: Error uploading file: ${error.message}`)
        throw error
      }
    }

    if (this.settings.useEagle) {
      // Get the file's type
      const fileType = this.detectFileType(file)
      // Find the folderId from the correct folder in Eagle
      const folderId = await this.getEagleFolderId(`Obsidian/${fileType}`)
      // Get the Eagle URL
      let eagleApiUrl = this.settings.eagleApiUrl
      if (eagleApiUrl.endsWith("/")) {
        //remove trailing slash
        eagleApiUrl = eagleApiUrl.slice(0, -1)
      }
      // We can upload via URL regardless of the file's location if Eagle is local
      // If Eagle is not local we will need to upload to S3 first
      if (url) {
        console.log("Uploading file to Eagle via URL")
        console.log(url)
        try {
          // Grab current note location
          const noteLocation = this.app.workspace.getActiveFile()?.path
          const obsidianURL = noteLocation
            ? `obsidian://open?path=${encodeURIComponent(noteLocation)}`
            : ""
          const data = {
            url,
            name: file.name,
            website: url,
            tags: ["Obsidian", "S3"],
            folderId,
            annotation: noteLocation
              ? `Uploaded from Obsidian note ${noteLocation}, ${obsidianURL}`
              : "Uploaded from Obsidian.",
          }
          const response = await fetch(eagleApiUrl + "/api/item/addFromURL", {
            method: "POST",
            body: JSON.stringify(data),
          })
          console.log(response)
          new Notice("S3agle: Uploaded file to Eagle.")
          if (!response.ok) {
            throw new Error("Failed to upload file to Eagle.")
          }
          return response.json()
        } catch (error) {
          new Notice(`S3agle: Failed to upload file to Eagle. ${error.message}`)
        }
      }
      // Otherwise we will have to save the file locally to the vault and upload from there
      else {
        new Notice("S3agle: Not implemented yet.")
      }
    }
  }

  //Get the Eagle Folder ID for the given path
  async getEagleFolderId(
    folderPath: string,
    createPathIfNotExist = true,
  ): Promise<string | null> {
    console.log("Getting Eagle Folder ID for path: ", folderPath)
    try {
      const requestOptions: RequestInit = {
        method: "GET",
        redirect: "follow",
      }

      let eagleApiUrl = this.settings.eagleApiUrl
      if (eagleApiUrl.endsWith("/")) {
        //remove trailing slash
        eagleApiUrl = eagleApiUrl.slice(0, -1)
      }

      const response = await fetch(
        eagleApiUrl + "/api/folder/list",
        requestOptions,
      )

      const result = await response.json()

      if (result.status === "success") {
        const pathParts = folderPath.split("/")
        const folder = await this.findFolderInTree(
          createPathIfNotExist,
          result.data,
          pathParts,
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
  async findFolderInTree(
    createPathIfNotExist: boolean,
    folders: Folder[],
    pathParts: string[],
    parentId = "",
  ): Promise<Folder | undefined> {
    if (pathParts.length === 0) {
      return
    }

    let eagleApiUrl = this.settings.eagleApiUrl
    if (eagleApiUrl.endsWith("/")) {
      //remove trailing slash
      eagleApiUrl = eagleApiUrl.slice(0, -1)
    }

    const folderName = pathParts[0]
    const endOfTree = pathParts.length === 1
    // Check for folder in the current list of folders
    const folder = folders.find((folder) => folder.name === folderName)
    if (folder && endOfTree) return folder
    if (folder && !endOfTree) {
      // Current folder is found, but we need to go deeper
      return this.findFolderInTree(
        createPathIfNotExist,
        folder.children,
        pathParts.slice(1),
        folder.id,
      )
    }
    if (!folder && createPathIfNotExist) {
      // Folder is not found and we need to create it
      const folderId = await this.createFolder(folderName, parentId)

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
          return this.findFolderInTree(
            createPathIfNotExist,
            folders,
            pathParts.slice(1),
            folderId,
          )
        }
      } else return
    }
  }

  //Create a folder in Eagle
  async createFolder(
    folderName: string,
    parentId: string,
  ): Promise<string | null> {
    try {
      let eagleApiUrl = this.settings.eagleApiUrl
      if (eagleApiUrl.endsWith("/")) {
        //remove trailing slash
        eagleApiUrl = eagleApiUrl.slice(0, -1)
      }

      const data = {
        folderName,
        parent: parentId,
      }

      const response = await fetch(eagleApiUrl + "/api/folder/create", {
        method: "POST",
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error("Failed to create folder in Eagle.")
      }

      interface expectedResponse {
        status: string
        data: Folder
      }

      const dataObject: expectedResponse = await response.json()

      console.log(`created folder with id ${dataObject.data.id}`)

      return dataObject.data.id || null
    } catch (error) {
      console.error("Failed to create folder in Eagle:", error)
      return null
    }
  }

  //Fetch the data from the plugin settings
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  //Save the plugin settings
  async saveSettings() {
    await this.saveData(this.settings)
  }

  //Upload all Files to S3/Eagle
  async uploadAllFiles() {
    try {
      const editor = this.app.workspace.activeEditor?.editor
      if (!editor) return

      const noteFile = this.app.workspace.getActiveFile()
      if (!noteFile || !noteFile.name) return

      const noteContent = await this.app.vault.read(noteFile)
      // This regex should capture markdown links and Obsidian embeds
      const localFileRegex = /(!?\[\[)(.*?)(\]\])|(!?\[.*?\])\((.*?)(\))/g
      let match
      const uploads = []
      const uploadsLocalFallback = []
      const localUpload = this.settings.localUpload

      while ((match = localFileRegex.exec(noteContent)) !== null) {
        // Determine if the link is a standard markdown or Obsidian embed and extract the path
        const filePath = match[2] || match[5]
        if (!filePath || !this.isFileEligible(filePath)) continue // Skip if not an eligible file

        const file = await this.app.vault.getAbstractFileByPath(filePath)
        if (file instanceof TFile) {
          const blob = await this.app.vault.readBinary(file)
          const fileToUpload = new File([blob], file.name, {
            type: this.getObsidianMimeType(file.extension),
          })

          // Use the entire matched string as the placeholder
          const placeholder = match[0]

          // Upload the file and replace the placeholder with the URL in the document
          uploads.push(
            this.processAndUploadFile(
              fileToUpload,
              localUpload,
              editor,
              placeholder,
            ),
          )
          if (!localUpload) {
            uploadsLocalFallback.push(
              this.processAndUploadFile(
                fileToUpload,
                true,
                editor,
                placeholder,
              ),
            )
          }
        }
      }

      // Try to upload all the files
      try {
        await Promise.all(uploads).then(() => {
          new Notice("S3agle: All files processed and uploaded to S3.")
        })
      } catch (error) {
        console.error("Error uploading all files:", error)
        // Try to upload all the files to local storage instead if S3 is on and fails.
        if (!localUpload) {
          try {
            await Promise.all(uploadsLocalFallback).then(() => {
              new Notice(
                "S3agle: Files failed to upload to S3.\n All files processed and uploaded to local storage.",
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
    } catch (error) {
      console.error("Error uploading all files:", error)
      new Notice(
        "S3agle: Failed to upload files. Check the console for details.",
      )
    }
  }

  //Pick a file from the list and upload it to S3/Eagle
  async uploadOneFile() {
    try {
      new Notice("S3agle: Not implemented yet.")
    } catch (error) {
      console.error("Error uploading one file:", error)
      new Notice(
        "S3agle: Failed to upload file. Check the console for details.",
      )
    }
  }

  //Download all Files from S3 to local/Eagle
  async downloadAllFiles() {
    const noteFile = this.app.workspace.getActiveFile()
    if (!noteFile || !noteFile.name) return

    const noteContent = await this.app.vault.read(noteFile)
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
        if (!this.isUrlS3(url)) continue
        const fileName = this.extractFileNameFromUrl(url)
        const localPath = `${this.settings.localUploadFolder}/${fileName}`
        const fileData = await this.downloadFileFromS3(url) // Adjust this method to actually download files via HTTP
        await this.saveFileToVault(fileData, localPath)
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
    await this.app.vault.modify(noteFile, updatedContent)
    new Notice("S3agle: All links have been updated to local paths.")
  }

  //Download one file from S3 to local/Eagle
  async downloadOneFile() {
    try {
      new Notice("S3agle: Not implemented yet.")
    } catch (error) {
      console.error("Error uploading one file:", error)
      new Notice(
        "S3agle: Failed to download file. Check the console for details.",
      )
    }
  }

  //Save the file locally in the vault
  async saveFileToVault(
    data: ArrayBuffer | Uint8Array,
    path: string,
  ): Promise<void> {
    console.log("Starting file save process...")

    // Check if the folder exists, create if not
    const folderPath = normalizePath(this.settings.localUploadFolder)
    if (folderPath && !(await this.app.vault.adapter.exists(folderPath))) {
      await this.app.vault.createFolder(folderPath)
    } else {
      console.log(`Folder already exists: ${folderPath}`)
    }

    // Save the file in the vault
    try {
      await this.app.vault.createBinary(path, new Uint8Array(data))
      new Notice(`S3agle: File saved successfully in vault at: ${path}`)
    } catch (error) {
      new Notice("S3agle: Failed to save file in vault.")
    }
  }

  async downloadFileFromS3(url: string) {
    //This downloads the file from the S3 link, but this should maybe be replaced with S3 API calls
    const response = await fetch(url)
    if (!response.ok) throw new Error("Network response was not ok.")
    return new Uint8Array(await response.arrayBuffer()) // Assuming binary data
  }

  // Helper functions for processing files
  isFileEligible(filePath: string) {
    const lowerPath = filePath.toLowerCase()
    return /\.(jpg|jpeg|png|gif|pdf|mp4|webm)$/.test(lowerPath)
  }

  getObsidianMimeType(extension: string): string {
    switch (extension) {
      case "jpg":
      case "jpeg":
        return "image/jpeg"
      case "png":
        return "image/png"
      case "gif":
        return "image/gif"
      case "webp":
        return "image/webp"
      case "svg":
        return "image/svg+xml"
      case "mp4":
        return "video/mp4"
      case "webm":
        return "video/webm"
      case "ogg":
        return "video/ogg"
      case "mp3":
        return "audio/mp3"
      case "wav":
        return "audio/wav"
      case "flac":
        return "audio/flac"
      case "pdf":
        return "application/pdf"
      default:
        return "application/octet-stream"
    }
  }

  detectFileType(file: File): string {
    if (file.type.startsWith("image")) {
      return "image"
    } else if (file.type.startsWith("video")) {
      return "video"
    } else if (file.type.startsWith("audio")) {
      return "audio"
    } else if (file.type === "application/pdf") {
      return "pdf"
    } else if (
      file.type.includes("presentation") ||
      file.type.includes("powerpoint")
    ) {
      return "ppt"
    } else {
      throw new Error(`Unsupported file type: ${file.type}`)
    }
  }
  sanitizeFileName(filename: string): string {
    // Replace spaces with underscores and remove any problematic characters
    return filename
      .replace(/\s+/g, "_") // Replace spaces with underscores
      .replace(/[^\w.-]/g, "") // Remove all non-word characters except dots and dashes
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Normalize diacritics
  }
  escapeRegExp(text: string) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")
  }
  isUrlS3(url: string): boolean {
    // Ensure that the contentUrl ends with a slash for consistent comparison
    const normalizedContentUrl = this.settings.contentUrl.endsWith("/")
      ? this.settings.contentUrl
      : this.settings.contentUrl + "/"

    // Check if the provided URL starts with the normalized content URL
    return url.startsWith(normalizedContentUrl)
  }
  extractFileNameFromUrl(url: string): string {
    // Remove any query parameters
    let filename = url.split("?")[0] // Discards query parameters if any
    filename = filename.substring(filename.lastIndexOf("/") + 1) // Gets the last segment after the last '/'

    // Decode URI components
    filename = decodeURIComponent(filename)

    // Replace any characters that are not allowed in filenames
    // eslint-disable-next-line no-control-regex
    const invalidChars = /[<>:"/\\|?*\x00-\x1F]/g // Regex to find invalid characters
    const replacementChar = "_" // Replacement character for invalid characters in filenames

    filename = filename.replace(invalidChars, replacementChar)

    return filename
  }
}

class S3agleSettingTab extends PluginSettingTab {
  plugin: S3aglePlugin

  display() {
    const { containerEl } = this
    containerEl.empty()

    containerEl.createEl("h2", { text: "S3agle Plugin Settings" })

    new Setting(containerEl)
      .setName("AWS Access Key ID")
      .setDesc("AWS access key ID for S3 access.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.accessKey)
          .onChange(async (value) => {
            this.plugin.settings.accessKey = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("AWS Secret Access Key")
      .setDesc("AWS secret access key for S3 access.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.secretKey)
          .onChange(async (value) => {
            this.plugin.settings.secretKey = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("S3 Bucket")
      .setDesc("Name of the S3 bucket.")
      .addText((text) =>
        text.setValue(this.plugin.settings.bucket).onChange(async (value) => {
          this.plugin.settings.bucket = value.trim()
          await this.plugin.saveSettings()
        }),
      )

    new Setting(containerEl)
      .setName("S3 Region")
      .setDesc("Name of the S3 region.")
      .addText((text) =>
        text.setValue(this.plugin.settings.region).onChange(async (value) => {
          this.plugin.settings.region = value.trim()
          await this.plugin.saveSettings()
        }),
      )

    new Setting(containerEl)
      .setName("S3 Folder Path")
      .setDesc("The default folder path within the S3 bucket.")
      .addText((text) =>
        text.setValue(this.plugin.settings.folder).onChange(async (value) => {
          this.plugin.settings.folder = value.trim()
          await this.plugin.saveSettings()
        }),
      )

    new Setting(containerEl)
      .setName("Eagle API URL")
      .setDesc("URL to the Eagle API, usually localhost.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.eagleApiUrl)
          .onChange(async (value) => {
            this.plugin.settings.eagleApiUrl = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Use custom S3 endpoint")
      .setDesc("Use the custom api endpoint below.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.useCustomEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.useCustomEndpoint = value
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName("Custom S3 Endpoint")
      .setDesc(
        "Optionally set a custom endpoint for any S3 compatible storage provider.",
      )
      .addText((text) =>
        text
          .setPlaceholder("https://s3.myhost.com/")
          .setValue(this.plugin.settings.s3Url)
          .onChange(async (value) => {
            value = value.match(/https?:\/\//) // Force to start http(s)://
              ? value
              : "https://" + value
            value = value.replace(/([^/])$/, "$1/") // Force to end with slash
            this.plugin.settings.s3Url = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    // new Setting(containerEl)
    //   .setName("S3 Path Style URLs")
    //   .setDesc(
    //     "Advanced option to force using (legacy) path-style s3 URLs (s3.myhost.com/bucket) instead of the modern AWS standard host-style (bucket.s3.myhost.com).",
    //   )
    //   .addToggle((toggle) => {
    //     toggle
    //       .setValue(this.plugin.settings.forcePathStyle)
    //       .onChange(async (value) => {
    //         this.plugin.settings.forcePathStyle = value
    //         await this.plugin.saveSettings()
    //       })
    //   })

    new Setting(containerEl)
      .setName("Local Upload Folder")
      .setDesc(
        "The folder to put new files in locally if not using Eagle integration.",
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.localUploadFolder)
          .onChange(async (value) => {
            this.plugin.settings.localUploadFolder = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Use custom content URL")
      .setDesc("Use the custom content URL below.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.useCustomContentUrl)
          .onChange(async (value) => {
            this.plugin.settings.useCustomContentUrl = value
            await this.plugin.saveSettings()
          })
      })

    new Setting(containerEl)
      .setName("Custom Content URL")
      .setDesc(
        "Advanced option to force inserting custom image URLs. This option is helpful if you are using CDN.",
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.customContentUrl)
          .onChange(async (value) => {
            value = value.match(/https?:\/\//) // Force to start http(s)://
              ? value
              : "https://" + value
            value = value.replace(/([^/])$/, "$1/") // Force to end with slash
            this.plugin.settings.customContentUrl = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Enable Upload on Drag")
      .setDesc("Enable uploading files on drag-and-drop.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.uploadOnDrag)
          .onChange(async (value) => {
            this.plugin.settings.uploadOnDrag = value
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Use Local Storage First")
      .setDesc("Prefer local storage over S3 initially.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.localFirst)
          .onChange(async (value) => {
            this.plugin.settings.localFirst = value
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Enable Eagle Integration")
      .setDesc("Enable integration with Eagle software.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useEagle)
          .onChange(async (value) => {
            this.plugin.settings.useEagle = value
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Enable S3 Integration")
      .setDesc("Enable integration with Amazon S3.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useS3).onChange(async (value) => {
          this.plugin.settings.useS3 = value
          await this.plugin.saveSettings()
        }),
      )

    // Include any additional settings as needed
  }
}

// Let's you hide fields from cleartext, but not implimented
// const wrapTextWithPasswordHide = (text: TextComponent) => {
//   const hider = text.inputEl.insertAdjacentElement("beforebegin", createSpan())
//   if (!hider) {
//     return
//   }
//   setIcon(hider as HTMLElement, "eye-off")

//   hider.addEventListener("click", () => {
//     const isText = text.inputEl.getAttribute("type") === "text"
//     if (isText) {
//       setIcon(hider as HTMLElement, "eye-off")
//       text.inputEl.setAttribute("type", "password")
//     } else {
//       setIcon(hider as HTMLElement, "eye")
//       text.inputEl.setAttribute("type", "text")
//     }
//     text.inputEl.focus()
//   })
//   text.inputEl.setAttribute("type", "password")
//   return text
// }

// Creates the correct kind of markdown link based on the filetype so that the file will preview correctly in Obsidian
const wrapFileDependingOnType = (
  location: string,
  type: string,
  localBase: string,
) => {
  const srcPrefix = localBase ? "file://" + localBase + "/" : ""

  if (type === "image") {
    return `![image](${location})`
  } else if (type === "video") {
    return `<video src="${srcPrefix}${location}" controls />`
  } else if (type === "audio") {
    return `<audio src="${srcPrefix}${location}" controls />`
  } else if (type === "pdf") {
    if (localBase) {
      throw new Error("PDFs cannot be embedded in local mode")
    }
    return `<iframe frameborder=0 border=0 width=100% height=800
		src="https://docs.google.com/viewer?embedded=true&url=${location}?raw=true">
		</iframe>`
  } else if (type === "ppt") {
    return `<iframe
	    src='https://view.officeapps.live.com/op/embed.aspx?src=${location}' 
	    width='100%' height='600px' frameborder='0'>
	  </iframe>`
  } else {
    throw new Error("Unknown file type")
  }
}

////////////////////////////////////////////////////////////////////////////////
// special handler using Obsidian requestUrl
////////////////////////////////////////////////////////////////////////////////

/**
 * This is close to origin implementation of FetchHttpHandler
 * https://github.com/aws/aws-sdk-js-v3/blob/main/packages/fetch-http-handler/src/fetch-http-handler.ts
 * that is released under Apache 2 License.
 * But this uses Obsidian requestUrl instead.
 */
class ObsHttpHandler extends FetchHttpHandler {
  requestTimeoutInMs: number | undefined
  constructor(options?: FetchHttpHandlerOptions) {
    super(options)
    this.requestTimeoutInMs =
      options === undefined ? undefined : options.requestTimeout
  }
  async handle(
    request: HttpRequest,
    { abortSignal }: HttpHandlerOptions = {},
  ): Promise<{ response: HttpResponse }> {
    if (abortSignal?.aborted) {
      const abortError = new Error("Request aborted")
      abortError.name = "AbortError"
      return Promise.reject(abortError)
    }

    let path = request.path
    if (request.query) {
      const queryString = buildQueryString(request.query)
      if (queryString) {
        path += `?${queryString}`
      }
    }

    const { port, method } = request
    const url = `${request.protocol}//${request.hostname}${
      port ? `:${port}` : ""
    }${path}`
    const body =
      method === "GET" || method === "HEAD" ? undefined : request.body

    const transformedHeaders: Record<string, string> = {}
    for (const key of Object.keys(request.headers)) {
      const keyLower = key.toLowerCase()
      if (keyLower === "host" || keyLower === "content-length") {
        continue
      }
      transformedHeaders[keyLower] = request.headers[key]
    }

    let contentType: string | undefined = undefined
    if (transformedHeaders["content-type"] !== undefined) {
      contentType = transformedHeaders["content-type"]
    }

    let transformedBody = body
    if (ArrayBuffer.isView(body)) {
      transformedBody = bufferToArrayBuffer(body)
    }

    const param: RequestUrlParam = {
      body: transformedBody,
      headers: transformedHeaders,
      method: method,
      url: url,
      contentType: contentType,
    }

    const raceOfPromises = [
      requestUrl(param).then((rsp) => {
        const headers = rsp.headers
        const headersLower: Record<string, string> = {}
        for (const key of Object.keys(headers)) {
          headersLower[key.toLowerCase()] = headers[key]
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(rsp.arrayBuffer))
            controller.close()
          },
        })
        return {
          response: new HttpResponse({
            headers: headersLower,
            statusCode: rsp.status,
            body: stream,
          }),
        }
      }),
      requestTimeout(this.requestTimeoutInMs),
    ]

    if (abortSignal) {
      raceOfPromises.push(
        new Promise<never>((resolve, reject) => {
          abortSignal.onabort = () => {
            const abortError = new Error("Request aborted")
            abortError.name = "AbortError"
            reject(abortError)
          }
        }),
      )
    }
    return Promise.race(raceOfPromises)
  }
}

const bufferToArrayBuffer = (b: Buffer | Uint8Array | ArrayBufferView) => {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
