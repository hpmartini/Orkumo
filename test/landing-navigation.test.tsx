import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Navbar } from '../components/Landing/Navbar';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    nav: ({ children, ...props }: any) => <nav {...props}>{children}</nav>,
    a: ({ children, ...props }: any) => <a {...props}>{children}</a>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

describe('Landing Page Navigation', () => {
  const renderWithRouter = (component: React.ReactElement) => {
    return render(<BrowserRouter>{component}</BrowserRouter>);
  };

  it('renders navigation items', () => {
    renderWithRouter(<Navbar />);
    expect(screen.getByText('Features')).toBeInTheDocument();
    expect(screen.getByText('Why Us')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('has accessible mobile menu button', () => {
    renderWithRouter(<Navbar />);
    const menuButton = screen.getByLabelText(/navigation menu/i);
    expect(menuButton).toBeInTheDocument();
    expect(menuButton).toHaveAttribute('aria-expanded');
    expect(menuButton).toHaveAttribute('aria-controls');
  });

  it('toggles mobile menu on button click', () => {
    renderWithRouter(<Navbar />);
    const menuButton = screen.getByLabelText(/navigation menu/i);

    // Initially closed
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    // Click to open
    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    // Click to close
    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('has ARIA label on CTA button', () => {
    renderWithRouter(<Navbar />);
    const ctaButtons = screen.getAllByRole('button');
    const bookCallButton = ctaButtons.find(btn =>
      btn.textContent?.includes('Book a Call')
    );
    expect(bookCallButton).toHaveAttribute('aria-label');
  });

  it('renders DevOrbit logo', () => {
    renderWithRouter(<Navbar />);
    expect(screen.getByText('DevOrbit')).toBeInTheDocument();
  });
});
