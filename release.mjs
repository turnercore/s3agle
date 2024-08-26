import { execSync } from "child_process"
import { readFileSync, writeFileSync } from "fs"

// Get the version argument passed from the command line
const version = process.argv[2]

if (!version) {
  console.error("Version argument is required.")
  process.exit(1)
}

// Validate the version format (e.g., 1.0.0)
const versionPattern = /^\d+\.\d+\.\d+$/
if (!versionPattern.test(version)) {
  console.error(
    "Invalid version format. Version must be in the format 'x.x.x' where x is an integer.",
  )
  process.exit(1)
}

try {
  // Check for unstaged or uncommitted changes
  const gitStatus = execSync("git status --porcelain").toString().trim()
  if (gitStatus) {
    console.error(
      "There are unstaged or uncommitted changes. Please commit or stash them before releasing.",
    )
    process.exit(1)
  }

  // Update the version in manifest.json
  let manifest = JSON.parse(readFileSync("manifest.json", "utf8"))
  const { minAppVersion } = manifest
  manifest.version = version
  writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"))

  // Update versions.json with the new version and minAppVersion
  let versions = JSON.parse(readFileSync("versions.json", "utf8"))
  versions[version] = minAppVersion
  writeFileSync("versions.json", JSON.stringify(versions, null, "\t"))

  // Commit the changes
  execSync(`git add manifest.json versions.json`)
  execSync(`git commit -m "Bump version to ${version}"`)

  // Push the changes and the tag
  execSync(`git push origin main`)
  execSync(`git tag -a ${version} -m 'Release ${version}'`)
  execSync(`git push origin ${version}`)

  console.log(`Successfully updated version to ${version}, tagged, and pushed.`)
} catch (error) {
  console.error(`Failed to update version, tag, and push: ${version}`, error)
  process.exit(1)
}
