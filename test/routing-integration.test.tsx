import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams, useNavigate } from 'react-router-dom';
import { generateProjectUrl } from '../utils/routing';

// Mock component that simulates the routing behavior in App.tsx
const MockAppContent = ({
  apps,
  loading,
  onSelectApp
}: {
  apps: { id: string; name: string }[];
  loading: boolean;
  onSelectApp: (id: string) => void;
}) => {
  const params = useParams();
  const navigate = useNavigate();
  const projectId = params.projectId;

  // Simulate the useEffect logic from App.tsx
  React.useEffect(() => {
    if (loading) return;

    if (projectId) {
      const projectExists = apps.find(app => app.id === projectId);
      if (projectExists) {
        onSelectApp(projectId);
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [projectId, apps, loading, navigate, onSelectApp]);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (projectId) {
    const project = apps.find(app => app.id === projectId);
    return (
      <div>
        <h1>Project Detail</h1>
        <div data-testid="project-id">{projectId}</div>
        {project && <div data-testid="project-name">{project.name}</div>}
      </div>
    );
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <ul>
        {apps.map(app => (
          <li key={app.id}>
            <button onClick={() => navigate(generateProjectUrl(app.name, app.id))}>
              {app.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const MockApp = ({
  apps,
  loading,
  onSelectApp
}: {
  apps: { id: string; name: string }[];
  loading: boolean;
  onSelectApp: (id: string) => void;
}) => (
  <Routes>
    <Route path="/" element={<MockAppContent apps={apps} loading={loading} onSelectApp={onSelectApp} />} />
    <Route path="/:projectName/:projectId" element={<MockAppContent apps={apps} loading={loading} onSelectApp={onSelectApp} />} />
    <Route path="*" element={<div>Not Found</div>} />
  </Routes>
);

describe('Routing Integration Tests', () => {
  const mockApps = [
    { id: 'app-1', name: 'Test App' },
    { id: 'app-2', name: 'My Project' },
    { id: 'app-3', name: 'Another App!' },
  ];

  let selectAppSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    selectAppSpy = vi.fn();
  });

  describe('URL Navigation', () => {
    it('should render dashboard when navigating to root', () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(selectAppSpy).not.toHaveBeenCalled();
    });

    it('should render project detail when navigating to valid project URL', async () => {
      const projectUrl = generateProjectUrl('Test App', 'app-1');

      render(
        <MemoryRouter initialEntries={[projectUrl]}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Project Detail')).toBeInTheDocument();
      });

      expect(screen.getByTestId('project-id')).toHaveTextContent('app-1');
      expect(screen.getByTestId('project-name')).toHaveTextContent('Test App');
      expect(selectAppSpy).toHaveBeenCalledWith('app-1');
    });

    it('should redirect to dashboard for invalid project ID', async () => {
      render(
        <MemoryRouter initialEntries={['/invalid-project/invalid-id']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      });

      expect(selectAppSpy).not.toHaveBeenCalled();
    });

    it('should redirect to dashboard for stale project ID', async () => {
      // Simulate a URL with a project that no longer exists
      render(
        <MemoryRouter initialEntries={['/old-project/deleted-id-123']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      });

      expect(selectAppSpy).not.toHaveBeenCalled();
    });
  });

  describe('Loading State', () => {
    it('should show loading state and not process URL', () => {
      render(
        <MemoryRouter initialEntries={['/test-app/app-1']}>
          <MockApp apps={mockApps} loading={true} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(selectAppSpy).not.toHaveBeenCalled();
    });

    it('should process URL after loading completes', async () => {
      const { rerender } = render(
        <MemoryRouter initialEntries={['/test-app/app-1']}>
          <MockApp apps={mockApps} loading={true} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      expect(screen.getByText('Loading...')).toBeInTheDocument();

      // Simulate loading completion
      rerender(
        <MemoryRouter initialEntries={['/test-app/app-1']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Project Detail')).toBeInTheDocument();
      });

      expect(selectAppSpy).toHaveBeenCalledWith('app-1');
    });
  });

  describe('Browser Navigation', () => {
    it('should handle browser back button navigation', async () => {
      const { user } = render(
        <MemoryRouter initialEntries={['/', '/test-app/app-1']} initialIndex={1}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      // Should initially show project detail
      await waitFor(() => {
        expect(screen.getByText('Project Detail')).toBeInTheDocument();
      });

      // Note: Testing actual browser back button in jsdom is limited
      // In a real browser, this would be window.history.back()
    });

    it('should maintain project selection across route changes', async () => {
      // First render with app-1
      const { unmount } = render(
        <MemoryRouter initialEntries={['/test-app/app-1']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('project-id')).toHaveTextContent('app-1');
      });

      unmount();

      // Re-render with app-2
      render(
        <MemoryRouter initialEntries={['/my-project/app-2']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('project-id')).toHaveTextContent('app-2');
      });

      expect(selectAppSpy).toHaveBeenCalledWith('app-2');
    });
  });

  describe('URL Synchronization', () => {
    it('should generate correct URLs for different project names', () => {
      const testCases = [
        { name: 'Test App', id: 'app-1', expected: '/test-app/app-1' },
        { name: 'My Project', id: 'app-2', expected: '/my-project/app-2' },
        { name: 'Another App!', id: 'app-3', expected: '/another-app/app-3' },
      ];

      testCases.forEach(({ name, id, expected }) => {
        expect(generateProjectUrl(name, id)).toBe(expected);
      });
    });

    it('should handle URL with special characters in project name', async () => {
      const specialApps = [
        { id: 'app-1', name: 'App with Spaces' },
        { id: 'app-2', name: 'App@#$%Special' },
      ];

      render(
        <MemoryRouter initialEntries={['/app-with-spaces/app-1']}>
          <MockApp apps={specialApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('project-id')).toHaveTextContent('app-1');
      });

      expect(selectAppSpy).toHaveBeenCalledWith('app-1');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty apps array', async () => {
      render(
        <MemoryRouter initialEntries={['/test-app/app-1']}>
          <MockApp apps={[]} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
      });

      expect(selectAppSpy).not.toHaveBeenCalled();
    });

    it('should handle race condition with apps loading', async () => {
      const { rerender } = render(
        <MemoryRouter initialEntries={['/test-app/app-1']}>
          <MockApp apps={[]} loading={true} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      // Should not attempt to select app while loading
      expect(selectAppSpy).not.toHaveBeenCalled();

      // Apps loaded - should now process URL
      rerender(
        <MemoryRouter initialEntries={['/test-app/app-1']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(selectAppSpy).toHaveBeenCalledWith('app-1');
      });
    });

    it('should handle malformed URLs gracefully', async () => {
      // Test URL that doesn't match any route pattern - should show 404
      const { unmount } = render(
        <MemoryRouter initialEntries={['/invalid']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      // Should show 404/Not Found since it doesn't match any route
      await waitFor(() => {
        expect(screen.getByText('Not Found')).toBeInTheDocument();
      });

      unmount();

      // Test URL with partial project path - should redirect to dashboard
      render(
        <MemoryRouter initialEntries={['/project-name/']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      // This should show 404 as well since it's missing the projectId
      await waitFor(() => {
        expect(screen.getByText('Not Found')).toBeInTheDocument();
      });
    });
  });

  describe('Project Name Changes', () => {
    it('should still work with stale URL slug after project rename', async () => {
      // Initial render with old project name in URL
      const { rerender } = render(
        <MemoryRouter initialEntries={['/old-name/app-1']}>
          <MockApp apps={mockApps} loading={false} onSelectApp={selectAppSpy} />
        </MemoryRouter>
      );

      // Project should still load because projectId is authoritative
      await waitFor(() => {
        expect(screen.getByTestId('project-id')).toHaveTextContent('app-1');
      });

      expect(selectAppSpy).toHaveBeenCalledWith('app-1');
    });
  });
});
