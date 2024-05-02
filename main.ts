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
  SuggestModal,
  App,
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
import { randomInt } from "crypto"

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
  useEagle: boolean // Enable integration with Eagle software
  useS3: boolean // Enable integration with  S3
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
  hashFileName: boolean // Hash the file name before uploading
  hashSeed: number // Seed for hashing the file name
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
  s3Url: "s3.amazonaws.com",
  eagleApiUrl: "http://localhost:41595/",
  uploadOnDrag: true,
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
  hashFileName: false,
  hashSeed: 0,
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

type FileReference = {
  path: string
  name: string
  reference: string // This is the whole string that contains the file as well as the markdown around it
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
    // Determine if the file should be uploaded to S3 or local storage
    const localUpload =
      fm?.S3agleLocalOnly !== undefined
        ? fm?.S3agleLocalOnly
        : this.settings.useS3 === false

    let files: File[] = []
    switch (ev.type) {
      case "paste":
        files = Array.from((ev as ClipboardEvent).clipboardData?.files || [])
        break
      case "drop":
        if (!this.settings.uploadOnDrag && !(fm && fm.S3eagleUploadOnDrag))
          return
        files = Array.from((ev as DragEvent).dataTransfer?.files || [])
        break
    }

    if (files.length > 0) {
      ev.preventDefault()

      const uploads = files.map(async (file) => {
        const fileName = this.hashNameIfNeeded(file.name)
        const placeholder = `![Uploading ${fileName}…]`
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

    // In progress
    // this.addCommand({
    //   id: "upload-one-file",
    //   name: "Upload ONE file in the document to S3/Eagle",
    //   callback: async () => {
    //     const modal = new FileActionSuggestModal(
    //       app,
    //       this.settings.contentUrl,
    //       "local",
    //       this.uploadOneFile,
    //     )
    //     modal.open()
    //   },
    // })

    // Add command for downloading all linked S3 files in the current document to local storage
    this.addCommand({
      id: "download-all-files",
      name: "Download ALL files from S3 to local",
      callback: () => this.downloadAllFiles(),
    })

    //In progress
    //   this.addCommand({
    //     id: "download-one-file",
    //     name: "Download a file from S3 to Local.",
    //     callback: async () => {
    //       const modal = new FileActionSuggestModal(
    //         app,
    //         this.settings.contentUrl,
    //         "s3",
    //         this.downloadOneFile,
    //       )
    //       modal.open()
    //     },
    //   })
  }

  suggestFilesToDownload() {
    //Display a list of the S3 files in the current note and allow the user to select one to download
  }

  suggestFilesToUpload() {
    //Display a list of the local files in the current note and allow the user to select one to upload
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
    const sanitizedFileName = sanitizeFileName(file.name)
    const key = `${folder}/${sanitizedFileName}`
    let url = ""

    if (this.settings.useS3) {
      // Check to see if the file exists on S3
      let exists = false
      try {
        const response = await this.s3.send(
          new ListObjectsCommand({
            Bucket: this.settings.bucket,
            Prefix: key,
          }),
        )
        exists =
          response.Contents?.some((object) => object.Key === key) || false
      } catch (error) {
        console.error("Error checking if file exists:", error)
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
          detectFileType(file),
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
      const fileType = detectFileType(file)
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
        try {
          // Grab current note location
          const fileName = this.hashNameIfNeeded(file.name)
          const noteLocation = this.app.workspace.getActiveFile()?.path
          const obsidianURL = noteLocation
            ? `obsidian://open?path=${encodeURIComponent(noteLocation)}`
            : ""
          const data = {
            url,
            name: fileName,
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

  // hash a string
  hashString = (str: string): string => {
    let hash = this.settings.hashSeed
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      // Multiplying by a prime number before XORing helps distribute the values more uniformly
      hash = (hash * 33) ^ char // ^ is XOR operation
    }
    // Convert to a positive 32-bit integer and return as a string
    return (hash >>> 0).toString()
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
    // Try to find all the files and create a list of files to upload
    const uploads = []
    const uploadsLocalFallback = []
    const localUpload = this.settings.localUpload
    const editor = this.app.workspace.activeEditor?.editor
    if (!editor) throw new Error("No active editor found.")

    try {
      // Get the note content
      const noteContent = await getNoteContent(this.app)
      const fileReferences = await extractLocalFileLinks(noteContent, this.app)

      if (!fileReferences) throw new Error("No file references found.")

      for (const fileReference of fileReferences) {
        const filePath = fileReference.path
        const placeholder = fileReference.reference

        const file = this.app.vault.getAbstractFileByPath(filePath)
        if (file instanceof TFile) {
          const blob = await this.app.vault.readBinary(file)
          const fileToUpload = new File(
            [blob],
            this.hashNameIfNeeded(file.name),
            {
              type: getObsidianMimeType(file.extension),
            },
          )
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
    } catch (error) {
      console.error("Error finding local files:", error)
      new Notice(`S3agle: ${error.message}`)
      return
    }

    // Try to upload all the files at once
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
        if (!isS3Url(url, this.settings.contentUrl)) continue
        const fileName = extractFileNameFromUrl(url)
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
  async downloadOneFile(file: FileReference) {
    try {
      if (!isS3Url(file.path, this.settings.contentUrl)) {
        new Notice("S3agle: Not an S3 URL.")
        return
      }
      const fileName = extractFileNameFromUrl(file.path)
      const localPath = `${this.settings.localUploadFolder}/${fileName}`
      // See if a file exists in the vault at that path
      if (await this.app.vault.adapter.exists(localPath)) {
        new Notice(`S3agle: File already exists at ${localPath}`)
        return
      }
      const fileData = await this.downloadFileFromS3(file.path) // Adjust this method to actually download files via HTTP
      await this.saveFileToVault(fileData, localPath)
      if (this.settings.useEagle) {
        // TODO: See if the file is in Eagle and if not upload it to eagle
      }
      new Notice(`S3agle: File downloaded to ${localPath}`)
    } catch (error) {
      console.error("Error uploading one file:", error)
      new Notice(
        "S3agle: Failed to download file. Check the console for details.",
      )
    }
  }

  // Save the file locally in the vault
  async saveFileToVault(
    data: ArrayBuffer | Uint8Array,
    path: string,
  ): Promise<void> {
    // Check if the folder exists, create if not
    const folderPath = normalizePath(this.settings.localUploadFolder)
    if (folderPath && !(await this.app.vault.adapter.exists(folderPath))) {
      await this.app.vault.createFolder(folderPath)
    }

    // Save the file in the vault
    try {
      await this.app.vault.createBinary(path, new Uint8Array(data))
      new Notice(`S3agle: File saved successfully in vault at: ${path}`)
    } catch (error) {
      new Notice("S3agle: Failed to save file in vault.")
    }
  }

  // Download a file from S3, todo: replace with aws download method
  async downloadFileFromS3(url: string) {
    //This downloads the file from the S3 link, but this should maybe be replaced with S3 API calls
    const response = await fetch(url)
    if (!response.ok) throw new Error("Network response was not ok.")
    return new Uint8Array(await response.arrayBuffer()) // Assuming binary data
  }

  // hash file name if needed
  hashNameIfNeeded(fileName: string): string {
    return this.settings.hashFileName ? this.hashString(fileName) : fileName
  }
}

class S3agleSettingTab extends PluginSettingTab {
  plugin: S3aglePlugin

  display() {
    const { containerEl } = this
    containerEl.empty()

    this.drawGeneralSettings(containerEl)
    this.drawS3Settings(containerEl)
    this.drawEagleSettings(containerEl)
  }

  drawGeneralSettings(containerEl: HTMLElement) {
    // General settings without a heading
    new Setting(containerEl)
      .setName("Upload on drag-and-drop")
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
      .setName("Hash file names")
      .setDesc("Hash the file name before uploading.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hashFileName)
          .onChange(async (value) => {
            this.plugin.settings.hashFileName = value
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Reset hash seed")
      .setDesc(
        "Reset the seed used for hashing file names. Used if you need to upload the same file again and want it to hash to a different name.",
      )
      .addButton((button) =>
        button.setButtonText("Reset Seed").onClick(async () => {
          this.plugin.settings.hashSeed = randomInt(1000000)
          await this.plugin.saveSettings()
          new Notice("S3agle: Hash seed reset.")
        }),
      )

    // new Setting(containerEl)
    //   .setName("Bypass CORS restrictions")
    //   .setDesc(
    //     "Bypass Cross-Origin Resource Sharing (CORS) restrictions when accessing S3.",
    //   )
    //   .addToggle((toggle) =>
    //     toggle
    //       .setValue(this.plugin.settings.bypassCors)
    //       .onChange(async (value) => {
    //         this.plugin.settings.bypassCors = value
    //         await this.plugin.saveSettings()
    //       }),
    //   )

    // new Setting(containerEl)
    //   .setName("Force path style URLs")
    //   .setDesc(
    //     "Force path style URLs for S3 requests. Useful for S3-compatible storage providers.",
    //   )
    //   .addToggle((toggle) =>
    //     toggle
    //       .setValue(this.plugin.settings.forcePathStyle)
    //       .onChange(async (value) => {
    //         this.plugin.settings.forcePathStyle = value
    //         await this.plugin.saveSettings()
    //       }),
    //   )
  }

  drawS3Settings(containerEl: HTMLElement) {
    new Setting(containerEl).setName("S3").setHeading()

    new Setting(containerEl)
      .setName("Enable S3 integration")
      .setDesc("Enable integration with S3.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useS3).onChange(async (value) => {
          this.plugin.settings.useS3 = value
          await this.plugin.saveSettings()
          this.display() // Redraw to show/hide S3 settings dynamically
        }),
      )

    if (this.plugin.settings.useS3) {
      this.drawAdditionalS3Settings(containerEl)
    }
  }

  drawAdditionalS3Settings(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName("Access key ID")
      .setDesc("Access key ID for S3 access.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.accessKey)
          .onChange(async (value) => {
            this.plugin.settings.accessKey = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Secret key")
      .setDesc("Secret key for S3 access.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.secretKey)
          .onChange(async (value) => {
            this.plugin.settings.secretKey = value.trim()
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("S3 bucket name")
      .setDesc("Name of the S3 bucket.")
      .addText((text) =>
        text.setValue(this.plugin.settings.bucket).onChange(async (value) => {
          this.plugin.settings.bucket = value.trim()
          await this.plugin.saveSettings()
        }),
      )
    new Setting(containerEl)
      .setName("S3 region")
      .setDesc("Name of the S3 region.")
      .addText((text) =>
        text.setValue(this.plugin.settings.region).onChange(async (value) => {
          this.plugin.settings.region = value.trim()
          await this.plugin.saveSettings()
        }),
      )

    new Setting(containerEl)
      .setName("S3 folder path")
      .setDesc("The default folder path within the S3 bucket. (Optional)")
      .addText((text) =>
        text.setValue(this.plugin.settings.folder).onChange(async (value) => {
          this.plugin.settings.folder = value.trim()
          await this.plugin.saveSettings()
        }),
      )

    // new Setting(containerEl)
    //   .setName("Use custom S3 endpoint")
    //   .setDesc(
    //     "Specify a custom endpoint for any S3 compatible storage provider.",
    //   )
    //   .addToggle((toggle) =>
    //     toggle
    //       .setValue(this.plugin.settings.useCustomEndpoint)
    //       .onChange(async (value) => {
    //         this.plugin.settings.useCustomEndpoint = value
    //         await this.plugin.saveSettings()
    //         this.display() // Redraw settings to show or hide custom endpoint URL field
    //       }),
    //   )
    new Setting(containerEl)
      .setName("S3 endpoint")
      .setDesc("Enter the S3 endpoint URL. Will default to Amazon's S3.")
      .addText((text) =>
        text.setValue(this.plugin.settings.s3Url).onChange(async (value) => {
          this.plugin.settings.s3Url = value.trim()
          await this.plugin.saveSettings()
        }),
      )

    new Setting(containerEl)
      .setName("Use custom content URL")
      .setDesc(
        "Specify a custom content URL for the S3 bucket. Will default to Amazon's S3.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useCustomContentUrl)
          .onChange(async (value) => {
            this.plugin.settings.useCustomContentUrl = value
            await this.plugin.saveSettings()
            this.display() // Redraw settings to show or hide custom content URL field
          }),
      )

    if (this.plugin.settings.useCustomContentUrl) {
      new Setting(containerEl)
        .setName("Custom content URL")
        .setDesc("Enter the custom content URL for the S3 bucket.")
        .addText((text) =>
          text
            .setValue(this.plugin.settings.customContentUrl)
            .onChange(async (value) => {
              this.plugin.settings.customContentUrl = value.trim()
              await this.plugin.saveSettings()
            }),
        )
    }
  }

  drawEagleSettings(containerEl: HTMLElement) {
    new Setting(containerEl).setName("Eagle").setHeading()

    new Setting(containerEl)
      .setName("Enable Eagle integration")
      .setDesc("Enable integration with Eagle for local file management.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useEagle)
          .onChange(async (value) => {
            this.plugin.settings.useEagle = value
            await this.plugin.saveSettings()
            this.display() // Redraw to show/hide Eagle settings dynamically
          }),
      )

    if (this.plugin.settings.useEagle) {
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
        .setName("Local upload folder")
        .setDesc("The folder to store new files in locally if not using S3.")
        .addText((text) =>
          text
            .setValue(this.plugin.settings.localUploadFolder)
            .onChange(async (value) => {
              this.plugin.settings.localUploadFolder = value.trim()
              await this.plugin.saveSettings()
            }),
        )
    }
  }
}

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
    return `[file](${location})`
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
//ignore unused, this is in progress for upload/download a single file.
//eslint-disable-next-line @typescript-eslint/no-unused-vars
class FileActionSuggestModal extends SuggestModal<FileReference> {
  private fileReferences: FileReference[] = []
  private actionCallback: (fileRef: FileReference) => void
  contentUrl: string
  localOrS3: "local" | "s3"

  constructor(
    app: App,
    contentUrl: string,
    localOrS3: "local" | "s3",
    actionCallback: (fileRef: FileReference) => void,
  ) {
    super(app)
    this.contentUrl = contentUrl
    this.localOrS3 = localOrS3
    this.actionCallback = actionCallback
    this.setPlaceholder("Type to filter files...")
  }

  async getFileReferences(): Promise<void> {
    const noteContent = await getNoteContent(this.app)

    switch (this.localOrS3) {
      case "local": {
        // Get all the files locally in the current note
        this.fileReferences = await extractLocalFileLinks(noteContent, this.app)
        break
      }
      case "s3": {
        // Get all the S3 files in the current note
        const s3FileLinks = await extractS3FileLinks(
          noteContent,
          this.contentUrl,
        )
        this.fileReferences = s3FileLinks
        break
      }
      default:
        return
    }
  }

  async onOpen(): Promise<void> {
    await this.getFileReferences()
    for (const fileRef of this.fileReferences) {
      this.renderSuggestion(fileRef, this.inputEl)
    }
  }

  // onClose clean up suggestions
  onClose(): void {
    this.fileReferences = []
  }

  getItemText(fileRef: FileReference): string {
    return fileRef.name // Display the file name in the suggester
  }

  onChooseItem(item: FileReference, _evt: MouseEvent | KeyboardEvent): void {
    this.actionCallback(item) // Execute the callback with the selected file reference
  }

  getSuggestions(query: string): FileReference[] {
    const lowerQuery = query.toLowerCase()
    return this.fileReferences.filter((fileRef) =>
      fileRef.name.toLowerCase().includes(lowerQuery),
    )
  }

  onChooseSuggestion(item: FileReference, evt: MouseEvent | KeyboardEvent) {
    this.actionCallback(item)
  }

  renderSuggestion(fileRef: FileReference, el: HTMLElement): void {
    el.createDiv({ text: fileRef.name })
  }
}

const getObsidianMimeType = (extension: string): string => {
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

const detectFileType = (file: File): string => {
  if (file.type.startsWith("image")) {
    return "image"
  } else if (file.type.startsWith("video")) {
    return "video"
  } else if (file.type.startsWith("audio")) {
    return "audio"
  } else if (file.type.startsWith("text")) {
    return "text"
  } else if (file.type === "application/pdf") {
    return "pdf"
  } else if (
    file.type.includes("presentation") ||
    file.type.includes("powerpoint")
  ) {
    return "ppt"
  } else if (file.type.includes("spreadsheet") || file.type.includes("excel")) {
    return "xls"
  } else if (file.type.includes("zip")) {
    return "zip"
  } else {
    throw new Error(`Unsupported file type: ${file.type}`)
  }
}

const sanitizeFileName = (filename: string): string => {
  // Replace spaces with underscores and remove any problematic characters
  return filename
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/[^\w.-]/g, "") // Remove all non-word characters except dots and dashes
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Normalize diacritics
}

//Makes sure the url part ends with a /
const normalizeUrlWithSlash = (url: string): string => {
  // Ensure that the contentUrl ends with a slash for consistent comparison
  return url.endsWith("/") ? url : url + "/"
}

const isS3Url = (url: string, contentUrl: string): boolean => {
  // Normalize the URLs for comparison
  const normalizedUrl = normalizeUrlWithSlash(url)
  const normalizedContentUrl = normalizeUrlWithSlash(contentUrl)

  // Check if the URL starts with the content URL
  return normalizedUrl.startsWith(normalizedContentUrl)
}

const extractFileNameFromUrl = (url: string): string => {
  // Remove any query parameters
  let filename = url.split("?")[0] // Discards query parameters if any
  filename = filename.substring(filename.lastIndexOf("/") + 1) // Gets the last segment after the last '/'

  // Decode URI components
  filename = decodeURIComponent(filename)

  // Replace any characters that are not allowed in filenames
  // eslint-disable-next-line no-control-regex
  const invalidChars = /[<>:"/\\|?*\x00-\x1F)]/g // Regex to find invalid characters, including ')'
  const replacementChar = "_" // Replacement character for invalid characters in filenames

  filename = filename.replace(invalidChars, replacementChar)
  // Remove any leading or trailing dots, or symbols from the filename like _	or .
  filename = filename.replace(/^\.+|\.+$|^[._]+|[._]+$/g, "")
  // Ensure that the filename is not empty after sanitization
  if (filename === "") {
    filename = "untitled"
  }
  return filename
}

const extractS3FileLinks = async (
  text: string,
  contentUrl: string,
): Promise<FileReference[]> => {
  //regex to get http & https urls from the file
  const regex = /(https?:\/\/[^\s]+)/g
  const matches = text.matchAll(regex)
  const links: FileReference[] = []

  for (const match of matches) {
    const url = match[0]
    if (!isS3Url(url, contentUrl)) continue
    const name = extractFileNameFromUrl(url)

    let referenceStart, referenceEnd

    // Check for HTML tag
    referenceStart = text.lastIndexOf("<", match.index)
    referenceEnd = text.indexOf(">", match.index)
    if (referenceStart !== -1 && referenceEnd !== -1) {
      links.push({
        path: url,
        name,
        reference: text.slice(referenceStart, referenceEnd + 1),
      })
      continue
    }

    // Check for Markdown link
    referenceEnd = text.lastIndexOf(")", match.index)
    if (referenceEnd !== -1) {
      referenceStart = text.lastIndexOf("[", referenceEnd)
      if (referenceStart !== -1) {
        links.push({
          path: url,
          name,
          reference: text.slice(referenceStart, referenceEnd + 1),
        })
        continue
      }
    }

    // If no HTML or Markdown syntax found, use the URL itself
    links.push({ path: url, name, reference: url })
  }

  return links
}

const extractLocalFileLinks = async (
  text: string,
  app: App,
): Promise<FileReference[]> => {
  const listOfFiles: FileReference[] = []
  try {
    // Updated regex to handle both Obsidian embeds and markdown image links with local paths
    const localFileRegex = /!\[\[(.*?)\]\]|!\[.*?\]\((file:\/\/)?(.*?)\)/g
    let match

    while ((match = localFileRegex.exec(text)) !== null) {
      // Extract the file path from either markdown link or embed
      const filePath = decodeURIComponent(match[1] || match[2])

      if (!filePath) continue // Skip if filePath is undefined or empty

      // Normalize file paths that start with "file://"
      const normalizedPath = filePath.replace(/^file:\/\/\//, "")
      // Check if the file exists in the vault
      const file = app.vault.getAbstractFileByPath(normalizedPath)

      // If it exists and is a file, push the file location and name to the list
      if (file instanceof TFile) {
        listOfFiles.push({
          path: file.path,
          name: file.basename, // Use basename for just the file name without path
          reference: match[0], // Full match to replace or reference later
        })
      }
    }

    return listOfFiles
  } catch (error) {
    console.error("Error extracting file links:", error)
    return listOfFiles // Return empty or partial list on failure
  }
}

const getNoteContent = async (app: App): Promise<string> => {
  const editor = app.workspace.activeEditor?.editor
  if (!editor) throw new Error("No active editor found.")

  const noteFile = app.workspace.getActiveFile()
  if (!noteFile || !noteFile.name) throw new Error("No active note found.")

  return await app.vault.read(noteFile)
}
