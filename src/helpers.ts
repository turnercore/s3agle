import { buildQueryString } from "@aws-sdk/querystring-builder"
import type { HttpHandlerOptions } from "@aws-sdk/types"
import {
  FetchHttpHandler,
  FetchHttpHandlerOptions,
} from "@aws-sdk/fetch-http-handler"
import { HttpRequest, HttpResponse } from "@aws-sdk/protocol-http"
import { App, RequestUrlParam, TFile, requestUrl } from "obsidian"
import { FileReference } from "./types"

/**
 * This is close to origin implementation of FetchHttpHandler
 * https://github.com/aws/aws-sdk-js-v3/blob/main/packages/fetch-http-handler/src/fetch-http-handler.ts
 * that is released under Apache 2 License.
 * But this uses Obsidian requestUrl instead.
 */

export function requestTimeout(
  timeoutInMs = 0,
): Promise<{ response: HttpResponse }> {
  return new Promise((resolve, reject) => {
    if (timeoutInMs) {
      setTimeout(() => {
        const timeoutError = new Error(
          `Request did not complete within ${timeoutInMs} ms`,
        )
        timeoutError.name = "TimeoutError"
        reject(timeoutError)
      }, timeoutInMs)
    }
  })
}

export class ObsHttpHandler extends FetchHttpHandler {
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

export const bufferToArrayBuffer = (
  b: Buffer | Uint8Array | ArrayBufferView,
) => {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

export const getObsidianMimeType = (extension: string): string => {
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

export const sanitizeFileName = (filename: string): string => {
  // Replace spaces with underscores and remove any problematic characters
  return filename
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .replace(/[^\w.-]/g, "") // Remove all non-word characters except dots and dashes
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Normalize diacritics
}

export const normalizeUrlWithSlash = (url: string): string => {
  // Ensure that the contentUrl ends with a slash for consistent comparison
  return url.endsWith("/") ? url : url + "/"
}

export const isS3Url = (url: string, contentUrl: string): boolean => {
  // Normalize the URLs for comparison
  const normalizedUrl = normalizeUrlWithSlash(url)
  const normalizedContentUrl = normalizeUrlWithSlash(contentUrl)

  // Check if the URL starts with the content URL
  return normalizedUrl.startsWith(normalizedContentUrl)
}

export const extractFileNameFromUrl = (url: string): string => {
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

export const extractS3FileLinks = async (
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

export const extractLocalFileLinks = async (
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

export const getNoteContent = async (app: App): Promise<string> => {
  const editor = app.workspace.activeEditor?.editor
  if (!editor) throw new Error("No active editor found.")

  const noteFile = app.workspace.getActiveFile()
  if (!noteFile || !noteFile.name) throw new Error("No active note found.")

  return await app.vault.read(noteFile)
}

// Optional Hashing functions to hide file names
export const hashString = (str: string, hashSeed: number): string => {
  let hash = hashSeed
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    // Multiplying by a prime number before XORing helps distribute the values more uniformly
    hash = (hash * 33) ^ char // ^ is XOR operation
  }
  // Convert to a positive 32-bit integer and return as a string
  return (hash >>> 0).toString()
}

export const hashNameIfNeeded = (
  fileName: string,
  hashFileName: boolean,
  hashSeed: number,
): string => {
  return hashFileName ? hashString(fileName, hashSeed) : fileName
}
