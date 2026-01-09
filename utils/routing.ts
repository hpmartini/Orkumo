/**
 * Generates a URL-safe path for a project
 * @param projectName - Display name to convert to URL slug (max 50 chars)
 * @param projectId - Unique project identifier
 * @returns URL path in format: /{url-safe-name}/{id}
 * @example generateProjectUrl("My App!", "123") // returns "/my-app/123"
 */
export const generateProjectUrl = (projectName: string, projectId: string): string => {
  // Limit URL length to 50 characters for security/practicality
  const urlName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 50)
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing dashes

  // Fallback to 'project' if urlName is empty (e.g., project names with only special chars)
  const finalUrlName = urlName || 'project';

  return `/${finalUrlName}/${projectId}`;
};
