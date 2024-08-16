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
    if (ev.defaultPrevented) {
      return
    }

    // Check if any storage option is enabled
    if (!this.settings.useS3 && !this.settings.useEagle && !this.settings.useVault) {
      return
    }

    // Get the current note
    const noteFile = this.app.workspace.getActiveFile()
    if (!noteFile || !noteFile.name) {
      ("No active note file")
      return
    }

    // Get the frontmatter of the note to see if there are any settings overrides
    const fm = this.app.metadataCache.getFileCache(noteFile)?.frontmatter

    let files: File[] = []
    switch (ev.type) {
      case "paste":
        files = Array.from((ev as ClipboardEvent).clipboardData?.files || [])
        break
      case "drop":
        if (!this.settings.uploadOnDrag && !(fm && fm.S3eagleUploadOnDrag)) {
          return
        }
        files = Array.from((ev as DragEvent).dataTransfer?.files || [])
        break
    }

    if (files.length > 0) {
      ev.preventDefault()

      const uploads = files.map(async (file) => {
        const fileName = file.name
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
    await this.loadSettings();
    this.addSettingTab(new S3agleSettingTab(this.app, this));

    if (this.settings.useS3) {
      const apiEndpoint = this.settings.s3Url.startsWith("http")
        ? this.settings.s3Url
        : `https://${this.settings.s3Url}`;

      // Properly construct the content URL
      if (this.settings.useCustomContentUrl) {
        this.settings.contentUrl = this.settings.customContentUrl;
      } else {
        this.settings.contentUrl = this.settings.forcePathStyle
          ? `${apiEndpoint}/${this.settings.bucket}`
          : `${apiEndpoint}/${this.settings.bucket}`;
      }

      // Ensure no trailing slashes for contentUrl
      if (this.settings.contentUrl.endsWith("/")) {
        this.settings.contentUrl = this.settings.contentUrl.slice(0, -1);
      }

      if (!this.settings.s3Url) {
        throw new Error("S3 URL is missing in the settings.");
      }

      this.s3 = new S3Client({
        region: this.settings.s3Region || undefined,  // Optional if the custom endpoint doesn't need it
        credentials: {
          accessKeyId: this.settings.accessKey,
          secretAccessKey: this.settings.secretKey,
        },
        endpoint: apiEndpoint,  // Always use the s3Url from settings
        forcePathStyle: this.settings.forcePathStyle,
      });
    }

    this.pasteFunction = this.pasteHandler.bind(this);
    this.registerEvent(this.app.workspace.on("editor-paste", this.pasteFunction));
    this.registerEvent(this.app.workspace.on("editor-drop", this.pasteFunction));

    if (this.settings.useS3 || this.settings.useEagle) {
      this.addCommand(uploadAllFilesCommand(this.app, this.settings));
      this.addCommand(downloadAllFilesCommand(this.app, this.settings));
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
