import { Notice, PluginSettingTab, Setting, SuggestModal, App } from "obsidian"
import { randomInt } from "crypto"
import { FileReference } from "./types"
import {
  extractLocalFileLinks,
  extractS3FileLinks,
  getNoteContent,
} from "./helpers"
import S3aglePlugin from "./main"

export const HANDLED_FILE_TYPES = [".ppt", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm", ".ogg", ".mp3", ".wav", ".flac", ".pdf"]


/**
 * Defines the settings structure for the S3agle Obsidian Plugin.
 */
export interface S3agleSettings {
  s3Url: string // URL to the S3 server
  accessKey: string // AWS Access Key for S3 access
  secretKey: string // AWS Secret Key for S3 access
  s3Region: string // AWS Region where the S3 bucket is located
  bucket: string // The name of the S3 bucket to use
  s3Folder: string // Default folder path within the S3 bucket
  eagleFolder: string // Default folder path within Eagle
  eagleApiUrl: string // URL to the Eagle API, usually localhost
  uploadOnDrag: boolean // Enable uploading files on drag-and-drop
  useEagle: boolean // Enable integration with Eagle software
  useS3: boolean // Enable integration with  S3
  useBucketSubdomain: boolean // Use bucket subdomain
  useVault: boolean // Use the vault for file storage
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
  useGoogleDocsViewer: boolean // Use Google Docs Viewer for PDFs
  useMicrosoftOfficeViewer: boolean // Use Microsoft Office Viewer for PDFs
}

/**
 * Default settings for the plugin.
 */
export const DEFAULT_SETTINGS: S3agleSettings = {
  accessKey: "",
  secretKey: "",
  s3Region: "",
  bucket: "",
  s3Folder: "",
  eagleFolder: "Obsidian",
  useCustomEndpoint: false,
  s3Url: "s3.amazonaws.com",
  useBucketSubdomain: false,
  eagleApiUrl: "http://localhost:41595/",
  uploadOnDrag: true,
  useEagle: true,
  useS3: true,
  useVault: false,
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
  hashSeed: randomInt(1000000),
  useGoogleDocsViewer: true,
  useMicrosoftOfficeViewer: true,
}

export class S3agleSettingTab extends PluginSettingTab {
  plugin: S3aglePlugin

  display() {
    const { containerEl } = this
    containerEl.empty()

    this.drawGeneralSettings(containerEl)
    this.drawVaultSettings(containerEl)
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
      .setDesc("Hash the file name before uploading. This hides the original file name as well as deduplicates files.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hashFileName)
          .onChange(async (value) => {
            this.plugin.settings.hashFileName = value
            await this.plugin.saveSettings()
            this.display() // Redraw to show/hide hash seed setting dynamically
          }),
      )

    if (this.plugin.settings.hashFileName) {
      new Setting(containerEl)
        .setName("Reset hash seed")
        .setDesc(
          `Current seed: ${this.plugin.settings.hashSeed}. Reset this seed to hash file names differently. For example, if you're uploading the same file multiple times and want to avoid conflicts.`,
        )
        .addButton((button) =>
          button.setButtonText("Reset seed").onClick(async () => {
            this.plugin.settings.hashSeed = randomInt(1000000)
            await this.plugin.saveSettings()
            new Notice("S3agle: Hash seed reset.")
            this.display()
          }),
        )
    }

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

  drawVaultSettings(containerEl: HTMLElement) {
    new Setting(containerEl).setName("Vault").setHeading()

    new Setting(containerEl)
      .setName("Use vault for file storage")
      .setDesc("Enable using the local vault for file storage.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useVault)
          .onChange(async (value) => {
            this.plugin.settings.useVault = value
            await this.plugin.saveSettings()
            this.display() // Redraw to show/hide S3 settings dynamically
          }),
      )

    if (this.plugin.settings.useVault) {
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
        text.setValue(this.plugin.settings.s3Region).onChange(async (value) => {
          this.plugin.settings.s3Region = value.trim()
          await this.plugin.saveSettings()
        }),
      )

    new Setting(containerEl)
      .setName("S3 folder path")
      .setDesc("The default folder path within the S3 bucket. (Optional)")
      .addText((text) =>
        text.setValue(this.plugin.settings.s3Folder).onChange(async (value) => {
          this.plugin.settings.s3Folder = value.trim()
          await this.plugin.saveSettings()
        }),
      )

    new Setting(containerEl)
      .setName("S3 endpoint")
      .setDesc("Enter the S3 endpoint URL. Will default to Amazon's S3.")
      .addText((text) =>
        text.setValue(this.plugin.settings.s3Url).onChange(async (value) => {
          this.plugin.settings.s3Url = value ? value.trim() : "s3.amazonaws.com"
          await this.plugin.saveSettings()
        }),
      )

    //Toggle for using bucket subdomain
    new Setting(containerEl)
      .setName("Use bucket subdomain")
      .setDesc(
        "Changes your content url to use https://bucket.url/folder/file instead of https://url/bucket/folder/file",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useBucketSubdomain)
          .onChange(async (value) => {
            this.plugin.settings.useBucketSubdomain = value
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
              this.plugin.settings.customContentUrl = value ? value.trim() : this.plugin.settings.s3Url
              updateContentUrl(this.plugin)
              if (this.plugin.settings.contentUrl === "" || this.plugin.settings.contentUrl === this.plugin.settings.s3Url) {
                this.plugin.settings.useCustomContentUrl = false
              }
              await this.plugin.saveSettings()
            }),
        )
    }

    new Setting(containerEl)
      .setName("Use Google docs viewer for PDF file embeddings")
      .setDesc(
        "Use Google Docs Viewer for PDF files stored on S3. If disabled, the PDF preview will not render, but the file will still be uploaded.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useGoogleDocsViewer)
          .onChange(async (value) => {
            this.plugin.settings.useGoogleDocsViewer = value
            await this.plugin.saveSettings()
          }),
      )

    new Setting(containerEl)
      .setName("Use Microsoft Office viewer for .ppt file embeddings")
      .setDesc(
        "Use Microsoft Office Viewer for PPT files stored on S3. If disabled, the PPT preview will not render, but the file will still be uploaded.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useMicrosoftOfficeViewer)
          .onChange(async (value) => {
            this.plugin.settings.useMicrosoftOfficeViewer = value
            await this.plugin.saveSettings()
          }),
      )
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
    }
  }
}

export class FileActionSuggestModal extends SuggestModal<FileReference> {
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

const updateContentUrl = (plugin: S3aglePlugin): void => {
  if (!plugin.settings.useCustomContentUrl) return

  // Properly construct the content URL
  plugin.settings.contentUrl = plugin.settings.customContentUrl
  // Ensure no trailing slashes for contentUrl
  if (plugin.settings.contentUrl.endsWith("/")) {
    plugin.settings.contentUrl = plugin.settings.contentUrl.slice(0, -1)
  }
  // Ensure no double slashes except for the protocol
  plugin.settings.contentUrl = plugin.settings.contentUrl.replace(/([^:]\/)\/+/g, "$1")
  plugin.saveSettings()
}