import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WebIDEPanel } from '../components/CodingView/WebIDEPanel';

// Mock Monaco Editor
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// Mock fetch for file operations
global.fetch = vi.fn();

describe('WebIDEPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ tree: [] }),
    });
  });

  describe('Editor Type Switcher', () => {
    it('should render Monaco and VS Code buttons', async () => {
      render(<WebIDEPanel directory="/test/project" />);

      expect(await screen.findByText('Monaco')).toBeInTheDocument();
      expect(screen.getByText('VS Code')).toBeInTheDocument();
    });

    it('should have Monaco active by default', async () => {
      render(<WebIDEPanel directory="/test/project" />);

      const monacoButton = await screen.findByRole('button', { name: /Monaco/i });
      expect(monacoButton).toHaveClass('bg-blue-600');
    });

    it('should switch to code-server when VS Code button is clicked', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      expect(vsCodeButton).toHaveClass('bg-blue-600');
      expect(await screen.findByText('Loading VS Code...')).toBeInTheDocument();
    });
  });

  describe('code-server iframe', () => {
    it('should render iframe when switched to VS Code mode', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      expect(iframe).toBeInTheDocument();
    });

    it('should include localhost:8443 in iframe URL', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      expect(iframe?.getAttribute('src')).toContain('http://localhost:8443');
    });

    it('should show loading state initially', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      expect(await screen.findByText('Loading VS Code...')).toBeInTheDocument();
    });

    it('should show retry button on error', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Simulate iframe error
      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      iframe?.dispatchEvent(new Event('error'));

      expect(await screen.findByText(/Failed to load VS Code/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });
  });

  describe('Path mapping', () => {
    it('should map Projects path to container path', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/Users/test/Projects/myapp" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      const src = iframe?.getAttribute('src');
      expect(src).toContain('/home/coder/Projects/myapp');
    });

    it('should handle PROJECTS (uppercase)', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/Users/test/PROJECTS/myapp" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      const src = iframe?.getAttribute('src');
      expect(src).toContain('/home/coder/PROJECTS/myapp');
    });
  });

  describe('Monaco Editor mode', () => {
    it('should show Explorer in Monaco mode', async () => {
      render(<WebIDEPanel directory="/test/project" />);

      expect(await screen.findByText('Explorer')).toBeInTheDocument();
    });

    it('should not show Explorer in code-server mode', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      // Wait for Explorer to appear
      expect(await screen.findByText('Explorer')).toBeInTheDocument();

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Explorer should not be visible
      expect(screen.queryByText('Explorer')).not.toBeInTheDocument();
    });
  });

  describe('Terminal button', () => {
    it('should show terminal button when provided', async () => {
      const onShowTerminal = vi.fn();
      render(
        <WebIDEPanel
          directory="/test/project"
          showTerminalButton={true}
          onShowTerminal={onShowTerminal}
        />
      );

      expect(await screen.findByRole('button', { name: /Terminal/i })).toBeInTheDocument();
    });

    it('should call callback when terminal button clicked', async () => {
      const onShowTerminal = vi.fn();
      const user = userEvent.setup();

      render(
        <WebIDEPanel
          directory="/test/project"
          showTerminalButton={true}
          onShowTerminal={onShowTerminal}
        />
      );

      const terminalButton = await screen.findByRole('button', { name: /Terminal/i });
      await user.click(terminalButton);

      expect(onShowTerminal).toHaveBeenCalledTimes(1);
    });

    it('should not show terminal button when not provided', async () => {
      render(<WebIDEPanel directory="/test/project" />);

      // Wait for component to render
      await screen.findByText('Monaco');

      expect(screen.queryByRole('button', { name: /Terminal/i })).not.toBeInTheDocument();
    });
  });

  describe('15-second timeout behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should show timeout error after 15 seconds if iframe does not load', async () => {
      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Initially should show loading
      expect(await screen.findByText('Loading VS Code...')).toBeInTheDocument();

      // Fast-forward 15 seconds
      vi.advanceTimersByTime(15000);

      // Should now show timeout error
      expect(await screen.findByText(/Failed to load VS Code \(timeout\)/i)).toBeInTheDocument();
    });

    it('should clear timeout when iframe loads successfully', async () => {
      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Simulate iframe load
      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      iframe?.dispatchEvent(new Event('load'));

      // Fast-forward 15 seconds
      vi.advanceTimersByTime(15000);

      // Should NOT show error (timeout was cleared)
      expect(screen.queryByText(/Failed to load VS Code/i)).not.toBeInTheDocument();
    });
  });

  describe('Rapid editor switching', () => {
    it('should handle rapid switching between editors', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const monacoButton = await screen.findByRole('button', { name: /Monaco/i });
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });

      // Switch rapidly
      await user.click(vsCodeButton);
      expect(vsCodeButton).toHaveClass('bg-blue-600');

      await user.click(monacoButton);
      expect(monacoButton).toHaveClass('bg-blue-600');

      await user.click(vsCodeButton);
      expect(vsCodeButton).toHaveClass('bg-blue-600');

      await user.click(monacoButton);
      expect(monacoButton).toHaveClass('bg-blue-600');
    });

    it('should reset loading state when switching away from code-server', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const monacoButton = await screen.findByRole('button', { name: /Monaco/i });
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });

      // Switch to code-server
      await user.click(vsCodeButton);
      expect(await screen.findByText('Loading VS Code...')).toBeInTheDocument();

      // Switch back to Monaco
      await user.click(monacoButton);
      expect(screen.queryByText('Loading VS Code...')).not.toBeInTheDocument();
    });
  });

  describe('Path mapping edge cases', () => {
    it('should handle nested Projects folders', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/Users/test/Projects/client/Projects/nested" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      const src = iframe?.getAttribute('src');
      // Should match LAST occurrence
      expect(src).toContain('/home/coder/Projects/nested');
    });

    it('should handle paths with special characters', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/Users/test/Projects/my-app-v2.0" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      const src = iframe?.getAttribute('src');
      expect(src).toContain('/home/coder/Projects/my-app-v2.0');
    });

    it('should handle paths that do not match Projects pattern', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/Users/test/Documents/code" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      const src = iframe?.getAttribute('src');
      // Should use normalized path as-is
      expect(src).toContain('/Users/test/Documents/code');
    });

    it('should handle Windows-style paths', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="C:\\Users\\test\\Projects\\myapp" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      const src = iframe?.getAttribute('src');
      // Should convert backslashes to forward slashes
      expect(src).toContain('/home/coder/Projects/myapp');
    });
  });

  describe('Retry button functionality', () => {
    it('should reload iframe when retry button is clicked', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Simulate iframe error
      const iframe = document.querySelector('iframe[title="VS Code Server"]') as HTMLIFrameElement;
      const originalSrc = iframe?.src;
      iframe?.dispatchEvent(new Event('error'));

      expect(await screen.findByText(/Failed to load VS Code/i)).toBeInTheDocument();

      // Click retry button
      const retryButton = screen.getByRole('button', { name: /Retry/i });
      await user.click(retryButton);

      // Iframe src should be reassigned (forcing reload)
      const iframeAfterRetry = document.querySelector('iframe[title="VS Code Server"]') as HTMLIFrameElement;
      expect(iframeAfterRetry?.src).toBe(originalSrc);
    });
  });

  describe('iframe security attributes', () => {
    it('should have sandbox attribute for security', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      expect(iframe?.getAttribute('sandbox')).toContain('allow-same-origin');
      expect(iframe?.getAttribute('sandbox')).toContain('allow-scripts');
      expect(iframe?.getAttribute('sandbox')).toContain('allow-forms');
    });

    it('should have allow attribute for clipboard access', async () => {
      const user = userEvent.setup();
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = await screen.findByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      expect(iframe?.getAttribute('allow')).toContain('clipboard-read');
      expect(iframe?.getAttribute('allow')).toContain('clipboard-write');
    });
  });
});
