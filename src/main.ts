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
import { ObsHttpHandler, hashNameIfNeeded, } from "./helpers"
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
    if (ev.defaultPrevented) return

    // Get the current note
    const noteFile = this.app.workspace.getActiveFile()
    if (!noteFile || !noteFile.name) return

    // Get the frontmatter of the note to see if there are any settings overrides
    const fm = this.app.metadataCache.getFileCache(noteFile)?.frontmatter

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
        const fileName = hashNameIfNeeded(file.name, this.settings.hashFileName, this.settings.hashSeed)
        const placeholder = `![Uploading ${fileName}…]`
        editor.replaceSelection(placeholder)
        try {
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
        region: this.settings.s3Region,
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
    this.addCommand(uploadAllFilesCommand(this.app, this.settings))
    // this.addCommand(uploadFileCommand)
    this.addCommand(downloadAllFilesCommand(this.app, this.settings))
    // this.addCommand(downloadFileCommand)

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