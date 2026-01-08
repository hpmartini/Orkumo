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
});
