<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/17ngup61QHOOA9SB63VIkju3ZxNvp4KPO

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Features

### IDE Integration

DevOrbit Dashboard supports opening projects directly in your favorite IDE from the application detail view. The feature automatically detects installed IDEs and provides a convenient button to launch them.

#### Supported IDEs

- **Visual Studio Code** - Cross-platform code editor
- **Cursor** - AI-powered code editor
- **WebStorm** - JavaScript and TypeScript IDE
- **IntelliJ IDEA** - Java IDE
- **PhpStorm** - PHP IDE
- **PyCharm** - Python IDE
- **Sublime Text** - Text editor

#### Platform Support

- **macOS**: Detects applications in `/Applications/`
- **Linux**: Supports standard installations, Snap packages, and Flatpak apps
- **Windows**: Detects IDEs in `Program Files` and user-specific directories

#### Custom IDE Paths

If your IDE is installed in a non-standard location, you can set custom paths using environment variables:

```bash
# .env.local
VSCODE_PATH=/custom/path/to/vscode
CURSOR_PATH=/custom/path/to/cursor
WEBSTORM_PATH=/custom/path/to/webstorm
INTELLIJ_PATH=/custom/path/to/intellij
PHPSTORM_PATH=/custom/path/to/phpstorm
PYCHARM_PATH=/custom/path/to/pycharm
SUBLIME_PATH=/custom/path/to/sublime
```

**Note:** After changing environment variables, you must restart the backend server for the changes to take effect.

#### Preferred IDE

The dashboard remembers your preferred IDE for each project. When you open a project in an IDE, it becomes the default for that project. You can change the preferred IDE anytime from the dropdown menu.

#### Troubleshooting

**IDE not detected:**
- Verify the IDE is installed and accessible
- For custom installations, set the appropriate environment variable
- On Linux, ensure the IDE is in your PATH or installed via Snap/Flatpak

**Launch fails:**
- Check file permissions on the project directory
- Verify the IDE application is not corrupted
- On macOS, ensure the IDE is in the `/Applications/` folder or set a custom path
- On Linux, try reinstalling via your package manager

**Permission denied:**
- Ensure you have read access to the project directory
- On Linux/macOS, check directory permissions with `ls -la`
- Verify the IDE executable has execute permissions

**IDE opens but shows wrong directory:**
- This may happen if the project path contains symbolic links
- Try using the absolute path to the project

#### Technical Details

- IDE detection results are cached for 5 minutes to improve performance
  - Force cache refresh by adding `?refresh=true` to the IDE detection endpoint
  - Cache is automatically invalidated when an IDE launch fails
- The feature uses secure process spawning to prevent command injection
- Path validation prevents directory traversal attacks
- Rate limiting (10 launches per minute) prevents abuse
- Error responses include specific error codes for better debugging
- Error messages are sanitized to prevent exposure of sensitive paths
