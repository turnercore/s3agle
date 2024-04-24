# S3agle File Management for Obsidian

This is a plugin for [Obsidian](https://obsidian.md). It was based off [S3 Image Uploader](https://github.com/jvsteiner/s3-image-uploader).

This project uses S3 Storage provider and/or [Eagle](https://eagle.cool/) to manage files locally. You can use each independiently.

## What is Eagle?

[Eagle](https://eagle.cool/) is a file mangement app. It needs to be running in the background for the [Eagle](https://eagle.cool/) functions to work properly. [Eagle](https://eagle.cool/) released basic API access to their program that allows the plugin to upload files to it.

> [!NOTE] Note
> This plugin is still in development, and there may be some bugs. Please report any issues you find. Always be sure to backup your vault before using a new plugin.

### Usage

You have to set up your own S3 bucket, and provide the following information to the plugin:

- `accessKeyId`: the access key ID for an s3 user with write access to your bucket
- `secretAccessKey`: the secret access key for the s3 user
- `region`: the region of your bucket
- `bucket`: the name of your bucket (must already exist)
- `folder`: the folder in your bucket where you want to store files (optional, and will be created on the fly if it does not exist.)

Any S3 compitible storage provider should work.

If you want to be able to view the files from Obsidian, you need to make your bucket world readable. You can do this by adding the following policy to your bucket:

```json
{
  "Version": "2008-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::<your-bucket>/*"
    }
  ]
}
```

You also need to set up a CORS policy for the bucket:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": []
  }
]
```

You also need to set up a user with write access to your bucket. You can do this by creating a new user in the IAM console, and attaching the `AmazonS3FullAccess` policy to it. More granular access control policies are possible, but this is the simplest way to get started.

When you paste a file from the clipboard into the Obsidian note, the plugin will upload the file to your bucket, and insert a link to the file in your note. The link will be of the form `https://<your-bucket>.s3.<your-region>.amazonaws.com/<your-optional-folder>/<image-name>`. If you have made your bucket world readable, you can share the link with others, and they will be able to view the file.

If you select the "Upload on drag" option in the plugin settings, the plugin will also upload images that you drag into the note - as well as video, audio files and pdfs.

If you do not want this behavior in all notes, you can customize it on a per note basis.
Use the following variables in the frontmatter of your note to enable or disable specific features in that note. Frontmatter settings will override global settings.

The following frontmatter variables are supported:

1. `S3agleLocalOnly` if enabled it will not upload the file to S3. If you are using Eagle it will still upload the file to Eagle.
2. `S3eagleUploadOnDrag` enable/disable the drag and drop functionality.

Example:

```
---
S3agleLocalOnly: true
S3eagleUploadOnDrag: true
---
```

### Commands

The following commands are added:

`S3agle: Download ALL files from S3 to local`
This command will find all the files uploaded to your S3 url, download them, and add them to local vault storage and/or Eagle. Note that this will NOT delete the file from your S3 server, you'll need to do that manually.

`S3agle: Upload ALL files to S3/Eagle`
This command will upload all the files that it can find in the current note to S3 and/or Eagle (depending on your settings). It will also update any of the links to turn them to S3 links. Note this does not delete the files locally.

## Development

PR's are welcome! Features that I would like to add include:

- [ ] Upload and download individual files from commands
- [ ] Use Eagle instead of vault storage for local link previews (this may require an update to the Eagle API before it is possible)
- [ ] File viewer with thumbnails for Eagle files to insert them into the note.
