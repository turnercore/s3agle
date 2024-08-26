# Instructions for updating the plugin version

1. Make sure that any changes you want to include in the release are already committed, except for the version bump.

2. In your terminal, run the following command to update the manifest.json with the new version: `npm version [new_version]`

This command updates the version in package.json, runs the version script, and creates a new commit with the version bump. Replace [new_version] with the new version number, e.g., 0.5.2.

3. After running the version bump, push the changes to your repository: `git push origin main`

4. Create the Tag:
   `git tag -a [new_version] -m "Release version [new_version]"`

5. Push the Tag:
   `git push origin [new_version]`
