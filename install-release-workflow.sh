#!/bin/bash
# Installation script for release workflow
# This script moves the release workflow to .github/workflows/ and commits the change

set -e

echo "==================================="
echo "Release Workflow Installation"
echo "==================================="
echo ""

# Check if release-workflow.yml exists
if [ ! -f "release-workflow.yml" ]; then
    echo "❌ Error: release-workflow.yml not found in repository root"
    echo "   Make sure you're running this script from the repository root directory"
    exit 1
fi

# Check if .github/workflows/ directory exists
if [ ! -d ".github/workflows" ]; then
    echo "📁 Creating .github/workflows/ directory..."
    mkdir -p .github/workflows
fi

# Check if workflow already exists
if [ -f ".github/workflows/release.yml" ]; then
    echo "⚠️  Warning: .github/workflows/release.yml already exists"
    read -p "   Do you want to overwrite it? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Installation cancelled"
        exit 1
    fi
fi

# Move the workflow file
echo "📦 Moving release-workflow.yml to .github/workflows/release.yml..."
mv release-workflow.yml .github/workflows/release.yml

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "⚠️  Warning: Not a git repository"
    echo "✅ Workflow file moved successfully"
    exit 0
fi

# Stage the changes
echo "📝 Staging changes for commit..."
git add .github/workflows/release.yml

# Check if there are staged changes (file might already be tracked)
if git diff --cached --quiet; then
    echo "✅ Workflow file already tracked and up to date"
    exit 0
fi

# Commit the changes
echo "💾 Creating commit..."
git commit -m "chore: activate release automation workflow

This workflow enables automated releases for:
- Electron desktop apps (Windows, macOS, Linux)
- Docker images (all-in-one, frontend, API)
- GitHub releases with artifacts

To create a release, push a version tag:
  git tag v1.0.0
  git push origin v1.0.0"

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Review the commit with: git show"
echo "2. Push the changes with: git push"
echo "3. Create a release by pushing a version tag:"
echo "   git tag v1.0.0"
echo "   git push origin v1.0.0"
echo ""
