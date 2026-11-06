import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DirectoryPicker } from '../components/AgentsView/DirectoryPicker';

const HOME = '/Users/dev';
const CHOICES = [
  { name: '~ (home)', path: HOME, source: 'home' },
  { name: 'alpha', path: `${HOME}/LAB/alpha`, source: 'repo' },
  { name: 'beta', path: `${HOME}/LAB/beta`, source: 'repo' },
  { name: 'gamma', path: `${HOME}/WORK/gamma`, source: 'repo' },
];

function renderPicker(onPick = vi.fn()) {
  render(
    <DirectoryPicker
      choices={CHOICES}
      current={null}
      home={HOME}
      onCancel={vi.fn()}
      onPick={onPick}
    />
  );
  return onPick;
}

const header = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}`) });
const visibleNames = () =>
  screen
    .queryAllByTestId('dir-choice')
    .filter((el) => !el.closest('[hidden]'))
    .map((el) => el.querySelector('span')!.textContent);

beforeEach(() => localStorage.clear());

describe('DirectoryPicker groups', () => {
  it('collapses one directory by its header and leaves the others open', () => {
    renderPicker();
    const lab = header('~/LAB');
    expect(lab).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(lab);
    expect(lab).toHaveAttribute('aria-expanded', 'false');
    expect(visibleNames()).toEqual(['~ (home)', 'gamma']);
    fireEvent.click(lab);
    expect(visibleNames()).toEqual(['~ (home)', 'alpha', 'beta', 'gamma']);
  });

  it('collapses and expands all directories at once, keeping home pinned', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all directories' }));
    expect(header('~/LAB')).toHaveAttribute('aria-expanded', 'false');
    expect(header('~/WORK')).toHaveAttribute('aria-expanded', 'false');
    expect(visibleNames()).toEqual(['~ (home)']);

    fireEvent.click(screen.getByRole('button', { name: 'Expand all directories' }));
    expect(visibleNames()).toEqual(['~ (home)', 'alpha', 'beta', 'gamma']);
  });

  it('shows filter matches inside collapsed directories and picks them with Enter', async () => {
    const onPick = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all directories' }));
    await userEvent.type(screen.getByPlaceholderText('Directory for new sessions…'), 'gam');
    expect(visibleNames()).toEqual(['gamma']);
    expect(screen.getByRole('button', { name: 'Collapse all directories' })).toBeDisabled();
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(`${HOME}/WORK/gamma`);
  });

  it('remembers collapsed directories across openings', () => {
    renderPicker();
    fireEvent.click(header('~/LAB'));
    expect(header('~/WORK')).toHaveAttribute('aria-expanded', 'true');
    cleanup();
    renderPicker();
    expect(header('~/LAB')).toHaveAttribute('aria-expanded', 'false');
  });
});
