import {
  Editor,
  Notice,
  Plugin,
  EditorPosition,
} from "obsidian"
import {
  S3Client
} from "@aws-sdk/client-s3"
import type { pasteFunction } from "./types"
import { type S3agleSettings, S3agleSettingTab, DEFAULT_SETTINGS } from "./settings"
import { ObsHttpHandler } from "./helpers"
import { downloadAllFilesCommand } from "./commands/downloadAllFiles"
import { uploadAllFilesCommand } from "./commands/uploadAllFiles"
import { processFile } from "./processFile"

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
    console.log("pasteHandler triggered")
    if (ev.defaultPrevented) {
      console.log("Event default prevented")
      return
    }

    // Check if any storage option is enabled
    if (!this.settings.useS3 && !this.settings.useEagle && !this.settings.useVault) {
      console.log("All storage options are disabled, ignoring event")
      return
    }

    // Get the current note
    const noteFile = this.app.workspace.getActiveFile()
    if (!noteFile || !noteFile.name) {
      console.log("No active note file")
      return
    }

    // Get the frontmatter of the note to see if there are any settings overrides
    const fm = this.app.metadataCache.getFileCache(noteFile)?.frontmatter

    let files: File[] = []
    switch (ev.type) {
      case "paste":
        files = Array.from((ev as ClipboardEvent).clipboardData?.files || [])
        console.log("Files from paste:", files)
        break
      case "drop":
        if (!this.settings.uploadOnDrag && !(fm && fm.S3eagleUploadOnDrag)) {
          console.log("Upload on drag is disabled")
          return
        }
        files = Array.from((ev as DragEvent).dataTransfer?.files || [])
        console.log("Files from drop:", files)
        break
    }

    if (files.length > 0) {
      ev.preventDefault()
      console.log("Processing files:", files)

      const uploads = files.map(async (file) => {
        const fileName = file.name
        const placeholder = `![Uploading ${fileName}…]`
        editor.replaceSelection(placeholder)
        try {
          console.log("Processing file:", file.name)
          await processFile(
            file,
            this.settings,
            this.app,
            placeholder,
          )
        } catch (error) {
          console.error("Error processing file:", error)
          new Notice(`S3agle: ${error.message}`)
          this.replaceText(editor, placeholder, `![Error uploading ${fileName}]`)
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
      : `https://s3.${this.settings.s3Region}.amazonaws.com/`

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
        region: this.settings.s3Region,
        credentials: {
          accessKeyId: this.settings.accessKey,
          secretAccessKey: this.settings.secretKey,
        },
        endpoint: apiEndpoint,
        forcePathStyle: this.settings.forcePathStyle,
        requestHandler: new ObsHttpHandler(),
      })
    } else {
      this.s3 = new S3Client({
        region: this.settings.s3Region,
        credentials: {
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


    // If s3 or eagle are enabled add the upload and download commands
    if (this.settings.useS3 || this.settings.useEagle) {
      this.addCommand(uploadAllFilesCommand(this.app, this.settings))
      this.addCommand(downloadAllFilesCommand(this.app, this.settings))
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
}
