export interface pasteFunction {
  (this: HTMLElement, event: ClipboardEvent | DragEvent): void
}

export type Folder = {
  id: string
  name: string
  parent: string
  children: Folder[]
}

export type FileReference = {
  path: string
  name: string
  reference: string // This is the whole string that contains the file as well as the markdown around it
}