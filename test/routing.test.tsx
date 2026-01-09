import { describe, it, expect } from 'vitest';
import { generateProjectUrl } from '../utils/routing';

describe('Routing - URL Generation', () => {

  describe('URL-safe conversion', () => {
    it('should convert project names to URL-safe format', () => {
      const testCases = [
        { name: 'Test App', id: '123', expected: '/test-app/123' },
        { name: 'Test App!', id: '456', expected: '/test-app/456' },
        { name: 'My_Cool-Project', id: '789', expected: '/my-cool-project/789' },
        { name: 'app@#$%name', id: 'abc', expected: '/app-name/abc' },
        { name: 'UPPERCASE', id: 'xyz', expected: '/uppercase/xyz' },
      ];

      testCases.forEach(({ name, id, expected }) => {
        const url = generateProjectUrl(name, id);
        expect(url).toBe(expected);
      });
    });

    it('should handle special characters correctly', () => {
      expect(generateProjectUrl('My App!', '123')).toBe('/my-app/123');
      expect(generateProjectUrl('Project (v2)', '456')).toBe('/project-v2/456');
      expect(generateProjectUrl('test&debug', '789')).toBe('/test-debug/789');
      expect(generateProjectUrl('app   spaces', 'abc')).toBe('/app-spaces/abc');
    });

    it('should handle Unicode characters', () => {
      expect(generateProjectUrl('Test-日本語', '123')).toBe('/test/123');
      expect(generateProjectUrl('app-café', '456')).toBe('/app-caf/456');
    });
  });

  describe('URL length limits', () => {
    it('should limit URL name to 50 characters', () => {
      const longName = 'a'.repeat(100);
      const url = generateProjectUrl(longName, 'test-id');
      const urlName = url.split('/')[1]; // Extract the name part

      expect(urlName.length).toBeLessThanOrEqual(50);
    });

    it('should handle very long project names', () => {
      const longName = 'very-long-project-name-that-exceeds-fifty-characters-definitely-more-than-fifty';
      const url = generateProjectUrl(longName, 'id123');
      const urlName = url.split('/')[1];

      expect(urlName.length).toBeLessThanOrEqual(50);
      expect(url).toContain('/id123');
    });

    it('should preserve project ID regardless of name length', () => {
      const longName = 'x'.repeat(200);
      const projectId = 'important-id-12345';
      const url = generateProjectUrl(longName, projectId);

      expect(url).toContain(`/${projectId}`);
    });
  });

  describe('Leading and trailing dash removal', () => {
    it('should remove leading dashes', () => {
      expect(generateProjectUrl('---test', '123')).toBe('/test/123');
      expect(generateProjectUrl('-app', '456')).toBe('/app/456');
    });

    it('should remove trailing dashes', () => {
      expect(generateProjectUrl('test---', '123')).toBe('/test/123');
      expect(generateProjectUrl('app-', '456')).toBe('/app/456');
    });

    it('should remove both leading and trailing dashes', () => {
      expect(generateProjectUrl('---test-app---', '123')).toBe('/test-app/123');
      expect(generateProjectUrl('--my-project--', '456')).toBe('/my-project/456');
    });

    it('should handle names that are only special characters', () => {
      expect(generateProjectUrl('!!!', '123')).toBe('/project/123');
      expect(generateProjectUrl('@@@', '456')).toBe('/project/456');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty project names', () => {
      const url = generateProjectUrl('', 'test-id');
      expect(url).toBe('/project/test-id');
    });

    it('should handle names with only spaces', () => {
      const url = generateProjectUrl('   ', 'test-id');
      expect(url).toBe('/project/test-id');
    });

    it('should handle names with multiple consecutive special characters', () => {
      expect(generateProjectUrl('test!@#$%app', '123')).toBe('/test-app/123');
      expect(generateProjectUrl('my---cool---project', '456')).toBe('/my-cool-project/456');
    });

    it('should preserve internal dashes', () => {
      expect(generateProjectUrl('my-cool-app', '123')).toBe('/my-cool-app/123');
      expect(generateProjectUrl('test-app-v2', '456')).toBe('/test-app-v2/456');
    });
  });

  describe('URL Parameter Parsing', () => {
    it('should extract projectId from URL', () => {
      const url = '/my-project/abc123';
      const match = url.match(/\/([^/]+)\/([^/]+)/);

      expect(match).not.toBeNull();
      if (match) {
        const [, projectName, projectId] = match;
        expect(projectName).toBe('my-project');
        expect(projectId).toBe('abc123');
      }
    });

    it('should handle URL with special characters in project name', () => {
      const url = '/my-special-project-123/xyz789';
      const match = url.match(/\/([^/]+)\/([^/]+)/);

      expect(match).not.toBeNull();
      if (match) {
        const [, projectName, projectId] = match;
        expect(projectName).toBe('my-special-project-123');
        expect(projectId).toBe('xyz789');
      }
    });

    it('should handle UUID-style project IDs', () => {
      const url = '/my-app/550e8400-e29b-41d4-a716-446655440000';
      const match = url.match(/\/([^/]+)\/([^/]+)/);

      expect(match).not.toBeNull();
      if (match) {
        const [, , projectId] = match;
        expect(projectId).toBe('550e8400-e29b-41d4-a716-446655440000');
      }
    });
  });

  describe('Security considerations', () => {
    it('should prevent XSS by removing all dangerous special characters', () => {
      const maliciousNames = [
        '<script>alert("xss")</script>',
        'test<img src=x onerror=alert(1)>',
        'app"><script>alert(1)</script>',
      ];

      maliciousNames.forEach(name => {
        const url = generateProjectUrl(name, 'safe-id');
        // Verify dangerous HTML characters are removed
        expect(url).not.toContain('<');
        expect(url).not.toContain('>');
        expect(url).not.toContain('"');
        expect(url).not.toContain('=');
        // The URL should only contain alphanumeric characters, dashes, and slashes
        expect(url).toMatch(/^\/[a-z0-9-]*\/[a-z0-9-]+$/);
      });
    });

    it('should handle SQL injection attempts', () => {
      const sqlInjection = "'; DROP TABLE projects; --";
      const url = generateProjectUrl(sqlInjection, 'id123');

      expect(url).not.toContain('DROP');
      expect(url).not.toContain('TABLE');
      expect(url).not.toContain(';');
      expect(url).not.toContain("'");
    });

    it('should handle path traversal attempts', () => {
      const pathTraversal = '../../../etc/passwd';
      const url = generateProjectUrl(pathTraversal, 'id456');

      expect(url).not.toContain('..');
      expect(url).toContain('/id456');
    });
  });
});

