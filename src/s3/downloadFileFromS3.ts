  // Download a file from S3, todo: replace with aws download method
  export const downloadFileFromS3 = async (url: string) => {
    //This downloads the file from the S3 link, but this should maybe be replaced with S3 API calls
    const response = await fetch(url)
    if (!response.ok) throw new Error("Network response was not ok.")
    return new Uint8Array(await response.arrayBuffer()) // Assuming binary data
  }