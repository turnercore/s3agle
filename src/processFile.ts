import { App, Editor, Notice } from "obsidian";
import { S3agleSettings } from "./settings";
import { saveFileToVault } from "./vault/saveFileToVault";
import { uploadToS3 } from "./s3/uploadToS3";
import { uploadToEagle } from "./eagle/uploadToEagle";

// Main function to process the file
export const processFile = async (file: File, settings: S3agleSettings, app: App, placeholder: string) => { 
  const editor: Editor | undefined = app.workspace.activeEditor?.editor;
  if (!editor) throw new Error("No active editor found.");
  
  const noteFile = app.workspace.getActiveFile();
  if (!noteFile || !noteFile.name) return;

  const fm = app.metadataCache.getFileCache(noteFile)?.frontmatter;

  try {
    if (fm?.S3agleLocalOnly) {
      await saveFileToVault(file, settings, app);
    } else {
      let s3Url = "";
      let eagleUrl = "";
      let vaultPath = "";
      if (settings.useS3) s3Url = await uploadToS3(file, settings);
      if (settings.useEagle) eagleUrl = await uploadToEagle(file, settings, s3Url);
      if (settings.useVault) vaultPath = await saveFileToVault(file, settings, app);

      const filePreview = generateFilePreview(file, settings, s3Url, eagleUrl, vaultPath);
      replacePlaceholder(editor, placeholder, filePreview);
    }
  } catch (error) {
    console.error("Error processing file:", error);
    new Notice(`S3agle: ${error.message}`);
    replacePlaceholder(editor, placeholder, `![Error uploading ${file.name}]`);
  }
}

const generateFilePreview = (file: File, settings: S3agleSettings, s3Url: string, eagleUrl: string, vaultPath: string): string => {
  if (settings.useS3 && s3Url) {
    return wrapFileDependingOnType(s3Url, detectFileType(file), settings.localUploadFolder, settings);
  } else if (settings.useVault && vaultPath) {
    return wrapFileDependingOnType(vaultPath, detectFileType(file), settings.localUploadFolder, settings);
  } else if (settings.useEagle && eagleUrl) {
    return wrapFileDependingOnType(eagleUrl, detectFileType(file), settings.localUploadFolder, settings);
  } else {
    return "ERROR WRAPPING FILE FOR FILE PREVIEW";
  }
}

const replacePlaceholder = (editor: Editor, placeholder: string, preview: string) => {
  const cursor = editor.getCursor();
  const currentValue = editor.getValue();
  const newValue = currentValue.replace(placeholder, preview);
  editor.setValue(newValue);
  editor.setCursor(cursor);
}

const detectFileType = (file: File): string => {
  if (file.type.startsWith("image")) {
    return "image";
  } else if (file.type.startsWith("video")) {
    return "video";
  } else if (file.type.startsWith("audio")) {
    return "audio";
  } else if (file.type.startsWith("text")) {
    return "text";
  } else if (file.type === "application/pdf") {
    return "pdf";
  } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.type === "application/msword") {
    return "doc";
  } else if (file.type.includes("presentation") || file.type.includes("powerpoint")) {
    return "ppt";
  } else if (file.type.includes("spreadsheet") || file.type.includes("excel")) {
    return "xls";
  } else if (file.type.includes("zip")) {
    return "zip";
  } else if (file.name.endsWith(".md")) {
    return "md";
  } else {
    return "unknown";
  }
}

const wrapFileDependingOnType = (
  location: string,
  type: string,
  localBase: string,
  settings: S3agleSettings,
) => {
  const srcPrefix = localBase ? "file://" + localBase + "/" : "";

  if (type === "image") {
    return `![image](${location})`;
  } else if (type === "video") {
    return `<video src="${srcPrefix}${location}" controls />`;
  } else if (type === "audio") {
    return `<audio src="${srcPrefix}${location}" controls />`;
  } else if (type === "pdf") {
    if (settings.useGoogleDocsViewer && !localBase) {
      return `<iframe frameborder=0 border=0 width=100% height=800 src="https://docs.google.com/viewer?embedded=true&url=${location}?raw=true"></iframe>`;
    } else {
      return `[pdf](${location})`;
    }
  } else if (type === "ppt") {
    if (settings.useMicrosoftOfficeViewer && !localBase) {
      return `<iframe src='https://view.officeapps.live.com/op/embed.aspx?src=${location}' width='100%' height='600px' frameborder='0'></iframe>`;
    } else {
      return `[ppt](${location})`;
    }
  } else if (type === "doc") {
    if (settings.useMicrosoftOfficeViewer && !localBase) {
      return `<iframe src='https://view.officeapps.live.com/op/embed.aspx?src=${location}' width='100%' height='600px' frameborder='0'></iframe>`;
    } else {
      return `[doc](${location})`;
    }
  } else if (type === "md") {
    const fileName = location.split("/").pop()?.split(".")[0];
    return `[[${fileName}]]`;
  } else {
    return `[file](${location})`;
  }
}
