# Release Guide

This guide explains how to create and publish releases for DevOrbit Dashboard.

## Release Types

DevOrbit Dashboard provides two distribution methods:

1. **Electron Desktop Application** - Native desktop app for Windows, macOS, and Linux
2. **Docker Images** - Containerized deployment with full stack (frontend, API, database, Redis)

## Setup

### Installing the Release Workflow

The automated release workflow is provided in `release-workflow.yml` at the repository root. **It must be manually moved to `.github/workflows/` to become active.**

**Why manual installation is required:**
GitHub's security model prevents automated tools (like GitHub Apps and bots) from creating or modifying workflow files without explicit `workflows` permission. This prevents malicious code from being injected into CI/CD pipelines.

**Installation steps:**

```bash
# Move the workflow file to the correct location
mv release-workflow.yml .github/workflows/release.yml

# Commit and push
git add .github/workflows/release.yml
git commit -m "chore: enable release automation workflow"
git push
```

Once installed, the workflow will run automatically when you push version tags.

## Creating a Release

### Automated Release (Recommended)

Once the workflow is installed, releases are automatically built when you create a Git tag:

```bash
# Create a new version tag
git tag v1.0.0

# Push the tag to GitHub
git push origin v1.0.0
```

This will trigger the release workflow which:
- Builds Electron apps for all platforms (Windows, macOS, Linux)
- Builds and pushes Docker images to GitHub Container Registry
- Creates a GitHub release with all artifacts

### Manual Release

You can also trigger a release manually from the GitHub Actions tab:

1. Go to Actions → Release workflow
2. Click "Run workflow"
3. Enter the version (e.g., `v1.0.0`)
4. Click "Run workflow"

## Release Artifacts

### Electron Desktop Apps

The workflow builds the following artifacts:

**Windows:**
- `DevOrbit-Dashboard-Setup-{version}.exe` - NSIS installer (x64)
- `DevOrbit-Dashboard-Setup-{version}-arm64.exe` - NSIS installer (ARM64)
- `DevOrbit-Dashboard-{version}.exe` - Portable version (x64)

**macOS:**
- `DevOrbit-Dashboard-{version}.dmg` - DMG installer (Universal binary: Intel + Apple Silicon)
- `DevOrbit-Dashboard-{version}-mac.zip` - ZIP archive (Universal binary)

**Linux:**
- `DevOrbit-Dashboard-{version}.AppImage` - AppImage (x64 + ARM64)
- `DevOrbit-Dashboard-{version}.deb` - Debian/Ubuntu package (x64 + ARM64)
- `DevOrbit-Dashboard-{version}.rpm` - Fedora/RHEL package (x64 + ARM64)

### Docker Images

Docker images are published to GitHub Container Registry (ghcr.io):

- `ghcr.io/{owner}/devorbit:latest` - All-in-one image (latest)
- `ghcr.io/{owner}/devorbit:{version}` - All-in-one image (specific version)
- `ghcr.io/{owner}/devorbit-frontend:latest` - Frontend only
- `ghcr.io/{owner}/devorbit-frontend:{version}` - Frontend (specific version)
- `ghcr.io/{owner}/devorbit-api:latest` - API only
- `ghcr.io/{owner}/devorbit-api:{version}` - API (specific version)

## Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- `v1.0.0` - Major version (breaking changes)
- `v1.1.0` - Minor version (new features, backward compatible)
- `v1.1.1` - Patch version (bug fixes)

## Pre-release Checklist

Before creating a release:

- [ ] Update version in `package.json`
- [ ] Update CHANGELOG.md with release notes
- [ ] Test all build scripts locally:
  ```bash
  npm run build
  npm run electron:build:mac
  npm run electron:build:win
  npm run electron:build:linux
  ```
- [ ] Test Docker build:
  ```bash
  docker compose build
  docker compose up -d
  ```
- [ ] Run tests:
  ```bash
  npm run test:run
  npm run lint
  ```
- [ ] Update documentation if needed
- [ ] Commit all changes

## Automated Testing and Validation

The release workflow automatically validates releases before building:

### Version Format Validation
- Ensures version follows semantic versioning (v1.2.3 or v1.2.3-beta.1)
- Compares package.json version with the Git tag

