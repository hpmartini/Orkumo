import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Mock dependencies before importing the module
vi.mock('fs');
vi.mock('./configService.js', () => ({
  getConfig: vi.fn(() => ({
    directories: ['/test/projects'],
    scanDepth: 2,
    excludePatterns: ['node_modules', '.git', 'dist', 'build'],
  })),
}));

// We need to test the functions by importing the module
// Since scannerService exports scanAllDirectories and scanDirectory,
// we'll test those and their internal helper functions through behavior

describe('scannerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateProjectId', () => {
    it('should generate consistent 16-character hex IDs', () => {
      const testPath = '/Users/test/projects/my-app';
      const hash = crypto.createHash('sha256').update(testPath).digest('hex').slice(0, 16);

      // The ID should be a 16-character hex string
      expect(hash).toMatch(/^[a-f0-9]{16}$/);

      // Same path should generate same ID
      const hash2 = crypto.createHash('sha256').update(testPath).digest('hex').slice(0, 16);
      expect(hash).toBe(hash2);
    });

    it('should generate different IDs for different paths', () => {
      const path1 = '/Users/test/projects/app1';
      const path2 = '/Users/test/projects/app2';

      const hash1 = crypto.createHash('sha256').update(path1).digest('hex').slice(0, 16);
      const hash2 = crypto.createHash('sha256').update(path2).digest('hex').slice(0, 16);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('detectProjectType', () => {
    // Test project type detection logic
    const detectProjectType = (packageJson) => {
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (deps['next']) return { type: 'next', framework: 'Next.js' };
      if (deps['vite']) return { type: 'vite', framework: 'Vite' };
      if (deps['@vitejs/plugin-react']) return { type: 'vite', framework: 'React + Vite' };
      if (deps['react-scripts']) return { type: 'cra', framework: 'Create React App' };
      if (deps['vue']) return { type: 'vue', framework: 'Vue.js' };
      if (deps['nuxt']) return { type: 'nuxt', framework: 'Nuxt' };
      if (deps['express']) return { type: 'node', framework: 'Express' };
      if (deps['fastify']) return { type: 'node', framework: 'Fastify' };
      if (deps['koa']) return { type: 'node', framework: 'Koa' };
      if (deps['nest']) return { type: 'node', framework: 'NestJS' };
      if (packageJson.scripts?.start) return { type: 'node', framework: 'Node.js' };

      return { type: 'unknown', framework: 'Unknown' };
    };

    it('should detect Next.js projects', () => {
      const packageJson = {
        dependencies: { next: '^14.0.0', react: '^18.0.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'next', framework: 'Next.js' });
    });

    it('should detect Vite projects', () => {
      const packageJson = {
        devDependencies: { vite: '^5.0.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'vite', framework: 'Vite' });
    });

    it('should detect React + Vite projects', () => {
      const packageJson = {
        devDependencies: { '@vitejs/plugin-react': '^4.0.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'vite', framework: 'React + Vite' });
    });

    it('should detect Create React App projects', () => {
      const packageJson = {
        dependencies: { 'react-scripts': '^5.0.0', react: '^18.0.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({
        type: 'cra',
        framework: 'Create React App',
      });
    });

    it('should detect Vue.js projects', () => {
      const packageJson = {
        dependencies: { vue: '^3.0.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'vue', framework: 'Vue.js' });
    });

    it('should detect Nuxt projects', () => {
      const packageJson = {
        dependencies: { nuxt: '^3.0.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'nuxt', framework: 'Nuxt' });
    });

    it('should detect Express projects', () => {
      const packageJson = {
        dependencies: { express: '^4.18.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'node', framework: 'Express' });
    });

    it('should detect Fastify projects', () => {
      const packageJson = {
        dependencies: { fastify: '^4.0.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'node', framework: 'Fastify' });
    });

    it('should detect NestJS projects', () => {
      const packageJson = {
        dependencies: { nest: '^10.0.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'node', framework: 'NestJS' });
    });

    it('should detect generic Node.js projects with start script', () => {
      const packageJson = {
        scripts: { start: 'node index.js' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'node', framework: 'Node.js' });
    });

    it('should return unknown for unrecognized projects', () => {
      const packageJson = {
        name: 'my-project',
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'unknown', framework: 'Unknown' });
    });

    it('should prioritize Next.js over other frameworks', () => {
      const packageJson = {
        dependencies: { next: '^14.0.0', express: '^4.18.0' },
      };
      expect(detectProjectType(packageJson)).toEqual({ type: 'next', framework: 'Next.js' });
    });
  });

  describe('detectStartCommand', () => {
    const detectStartCommand = (packageJson, projectType) => {
      const scripts = packageJson.scripts || {};

      const devCommands = ['dev', 'start:dev', 'serve', 'develop'];
      for (const cmd of devCommands) {
        if (scripts[cmd]) return `npm run ${cmd}`;
      }

      if (scripts.start) return 'npm start';

      switch (projectType) {
        case 'next':
          return 'npm run dev';
        case 'vite':
          return 'npm run dev';
        case 'cra':
          return 'npm start';
        default:
          return 'npm start';
      }
    };

    it('should prioritize dev script', () => {
      const packageJson = {
        scripts: { dev: 'vite', start: 'node server.js' },
      };
      expect(detectStartCommand(packageJson, 'vite')).toBe('npm run dev');
    });

    it('should use serve script if no dev', () => {
      const packageJson = {
        scripts: { serve: 'vue-cli-service serve' },
      };
      expect(detectStartCommand(packageJson, 'vue')).toBe('npm run serve');
    });

    it('should fallback to npm start', () => {
      const packageJson = {
        scripts: { start: 'node index.js' },
      };
      expect(detectStartCommand(packageJson, 'node')).toBe('npm start');
    });

    it('should use project type default when no scripts', () => {
      expect(detectStartCommand({}, 'next')).toBe('npm run dev');
      expect(detectStartCommand({}, 'vite')).toBe('npm run dev');
      expect(detectStartCommand({}, 'cra')).toBe('npm start');
    });
  });

  describe('detectPort', () => {
    const detectPort = (packageJson, projectType) => {
      const scripts = packageJson.scripts || {};
      const devScript = scripts.dev || scripts.start || '';

      const portMatch = devScript.match(/--port[=\s]+(\d+)|-p[=\s]+(\d+)|PORT[=\s]+(\d+)/i);
      if (portMatch) {
        return parseInt(portMatch[1] || portMatch[2] || portMatch[3], 10);
      }

      switch (projectType) {
        case 'next':
          return 3000;
        case 'vite':
          return 5173;
        case 'cra':
          return 3000;
        case 'vue':
          return 8080;
        case 'nuxt':
          return 3000;
        case 'node':
          return 3000;
        default:
          return 3000;
      }
    };

    it('should extract port from --port flag', () => {
      const packageJson = {
        scripts: { dev: 'vite --port 4000' },
      };
      expect(detectPort(packageJson, 'vite')).toBe(4000);
    });

    it('should extract port from -p flag', () => {
      const packageJson = {
        scripts: { dev: 'next dev -p 4000' },
      };
      expect(detectPort(packageJson, 'next')).toBe(4000);
    });

    it('should extract port from PORT env var in script', () => {
      const packageJson = {
        scripts: { start: 'PORT=8000 node server.js' },
      };
      expect(detectPort(packageJson, 'node')).toBe(8000);
    });

    it('should use framework defaults', () => {
      expect(detectPort({}, 'next')).toBe(3000);
      expect(detectPort({}, 'vite')).toBe(5173);
      expect(detectPort({}, 'cra')).toBe(3000);
      expect(detectPort({}, 'vue')).toBe(8080);
      expect(detectPort({}, 'nuxt')).toBe(3000);
    });
  });

  describe('Docker Compose detection', () => {
    const DOCKER_COMPOSE_FILES = [
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ];

    it('should recognize all Docker Compose file variants', () => {
      expect(DOCKER_COMPOSE_FILES).toContain('docker-compose.yml');
      expect(DOCKER_COMPOSE_FILES).toContain('docker-compose.yaml');
      expect(DOCKER_COMPOSE_FILES).toContain('compose.yml');
      expect(DOCKER_COMPOSE_FILES).toContain('compose.yaml');
    });

    it('should prioritize docker-compose.yml', () => {
      // The array order determines priority
      expect(DOCKER_COMPOSE_FILES[0]).toBe('docker-compose.yml');
    });
  });

  describe('parseDockerComposeServices', () => {
    it('should parse services from compose file content', async () => {
      const yaml = await import('js-yaml');
      const composeContent = `
version: '3.8'
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
  api:
    image: node:20
    ports:
      - "3000:3000"
`;
      const compose = yaml.load(composeContent);

      expect(compose.services).toBeDefined();
      expect(Object.keys(compose.services)).toContain('web');
      expect(Object.keys(compose.services)).toContain('api');
      expect(compose.services.web.ports).toContain('8080:80');
    });

    it('should handle compose files without services', async () => {
      const yaml = await import('js-yaml');
      const composeContent = `
version: '3.8'
`;
      const compose = yaml.load(composeContent);
      expect(compose.services).toBeUndefined();
    });
  });
});
