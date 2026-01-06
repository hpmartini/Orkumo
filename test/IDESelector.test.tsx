import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDESelector } from '../components/IDESelector';
import * as api from '../services/api';
import toast from 'react-hot-toast';

// Mock the API and toast
vi.mock('../services/api');
vi.mock('react-hot-toast');

describe('IDESelector', () => {
  const mockIDEs = [
    { id: 'vscode', name: 'Visual Studio Code', path: '/usr/bin/code' },
    { id: 'cursor', name: 'Cursor', path: '/usr/bin/cursor' },
    { id: 'webstorm', name: 'WebStorm', path: '/usr/local/bin/webstorm' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    toast.success = vi.fn();
    toast.error = vi.fn();
  });

  describe('IDE Detection', () => {
    it('should fetch and display installed IDEs on mount', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(mockIDEs);
      vi.mocked(api.openInIDE).mockResolvedValue({ success: true, ide: 'Visual Studio Code', message: 'Success' });

      render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(api.fetchInstalledIDEs).toHaveBeenCalledTimes(1);
      });

      // Should show a dropdown button with the first IDE
      expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
    });

    it('should handle fetch error gracefully', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockRejectedValue(new Error('Network error'));

      render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(api.fetchInstalledIDEs).toHaveBeenCalled();
      });

      // Component should not crash and should render nothing
      expect(screen.queryByText(/Open in/i)).not.toBeInTheDocument();
    });

    it('should render nothing when no IDEs are installed', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue([]);

      const { container } = render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(api.fetchInstalledIDEs).toHaveBeenCalled();
      });

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Single IDE', () => {
    it('should show simple button when only one IDE is installed', async () => {
      const singleIDE = [mockIDEs[0]];
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(singleIDE);
      vi.mocked(api.openInIDE).mockResolvedValue({ success: true, ide: 'Visual Studio Code', message: 'Success' });

      render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
      });

      // Should not have dropdown indicator
      expect(screen.queryByRole('button', { name: /chevron/i })).not.toBeInTheDocument();
    });

    it('should open IDE when single IDE button is clicked', async () => {
      const singleIDE = [mockIDEs[0]];
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(singleIDE);
      vi.mocked(api.openInIDE).mockResolvedValue({
        success: true,
        ide: 'Visual Studio Code',
        message: 'Successfully opened project in Visual Studio Code'
      });

      const user = userEvent.setup();
      render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
      });

      const button = screen.getByRole('button', { name: /Open in Visual Studio Code/i });
      await user.click(button);

      expect(api.openInIDE).toHaveBeenCalledWith('app-1', 'vscode');
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Successfully opened project in Visual Studio Code');
      });
    });
  });

  describe('Multiple IDEs', () => {
    it('should show dropdown when multiple IDEs are installed', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(mockIDEs);

      render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
      });

      // Should have dropdown indicator (ChevronDown icon)
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('should open dropdown and show all IDEs', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(mockIDEs);

      const user = userEvent.setup();
      render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
      });

      const dropdownButton = screen.getByRole('button');
      await user.click(dropdownButton);

      // All IDEs should be visible in the dropdown
      expect(screen.getByText('Visual Studio Code')).toBeInTheDocument();
      expect(screen.getByText('Cursor')).toBeInTheDocument();
      expect(screen.getByText('WebStorm')).toBeInTheDocument();
    });

    it('should select IDE from dropdown', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(mockIDEs);
      vi.mocked(api.openInIDE).mockResolvedValue({
        success: true,
        ide: 'Cursor',
        message: 'Successfully opened project in Cursor'
      });

      const user = userEvent.setup();
      render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
      });

      // Open dropdown
      const dropdownButton = screen.getByRole('button');
      await user.click(dropdownButton);

      // Click on Cursor
      const cursorButton = screen.getByText('Cursor');
      await user.click(cursorButton);

      expect(api.openInIDE).toHaveBeenCalledWith('app-1', 'cursor');
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Successfully opened project in Cursor');
      });
    });
  });

  describe('Preferred IDE', () => {
    it('should show preferred IDE as default when it is installed', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(mockIDEs);

      render(<IDESelector appId="app-1" preferredIDE="cursor" />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Cursor/i)).toBeInTheDocument();
      });
    });

    it('should fall back to first IDE when preferred IDE is not installed', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(mockIDEs);

      // Preferred IDE is 'phpstorm' but it's not in the installed list
      render(<IDESelector appId="app-1" preferredIDE="phpstorm" />);

      await waitFor(() => {
        // Should fall back to first available IDE (Visual Studio Code)
        expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
      });
    });

    it('should mark preferred IDE in dropdown', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(mockIDEs);

      const user = userEvent.setup();
      render(<IDESelector appId="app-1" preferredIDE="cursor" />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Cursor/i)).toBeInTheDocument();
      });

      // Open dropdown
      const dropdownButton = screen.getByRole('button');
      await user.click(dropdownButton);

      // Cursor should have a "Default" indicator
      expect(screen.getByText('✓ Default')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should show error toast when IDE fails to open', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue(mockIDEs);
      vi.mocked(api.openInIDE).mockRejectedValue(new Error('IDE not found'));

      const user = userEvent.setup();
      render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
      });

      // Open dropdown
      const dropdownButton = screen.getByRole('button');
      await user.click(dropdownButton);

      // Click on an IDE
      const ideButton = screen.getByText('Visual Studio Code');
      await user.click(ideButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to open IDE: IDE not found');
      });
    });

    it('should disable button during loading', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue([mockIDEs[0]]);
      vi.mocked(api.openInIDE).mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));

      const user = userEvent.setup();
      render(<IDESelector appId="app-1" />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
      });

      const button = screen.getByRole('button');
      await user.click(button);

      // Button should be disabled during API call
      expect(button).toBeDisabled();
    });
  });

  describe('Callbacks', () => {
    it('should call onSuccess callback after successful IDE open', async () => {
      vi.mocked(api.fetchInstalledIDEs).mockResolvedValue([mockIDEs[0]]);
      vi.mocked(api.openInIDE).mockResolvedValue({
        success: true,
        ide: 'Visual Studio Code',
        message: 'Success'
      });

      const onSuccess = vi.fn();
      const user = userEvent.setup();
      render(<IDESelector appId="app-1" onSuccess={onSuccess} />);

      await waitFor(() => {
        expect(screen.getByText(/Open in Visual Studio Code/i)).toBeInTheDocument();
      });

      const button = screen.getByRole('button');
      await user.click(button);

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledTimes(1);
      });
    });
  });
});
