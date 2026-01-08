import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe('Editor Type Switcher', () => {
    it('should render Monaco editor by default', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      render(<WebIDEPanel directory="/test/project" />);

      await waitFor(() => {
        expect(screen.getByText('Monaco')).toBeInTheDocument();
        expect(screen.getByText('VS Code')).toBeInTheDocument();
      });

      // Monaco button should be active
      const monacoButton = screen.getByRole('button', { name: /Monaco/i });
      expect(monacoButton).toHaveClass('bg-blue-600');
    });

    it('should switch to code-server when VS Code button is clicked', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // VS Code button should be active
      expect(vsCodeButton).toHaveClass('bg-blue-600');

      // Should show loading state
      expect(screen.getByText('Loading VS Code...')).toBeInTheDocument();
    });

    it('should switch back to Monaco from code-server', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      // Switch to VS Code
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Switch back to Monaco
      const monacoButton = screen.getByRole('button', { name: /Monaco/i });
      await user.click(monacoButton);

      // Monaco should be active again
      expect(monacoButton).toHaveClass('bg-blue-600');
      expect(screen.queryByText('Loading VS Code...')).not.toBeInTheDocument();
    });
  });

  describe('code-server iframe', () => {
    it('should render iframe with correct URL', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/Users/test/Projects/myapp" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Check iframe is rendered
      await waitFor(() => {
        const iframe = document.querySelector('iframe[title="VS Code Server"]');
        expect(iframe).toBeInTheDocument();
        expect(iframe?.getAttribute('src')).toContain('http://localhost:8443');
        expect(iframe?.getAttribute('src')).toContain('folder=');
      });
    });

    it('should show loading state initially', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Should show loading state
      expect(screen.getByText('Loading VS Code...')).toBeInTheDocument();
    });

    it('should hide loading state when iframe loads', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      expect(screen.getByText('Loading VS Code...')).toBeInTheDocument();

      // Simulate iframe load
      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      iframe?.dispatchEvent(new Event('load'));

      await waitFor(() => {
        expect(screen.queryByText('Loading VS Code...')).not.toBeInTheDocument();
      });
    });

    it('should show error when iframe fails to load', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Simulate iframe error
      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      iframe?.dispatchEvent(new Event('error'));

      await waitFor(() => {
        expect(screen.getByText(/Failed to load VS Code/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
      });
    });

    it('should show timeout error if iframe does not load within 15 seconds', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      expect(screen.getByText('Loading VS Code...')).toBeInTheDocument();

      // Fast-forward time by 15 seconds
      vi.advanceTimersByTime(15000);

      await waitFor(() => {
        expect(screen.getByText(/Failed to load VS Code \(timeout\)/i)).toBeInTheDocument();
      });
    });

    it('should clear timeout when iframe loads successfully', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Simulate iframe load before timeout
      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      iframe?.dispatchEvent(new Event('load'));

      await waitFor(() => {
        expect(screen.queryByText('Loading VS Code...')).not.toBeInTheDocument();
      });

      // Fast-forward time to ensure timeout was cleared
      vi.advanceTimersByTime(15000);

      // Should not show timeout error
      expect(screen.queryByText(/Failed to load VS Code \(timeout\)/i)).not.toBeInTheDocument();
    });

    it('should allow retry after error', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Simulate iframe error
      const iframe = document.querySelector('iframe[title="VS Code Server"]');
      iframe?.dispatchEvent(new Event('error'));

      await waitFor(() => {
        expect(screen.getByText(/Failed to load VS Code/i)).toBeInTheDocument();
      });

      // Click retry
      const retryButton = screen.getByRole('button', { name: /Retry/i });
      await user.click(retryButton);

      // Should show loading state again
      expect(screen.getByText('Loading VS Code...')).toBeInTheDocument();
      expect(screen.queryByText(/Failed to load VS Code/i)).not.toBeInTheDocument();
    });
  });

  describe('Path mapping', () => {
    it('should map Projects path correctly', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/Users/test/Projects/myapp" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      await waitFor(() => {
        const iframe = document.querySelector('iframe[title="VS Code Server"]');
        const src = iframe?.getAttribute('src');
        expect(src).toContain('/home/coder/Projects/myapp');
      });
    });

    it('should map PROJECTS path correctly (case insensitive)', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/Users/test/PROJECTS/myapp" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      await waitFor(() => {
        const iframe = document.querySelector('iframe[title="VS Code Server"]');
        const src = iframe?.getAttribute('src');
        expect(src).toContain('/home/coder/PROJECTS/myapp');
      });
    });

    it('should handle paths with subdirectories', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/Users/test/Projects/workspace/myapp" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      await waitFor(() => {
        const iframe = document.querySelector('iframe[title="VS Code Server"]');
        const src = iframe?.getAttribute('src');
        expect(src).toContain('/home/coder/Projects/workspace/myapp');
      });
    });
  });

  describe('Monaco Editor', () => {
    it('should render file explorer in Monaco mode', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          tree: [
            { name: 'file.ts', path: '/test/file.ts', isDirectory: false },
          ],
        }),
      });

      render(<WebIDEPanel directory="/test/project" />);

      await waitFor(() => {
        expect(screen.getByText('Explorer')).toBeInTheDocument();
        expect(screen.getByText('file.ts')).toBeInTheDocument();
      });
    });

    it('should not show file explorer in code-server mode', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          tree: [
            { name: 'file.ts', path: '/test/file.ts', isDirectory: false },
          ],
        }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText('Explorer')).toBeInTheDocument();
      });

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      // Explorer should not be visible
      expect(screen.queryByText('Explorer')).not.toBeInTheDocument();
    });
  });

  describe('Terminal button', () => {
    it('should show terminal button when prop is provided', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const onShowTerminal = vi.fn();
      render(
        <WebIDEPanel
          directory="/test/project"
          showTerminalButton={true}
          onShowTerminal={onShowTerminal}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Terminal/i })).toBeInTheDocument();
      });
    });

    it('should call onShowTerminal when terminal button is clicked', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const onShowTerminal = vi.fn();
      const user = userEvent.setup({ delay: null });

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

    it('should not show terminal button when prop is not provided', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      render(<WebIDEPanel directory="/test/project" />);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /Terminal/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('Environment variable', () => {
    it('should use custom code-server URL from environment', async () => {
      // Mock environment variable
      const originalEnv = import.meta.env.VITE_CODE_SERVER_URL;
      import.meta.env.VITE_CODE_SERVER_URL = 'https://custom.example.com:9000';

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ tree: [] }),
      });

      const user = userEvent.setup({ delay: null });
      render(<WebIDEPanel directory="/test/project" />);

      // Switch to code-server
      const vsCodeButton = screen.getByRole('button', { name: /VS Code/i });
      await user.click(vsCodeButton);

      await waitFor(() => {
        const iframe = document.querySelector('iframe[title="VS Code Server"]');
        expect(iframe?.getAttribute('src')).toContain('https://custom.example.com:9000');
      });

      // Restore environment
      import.meta.env.VITE_CODE_SERVER_URL = originalEnv;
    });
  });
});
