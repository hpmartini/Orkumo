import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ContextDialog,
  CONTEXT_DIALOG_COLLAPSED_KEY,
  CONTEXT_DIALOG_SIZE_KEY,
} from '../components/ContextDialog';
import type { AppConfig } from '../types';

const LAB = '/Users/dev/LAB';
const PROJ = '/Users/dev/WORK';
const app = (id: string, name: string, path: string) => ({ id, name, path }) as AppConfig;
const APPS = [
  app('a', 'alpha', `${LAB}/alpha`),
  app('b', 'beta', `${LAB}/beta`),
  app('c', 'gamma', `${PROJ}/gamma`),
];

function renderDialog(onSave = vi.fn()) {
  render(
    <ContextDialog
      context={{ id: 'x', name: 'Websites', appIds: ['a'], boardFilter: [] }}
      apps={APPS}
      projectDirs={[LAB, PROJ]}
      canDelete
      onSave={onSave}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      onOpenSettings={vi.fn()}
    />
  );
  return onSave;
}

const header = (dir: string) => screen.getByRole('button', { name: new RegExp(dir) });
const visible = (name: string) => screen.queryByRole('checkbox', { name: new RegExp(name) });

beforeEach(() => localStorage.clear());

describe('ContextDialog groups', () => {
  it('collapses and expands one directory by its header, mouse and keyboard', async () => {
    renderDialog();
    const lab = header('LAB');
    expect(lab).toHaveAttribute('aria-expanded', 'true');
    expect(within(lab).getByText('1/2')).toBeInTheDocument();

    fireEvent.click(lab);
    expect(lab).toHaveAttribute('aria-expanded', 'false');
    expect(visible('alpha')).toBeNull();
    expect(visible('gamma')).not.toBeNull(); // other directory untouched
    expect(within(lab).getByText('1/2')).toBeInTheDocument();

    // let the dialog's initial focus (next frame) land first, then reach the header by keyboard
    await new Promise((r) => requestAnimationFrame(r));
    lab.focus();
    expect(lab).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(lab).toHaveAttribute('aria-expanded', 'true');
    expect(visible('alpha')).not.toBeNull();
  });

  it('collapses and expands all directories at once', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Alle Verzeichnisse einklappen' }));
    expect(header('LAB')).toHaveAttribute('aria-expanded', 'false');
    expect(header('WORK')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('checkbox', { name: /alpha|beta|gamma/ })).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Alle Verzeichnisse ausklappen' }));
    expect(screen.queryAllByRole('checkbox', { name: /alpha|beta|gamma/ })).toHaveLength(3);
  });

  it('shows filter matches inside collapsed directories', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Alle Verzeichnisse einklappen' }));
    await userEvent.type(screen.getByLabelText('Projekte filtern'), 'gam');
    expect(visible('gamma')).not.toBeNull();
    expect(header('WORK')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Alle Verzeichnisse einklappen' })).toBeDisabled();
  });

  it('keeps selections of collapsed directories when saving', () => {
    const onSave = renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: /gamma/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Alle Verzeichnisse einklappen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Websites', appIds: ['a', 'c'] })
    );
  });

  it('remembers collapsed directories across openings', () => {
    renderDialog();
    fireEvent.click(header('LAB'));
    expect(JSON.parse(localStorage.getItem(CONTEXT_DIALOG_COLLAPSED_KEY)!)).toEqual([LAB]);
    cleanup();
    renderDialog();
    expect(header('LAB')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('ContextDialog size', () => {
  it('opens with the saved size and lets the list fill the dialog', () => {
    localStorage.setItem(CONTEXT_DIALOG_SIZE_KEY, JSON.stringify({ width: 900, height: 700 }));
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.width).toBe('900px');
    expect(dialog.style.height).toBe('700px');
    expect(screen.getByTestId('context-project-list').style.maxHeight).toBe('');
  });

  it('keeps the old default without a saved size and ignores broken storage', () => {
    localStorage.setItem(CONTEXT_DIALOG_SIZE_KEY, '{oops');
    renderDialog();
    expect(screen.getByRole('dialog').style.width).toBe('560px');
    expect(screen.getByTestId('context-project-list').style.maxHeight).toBe('18rem');
  });
});
