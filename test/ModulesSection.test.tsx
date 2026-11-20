import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ModulesSection } from '../components/ModulesSection';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const Where = () => {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
};

function renderSection(onNavigate = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ModulesSection onNavigate={onNavigate} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  return onNavigate;
}

describe('ModulesSection settings link', () => {
  afterEach(() => mockFetch.mockReset());

  it('renders a link per module with settings that navigates to its path and closes the panel', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            entry: 'flow',
            id: 'flow',
            name: 'Flow',
            version: '1.0.0',
            status: 'loaded',
            settings: {
              label: 'Workflow settings',
              hint: 'Open its page',
              to: '/flow?view=control',
            },
          },
          { entry: 'plain', id: 'plain', name: 'Plain', version: '1.0.0', status: 'loaded' },
        ]),
    });
    const onNavigate = renderSection();
    const link = await screen.findByRole('button', { name: 'Workflow settings' });
    expect(link).toHaveAttribute('title', 'Open its page');
    expect(screen.getAllByRole('button')).toHaveLength(2); // the link and "Reload modules"
    fireEvent.click(link);
    expect(screen.getByTestId('where')).toHaveTextContent('/flow?view=control');
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
