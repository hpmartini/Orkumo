import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LandingPage } from '../components/Landing';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    nav: ({ children, ...props }: any) => <nav {...props}>{children}</nav>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    a: ({ children, ...props }: any) => <a {...props}>{children}</a>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    section: ({ children, ...props }: any) => <section {...props}>{children}</section>,
  },
  AnimatePresence: ({ children }: any) => children,
}));

// Mock Three.js components to avoid WebGL issues in tests
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: any) => <div data-testid="canvas">{children}</div>,
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({}));

describe('Landing Page', () => {
  const renderWithRouter = (component: React.ReactElement) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };

  it('renders the landing page without crashing', () => {
    renderWithRouter(<LandingPage />);
    expect(screen.getByText(/DevOrbit/i)).toBeInTheDocument();
  });

  it('displays the hero heading', () => {
    renderWithRouter(<LandingPage />);
    expect(screen.getByText(/Orchestrate Your/i)).toBeInTheDocument();
    expect(screen.getByText(/Dev Ecosystem/i)).toBeInTheDocument();
  });

  it('displays the navigation menu', () => {
    renderWithRouter(<LandingPage />);
    expect(screen.getByText(/Features/i)).toBeInTheDocument();
    expect(screen.getByText(/Why Us/i)).toBeInTheDocument();
  });

  it('renders the shader background', () => {
    renderWithRouter(<LandingPage />);
    const canvas = screen.getByTestId('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('displays CTA buttons', () => {
    renderWithRouter(<LandingPage />);
    const dashboardButtons = screen.getAllByText(/Dashboard/i);
    expect(dashboardButtons.length).toBeGreaterThan(0);
  });

  it('renders the footer', () => {
    renderWithRouter(<LandingPage />);
    const currentYear = new Date().getFullYear();
    expect(screen.getByText(new RegExp(currentYear.toString()))).toBeInTheDocument();
  });
});
