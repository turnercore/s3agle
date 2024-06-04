    //In progress
    //   this.addCommand({
    //     id: "download-one-file",
    //     name: "Download a file from S3 to Local.",
    //     callback: async () => {
    //       const modal = new FileActionSuggestModal(
    //         app,
    //         this.settings.contentUrl,
    //         "s3",
    //         downloadOneFile,
    //       )
    //       modal.open()
    //     },
    //   })

    //Download one file from S3 to local/Eagle
  // async downloadFile(file: FileReference) {
  //   try {
  //     if (!isS3Url(file.path, this.settings.contentUrl)) {
  //       new Notice("S3agle: Not an S3 URL.")
  //       return
  //     }
  //     const fileName = extractFileNameFromUrl(file.path)
  //     const localPath = `${this.settings.localUploadFolder}/${fileName}`
  //     // See if a file exists in the vault at that path
  //     if (await this.app.vault.adapter.exists(localPath)) {
  //       new Notice(`S3agle: File already exists at ${localPath}`)
  //       return
  //     }
  //     const fileData = await downloadFileFromS3(file.path) // Adjust this method to actually download files via HTTP

  //     await saveFileToVault(fileData, localPath, this.settings.localUploadFolder, this.app)

  //     if (this.settings.useEagle) {
  //       // TODO: See if the file is in Eagle and if not upload it to eagle
  //     }

  //     new Notice(`S3agle: File downloaded to ${localPath}`)
  //   } catch (error) {
  //     console.error("Error uploading one file:", error)
  //     new Notice(
  //       "S3agle: Failed to download file. Check the console for details.",
  //     )
  //   }
  // }