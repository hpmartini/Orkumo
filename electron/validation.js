/**
 * Validation utilities for Electron IPC handlers
 * Extracted for testability
 */

/**
 * Validate URL to prevent opening dangerous protocols or local files
 * Only allows http:// and https:// URLs
 */
export function isValidExternalUrl(urlString, isDev = false) {
  try {
    const url = new URL(urlString);
    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    // Reject localhost URLs unless in dev mode
    if (!isDev && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return false;
    }
    return true;
  } catch (error) {
    // Invalid URL
    return false;
  }
}

/**
 * Validate and sanitize dialog options
 */
export function validateDialogOptions(options, type) {
  if (!options || typeof options !== 'object') {
    return {};
  }

  const sanitized = {};

  if (type === 'messageBox') {
    // Validate message box options
    if (options.message && typeof options.message === 'string') {
      sanitized.message = options.message.slice(0, 1000); // Limit message length
    }
    if (options.title && typeof options.title === 'string') {
      sanitized.title = options.title.slice(0, 200);
    }
    if (options.detail && typeof options.detail === 'string') {
      sanitized.detail = options.detail.slice(0, 2000);
    }
    if (options.type && ['none', 'info', 'error', 'question', 'warning'].includes(options.type)) {
      sanitized.type = options.type;
    }
    if (Array.isArray(options.buttons)) {
      const validButtons = options.buttons
        .filter(b => typeof b === 'string')
        .map(b => b.slice(0, 50))
        .slice(0, 4);
      if (validButtons.length > 0) {
        sanitized.buttons = validButtons;
      }
    }
  } else if (type === 'openDialog') {
    // Validate open dialog options
    if (options.title && typeof options.title === 'string') {
      sanitized.title = options.title.slice(0, 200);
    }
    if (options.defaultPath && typeof options.defaultPath === 'string') {
      sanitized.defaultPath = options.defaultPath;
    }
    if (options.buttonLabel && typeof options.buttonLabel === 'string') {
      sanitized.buttonLabel = options.buttonLabel.slice(0, 50);
    }
    if (Array.isArray(options.properties)) {
      const validProps = ['openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles',
                          'createDirectory', 'promptToCreate', 'noResolveAliases', 'treatPackageAsDirectory'];
      sanitized.properties = options.properties.filter(p => validProps.includes(p));
    }
  }

  return sanitized;
}
