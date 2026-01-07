import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaudeTerminalModal } from '../components/ClaudeTerminalModal';
import type { ClaudeCLIInfo } from '../types';

describe('ClaudeTerminalModal', () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  const claudeInstalledInfo: ClaudeCLIInfo = {
    installed: true,
    path: '/usr/local/bin/claude',
    version: 'v1.0.0',
  };

  const claudeNotInstalledInfo: ClaudeCLIInfo = {
    installed: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Modal Display', () => {
    it('should not render when isOpen is false', () => {
      const { container } = render(
        <ClaudeTerminalModal
          isOpen={false}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render when isOpen is true', () => {
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      expect(screen.getByText('Open Claude Code Terminal')).toBeInTheDocument();
    });

    it('should show warning when Claude CLI is not installed', () => {
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeNotInstalledInfo}
        />
      );

      expect(screen.getByText(/Claude CLI not detected/i)).toBeInTheDocument();
    });

    it('should show version info when Claude CLI is installed', () => {
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      expect(screen.getByText(/v1.0.0/)).toBeInTheDocument();
    });
  });

  describe('Options', () => {
    it('should toggle continue session option', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const checkbox = screen.getByLabelText(/Continue last session/i);
      expect(checkbox).not.toBeChecked();

      await user.click(checkbox);
      expect(checkbox).toBeChecked();
    });

    it('should toggle skip permissions option', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const checkbox = screen.getByLabelText(/Skip permissions/i);
      expect(checkbox).not.toBeChecked();

      await user.click(checkbox);
      expect(checkbox).toBeChecked();
    });

    it('should show security warning when skip permissions is enabled', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const checkbox = screen.getByLabelText(/Skip permissions/i);
      await user.click(checkbox);

      expect(screen.getByText(/Security Warning/i)).toBeInTheDocument();
      expect(screen.getByText(/I understand the security implications/i)).toBeInTheDocument();
    });

    it('should hide security warning when skip permissions is disabled', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const checkbox = screen.getByLabelText(/Skip permissions/i);
      await user.click(checkbox);
      expect(screen.getByText(/Security Warning/i)).toBeInTheDocument();

      await user.click(checkbox);
      expect(screen.queryByText(/Security Warning/i)).not.toBeInTheDocument();
    });
  });

  describe('Security Warning Acknowledgment', () => {
    it('should disable Open Terminal button when skip permissions is enabled without acknowledgment', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const skipPermissionsCheckbox = screen.getByLabelText(/Skip permissions/i);
      await user.click(skipPermissionsCheckbox);

      const openButton = screen.getByRole('button', { name: /Open Terminal/i });
      expect(openButton).toBeDisabled();
    });

    it('should enable Open Terminal button when warning is acknowledged', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const skipPermissionsCheckbox = screen.getByLabelText(/Skip permissions/i);
      await user.click(skipPermissionsCheckbox);

      const acknowledgeCheckbox = screen.getByLabelText(/I understand the security implications/i);
      await user.click(acknowledgeCheckbox);

      const openButton = screen.getByRole('button', { name: /Open Terminal/i });
      expect(openButton).toBeEnabled();
    });
  });

  describe('Modal Actions', () => {
    it('should call onClose when Cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      await user.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when X button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const closeButton = screen.getByLabelText(/Close modal/i);
      await user.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should call onConfirm with correct options when Open Terminal is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const continueCheckbox = screen.getByLabelText(/Continue last session/i);
      await user.click(continueCheckbox);

      const openButton = screen.getByRole('button', { name: /Open Terminal/i });
      await user.click(openButton);

      expect(mockOnConfirm).toHaveBeenCalledWith({
        continueSession: true,
        skipPermissions: false,
      });
    });

    it('should reset state after confirming', async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const continueCheckbox = screen.getByLabelText(/Continue last session/i);
      await user.click(continueCheckbox);

      const openButton = screen.getByRole('button', { name: /Open Terminal/i });
      await user.click(openButton);

      // Reopen modal
      rerender(
        <ClaudeTerminalModal
          isOpen={false}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );
      rerender(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      // State should be reset
      const continueCheckboxAfter = screen.getByLabelText(/Continue last session/i);
      expect(continueCheckboxAfter).not.toBeChecked();
    });
  });

  describe('Keyboard Interaction', () => {
    it('should close modal when Escape key is pressed', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      await user.keyboard('{Escape}');

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should not close modal when Escape is pressed if modal is closed', async () => {
      const user = userEvent.setup();
      render(
        <ClaudeTerminalModal
          isOpen={false}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      await user.keyboard('{Escape}');

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'claude-modal-title');
    });

    it('should have proper label associations for checkboxes', () => {
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeInstalledInfo}
        />
      );

      const continueCheckbox = screen.getByLabelText(/Continue last session/i);
      expect(continueCheckbox).toHaveAttribute('id', 'continue-session');
      expect(continueCheckbox).toHaveAttribute('aria-describedby', 'continue-session-description');
    });
  });

  describe('Claude Not Installed', () => {
    it('should disable Open Terminal button when Claude is not installed', () => {
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeNotInstalledInfo}
        />
      );

      const openButton = screen.getByRole('button', { name: /Open Terminal/i });
      expect(openButton).toBeDisabled();
    });

    it('should not show options when Claude is not installed', () => {
      render(
        <ClaudeTerminalModal
          isOpen={true}
          onClose={mockOnClose}
          onConfirm={mockOnConfirm}
          claudeInfo={claudeNotInstalledInfo}
        />
      );

      expect(screen.queryByLabelText(/Continue last session/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Skip permissions/i)).not.toBeInTheDocument();
    });
  });
});