### Code Quality Checks
- Runs ESLint to check code quality
- Executes test suite to verify functionality
- Both run with `continue-on-error` to provide warnings without blocking release

### Docker Configuration Validation
- Verifies all required Dockerfile files exist
- Validates docker-compose.yml syntax
- Ensures Docker configuration is deployable

### Security Scanning
- Scans Docker images for vulnerabilities using Trivy
- Uploads security findings to GitHub Security tab
- Provides visibility into potential security issues

### Build Artifact Verification
The workflow ensures:
- Expected build outputs are created
- Artifacts are properly uploaded
- All platforms build successfully

## Rollback Procedures

If you need to rollback a problematic release:

### Option 1: Delete Release and Tag (Clean Rollback)

```bash
# Delete the GitHub release
gh release delete v1.2.3 --yes

# Delete the local tag
git tag -d v1.2.3

# Delete the remote tag
git push origin :refs/tags/v1.2.3

# Delete Docker images from GHCR (via web UI)
# Go to: https://github.com/users/YOUR_USERNAME/packages
```

### Option 2: Create a Patch Release

If users have already downloaded the release:

```bash
# Create a fix
git checkout main
# Make your fixes...
git commit -m "fix: address issues in v1.2.3"

# Create a new patch version
git tag v1.2.4
git push origin v1.2.4
```

### Option 3: Mark as Pre-release

If the release is unstable but you want to keep it:

1. Go to the release page on GitHub
2. Click "Edit"
3. Check "Set as a pre-release"
4. Update the release notes to warn users
5. Save changes

### Rollback Docker Images

Users who pulled the problematic image:

```bash
# Pull a specific older version
docker pull ghcr.io/hpmartini/devorbit:v1.2.2

# Update docker-compose.yml to pin the version
# Change:
#   image: ghcr.io/hpmartini/devorbit:latest
# To:
#   image: ghcr.io/hpmartini/devorbit:v1.2.2

# Restart with the pinned version
docker compose down
docker compose up -d
```

### Communication

When rolling back a release:

1. Create a GitHub issue explaining the problem
2. Update the release notes with a warning
3. Notify users via appropriate channels
4. Document the issue in CHANGELOG.md

## Distribution

### Desktop App Distribution

Desktop apps are distributed via GitHub Releases. Users can:

1. Go to the [Releases page](https://github.com/hpmartini/DevHub/releases)
2. Download the appropriate installer for their platform
3. Install and run the application

### Docker Distribution

Docker images are available on GitHub Container Registry. Users can:

```bash
# Pull and run the all-in-one image
docker pull ghcr.io/hpmartini/devorbit:latest
docker run -p 3000:3099 ghcr.io/hpmartini/devorbit:latest

# Or use Docker Compose
docker compose up -d
```

## Auto-Updates (Electron)

The Electron app includes auto-update functionality via `electron-updater`. When a new release is published:

1. The app checks for updates on startup
2. If an update is available, the user is notified
3. The user can download and install the update

## Code Signing

### macOS

macOS builds require code signing and notarization for distribution outside the App Store. To enable:

1. Set up Apple Developer certificates
2. Configure environment variables:
   ```bash
   export APPLE_ID="your-apple-id@email.com"
   export APPLE_ID_PASSWORD="app-specific-password"
   export APPLE_TEAM_ID="your-team-id"
   ```
3. The workflow will automatically sign and notarize the app

### Windows

Windows builds can be signed with a code signing certificate. To enable:

1. Obtain a code signing certificate
2. Configure signing in `electron-builder.json`
3. Add certificate to GitHub Secrets

## Troubleshooting

### Build Failures

If the release workflow fails:

1. Check the workflow logs in GitHub Actions
2. Verify all dependencies are installed
3. Test the build locally
4. Ensure environment variables are set correctly

### Docker Push Failures

If Docker image push fails:

1. Verify GitHub Container Registry permissions
2. Check that the repository allows packages
3. Ensure the workflow has `packages: write` permission

### Missing Artifacts

If artifacts are missing from the release:

1. Check that all build jobs completed successfully
2. Verify artifact upload paths in the workflow
3. Check artifact retention settings

## Support

For issues with releases, please:

1. Check existing [GitHub Issues](https://github.com/hpmartini/DevHub/issues)
2. Create a new issue with details about the problem
3. Include workflow logs if applicable