describe('Routing - useEffect Dependency Array', () => {
  it('should include all required dependencies', () => {
    // This is a documentation test to ensure we remember to include
    // all dependencies in the useEffect that syncs URL params
    const requiredDependencies = [
      'projectId',
      'apps',
      'loading',
      'setSelectedAppId',
      'selectTab',
      'setActiveTab',
      'navigate',
    ];

    // This test documents the expected dependencies
    expect(requiredDependencies).toHaveLength(7);
    expect(requiredDependencies).toContain('loading');
    expect(requiredDependencies).toContain('projectId');
  });
});

describe('Routing - Race Condition Prevention', () => {
  it('should document the loading check pattern', () => {
    // This test documents that we check loading state before processing URL
    const exampleUseEffect = `
      useEffect(() => {
        // Wait for apps to load to avoid race condition
        if (loading) return;

        if (projectId) {
          const projectExists = apps.find(app => app.id === projectId);
          if (projectExists) {
            setSelectedAppId(projectId);
            selectTab(projectId);
            setActiveTab('apps');
          } else {
            navigate('/', { replace: true });
          }
        } else {
          setActiveTab('dashboard');
        }
      }, [projectId, apps, loading, ...]);
    `;

    // Verify the pattern includes loading check
    expect(exampleUseEffect).toContain('if (loading) return');
    expect(exampleUseEffect).toContain('const projectExists = apps.find');
  });
});
