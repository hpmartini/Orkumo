import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { UsageView } from '../components/UsageView/UsageView';

vi.mock('../services/api', () => ({
  fetchUsage: vi.fn(() => new Promise(() => {})),
}));

// Same rule as App.tsx handleBackFromUsage: previous in-app view, else the dashboard
const UsageRoute = () => {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <UsageView
      active
      onBack={() => (location.key !== 'default' ? navigate(-1) : navigate('/dashboard'))}
    />
  );
};
const Where = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
};
const app = (entries: string[]) =>
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="/usage" element={<UsageRoute />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );

describe('usage page back button (#184 AC-6)', () => {
  it('returns to the previous view (context dashboard)', async () => {
    const view = render(
      <MemoryRouter initialEntries={['/dashboard?scope=context']}>
        <Routes>
          <Route path="/usage" element={<UsageRoute />} />
          <Route path="*" element={<OpenUsage />} />
        </Routes>
      </MemoryRouter>
    );
    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard?scope=context');
    view.unmount();
  });

  it('falls back to the dashboard when opened by deep link', async () => {
    app(['/usage']);
    await userEvent.click(screen.getByRole('button', { name: 'Zurück' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/dashboard$/);
  });
});

function OpenUsage() {
  const navigate = useNavigate();
  return (
    <>
      <Where />
      <button onClick={() => navigate('/usage')}>open</button>
    </>
  );
}
