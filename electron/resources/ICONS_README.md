# Application Icons

This directory should contain the application icons for different platforms.

## Required Icon Files

To add custom application icons, place the following files in this directory:

### macOS
- `icon.icns` - macOS icon file (512x512 minimum)
  - Can be generated from a 1024x1024 PNG using tools like [png2icons](https://github.com/idesis-gmbh/png2icons)
  - Or use macOS's built-in `iconutil` command

### Windows
- `icon.ico` - Windows icon file (256x256 minimum)
  - Should contain multiple sizes: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256
  - Can be generated using online tools like [icoconvert.com](https://icoconvert.com/)

### Linux
- `icon.png` - Linux icon (512x512 minimum, preferably 1024x1024)
  - Used for AppImage and desktop shortcuts

## Generating Icons from SVG

If you have an SVG icon (like the provided `icon.svg`), you can convert it to the required formats:

### Option 1: Using electron-icon-builder (requires PNG input)
```bash
# First convert SVG to PNG (1024x1024) using an online tool or Inkscape
# Then run:
npm install --save-dev electron-icon-builder
npx electron-icon-builder --input=electron/resources/icon-1024.png --output=electron/resources --flatten
```

### Option 2: Using online tools
1. Convert your SVG to PNG (1024x1024) using [CloudConvert](https://cloudconvert.com/svg-to-png)
2. Convert PNG to ICNS using [png2icons](https://github.com/idesis-gmbh/png2icons)
3. Convert PNG to ICO using [icoconvert.com](https://icoconvert.com/)

### Option 3: Using macOS iconutil
```bash
# Create an iconset directory
mkdir icon.iconset

# Generate different sizes (requires ImageMagick or sips)
sips -z 16 16 icon-1024.png --out icon.iconset/icon_16x16.png
sips -z 32 32 icon-1024.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32 icon-1024.png --out icon.iconset/icon_32x32.png
sips -z 64 64 icon-1024.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon-1024.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon-1024.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon-1024.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon-1024.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon-1024.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon-1024.png --out icon.iconset/icon_512x512@2x.png

# Convert to icns
iconutil -c icns icon.iconset -o icon.icns
```

## Current Status

The application is configured to build without custom icons. Electron-builder will use default Electron icons until custom icons are provided.

To enable custom icons, simply add the three files mentioned above to this directory and rebuild the application.

## Design Guidelines

When creating your icon:
- Use a simple, recognizable design
- Ensure it looks good at small sizes (16x16, 32x32)
- Use high contrast for visibility
- Avoid fine details that won't be visible at small sizes
- Test on both light and dark backgrounds
- Consider platform-specific design guidelines:
  - macOS: Rounded corners, subtle shadows
  - Windows: Square with transparency
  - Linux: Flexible, but keep it simple

## Provided SVG Template

The `icon.svg` file in this directory provides a basic template for the DevOrbit Dashboard icon. You can:
1. Use it as-is by converting to the required formats
2. Customize it in a vector graphics editor (Inkscape, Adobe Illustrator, Figma)
3. Replace it entirely with your own design

For professional results, consider hiring a designer or using design tools like:
- [Figma](https://www.figma.com/) - Free design tool
- [Canva](https://www.canva.com/) - Easy icon creation
- [Iconfinder](https://www.iconfinder.com/) - Icon marketplace
