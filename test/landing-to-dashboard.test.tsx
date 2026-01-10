import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter, Routes, Route, MemoryRouter, useNavigate } from 'react-router-dom';

// Simple mock landing component for testing navigation
const MockLanding = () => (
  <div data-testid="landing-page">
    <h1>Landing Page</h1>
    <button onClick={() => window.location.href = '/dashboard'}>
      Get Started
    </button>
  </div>
);

// Mock dashboard component
const MockDashboard = () => (
  <div data-testid="dashboard-page">Dashboard Content</div>
);

describe('Landing to Dashboard Navigation Integration', () => {
  it('should support root path for landing page', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MockLanding />} />
          <Route path="/dashboard" element={<MockDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('landing-page')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument();
  });

  it('should support /dashboard route', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/" element={<MockLanding />} />
          <Route path="/dashboard" element={<MockDashboard />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
  });

  it('should navigate from landing to dashboard using React Router', async () => {
    const TestApp = () => {
      const navigate = useNavigate();

      return (
        <>
          <Routes>
            <Route
              path="/"
              element={
                <div data-testid="landing-page">
                  <h1>Landing</h1>
                  <button onClick={() => navigate('/dashboard')}>
                    Go to Dashboard
                  </button>
                </div>
              }
            />
            <Route path="/dashboard" element={<MockDashboard />} />
          </Routes>
        </>
      );
    };

    render(
      <MemoryRouter initialEntries={['/']}>
        <TestApp />
      </MemoryRouter>
    );

    // Initially on landing
    expect(screen.getByTestId('landing-page')).toBeInTheDocument();

    // Click navigation button
    const navButton = screen.getByText('Go to Dashboard');
    fireEvent.click(navButton);

    // Should navigate to dashboard
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
  });

  it('should support browser history navigation', async () => {
    const TestApp = () => {
      const navigate = useNavigate();

      return (
        <>
          <button onClick={() => navigate('/')}>To Landing</button>
          <button onClick={() => navigate('/dashboard')}>To Dashboard</button>
          <Routes>
            <Route path="/" element={<MockLanding />} />
            <Route path="/dashboard" element={<MockDashboard />} />
          </Routes>
        </>
      );
    };

    render(
      <MemoryRouter initialEntries={['/']}>
        <TestApp />
      </MemoryRouter>
    );

    // Navigate to dashboard
    fireEvent.click(screen.getByText('To Dashboard'));
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });

    // Navigate back to landing
    fireEvent.click(screen.getByText('To Landing'));
    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument();
    });
  });

  it('should handle multiple route transitions', async () => {
    const TestApp = () => {
      const navigate = useNavigate();

      return (
        <>
          <button onClick={() => navigate('/dashboard')}>To Dashboard</button>
          <button onClick={() => navigate('/')}>To Landing</button>
          <Routes>
            <Route path="/" element={<MockLanding />} />
            <Route path="/dashboard" element={<MockDashboard />} />
          </Routes>
        </>
      );
    };

    render(
      <MemoryRouter initialEntries={['/']}>
        <TestApp />
      </MemoryRouter>
    );

    // Initial state
    expect(screen.getByTestId('landing-page')).toBeInTheDocument();

    // Navigate to dashboard
    fireEvent.click(screen.getByText('To Dashboard'));
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });

    // Back to landing
    fireEvent.click(screen.getByText('To Landing'));
    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeInTheDocument();
    });

    // To dashboard again
    fireEvent.click(screen.getByText('To Dashboard'));
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });
  });
});
