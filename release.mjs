// release.js
import { execSync } from "child_process"

const version = process.argv[2]

if (!version) {
  console.error("Version argument is required.")
  process.exit(1)
}

try {
  execSync(`git tag -a ${version} -m 'Release ${version}'`)
  execSync(`git push origin ${version}`)
  console.log(`Successfully tagged and pushed ${version}`)
} catch (error) {
  console.error(`Failed to tag and push version: ${version}`, error)
  process.exit(1)
}
