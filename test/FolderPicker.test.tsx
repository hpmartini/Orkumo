import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CODE_FOLDS_KEY,
  CODE_RECENT_KEY,
  FolderPicker,
  rememberCodeFolder,
} from '../components/CodeView/FolderPicker';
import { codeTargets } from '../utils/codeTarget';

const HOME = '/Users/dev';
const P = `${HOME}/PROJECTS`;
const FIX_LOGIN = `${P}/insta-feed/.claude/worktrees/fix-login`;
const GROUPS = codeTargets(
  [
    { name: 'alpha', path: `${P}/alpha` },
    { name: 'insta-feed', path: `${P}/insta-feed`, worktrees: [FIX_LOGIN] },
    { name: 'beta', path: `${HOME}/LABORATORY/beta` },
  ],
  [],
  HOME
);

function renderPicker(current: string | null = null) {
  const onPick = vi.fn();
  render(<FolderPicker groups={GROUPS} current={current} active onPick={onPick} />);
  const trigger = screen.getByRole('button', { name: /^Folder:/ });
  return { onPick, trigger };
}

const options = () =>
  screen.getAllByRole('option').map((o) => o.querySelector('span')!.textContent);
const activeOption = () =>
  screen.getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true');

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('FolderPicker', () => {
  it('shows the open project and worktree on the trigger, or invites to open one', () => {
    renderPicker(FIX_LOGIN);
    const trigger = screen.getByRole('button', { name: /^Folder:/ });
    expect(trigger).toHaveTextContent('insta-feed/fix-login');
    expect(trigger).toHaveTextContent('~/PROJECTS/insta-feed/.claude/worktrees/fix-login');
    cleanup();
    renderPicker();
    expect(screen.getByRole('button', { name: /^Folder:/ })).toHaveTextContent('Open a project…');
  });

  it('lists Recent first, then scan roots with idle worktrees folded under their project', async () => {
    rememberCodeFolder(`${P}/alpha`);
    rememberCodeFolder(`${HOME}/LABORATORY/beta`);
    rememberCodeFolder('/gone/from/context');
    const { trigger } = renderPicker(`${P}/alpha`);
    await userEvent.click(trigger);
    const recent = screen.getByRole('group', { name: 'Recent' });
    // The open folder is not repeated in Recent; unknown paths are skipped
    expect(within(recent).getAllByRole('option')).toHaveLength(1);
    expect(options()).toEqual(['beta', 'beta', 'alpha', 'insta-feed', '1 worktree']);
    expect(screen.getByRole('combobox')).toHaveFocus();
    // The open folder starts active and checked
    expect(activeOption()).toHaveAttribute('aria-current', 'true');
    expect(activeOption()).toHaveTextContent('alpha');
  });

  it('shows the open worktree even when no agent works in it', async () => {
    const { trigger } = renderPicker(FIX_LOGIN);
    await userEvent.click(trigger);
    expect(options()).toEqual(['beta', 'alpha', 'insta-feed', 'fix-login']);
    expect(activeOption()).toHaveTextContent('fix-login');
  });

  it('filters while typing, folds worktrees with ←/→ and opens one with Enter', async () => {
    const { trigger, onPick } = renderPicker();
    await userEvent.click(trigger);
    await userEvent.keyboard('insta');
    // A project match keeps its worktrees folded
    expect(options()).toEqual(['insta-feed', '1 worktree']);
    expect(screen.getByText('1 project · 0 worktrees')).toBeInTheDocument();
    expect(activeOption()).toHaveTextContent('insta-feed');
    await userEvent.keyboard('{ArrowDown}{ArrowRight}');
    expect(options()).toEqual(['insta-feed', '1 worktree', 'fix-login']);
    await userEvent.keyboard('{ArrowDown}');
    expect(activeOption()).toHaveTextContent('fix-login');
    await userEvent.keyboard('{ArrowLeft}');
    expect(options()).toEqual(['insta-feed', '1 worktree']);
    expect(activeOption()).toHaveTextContent('1 worktree');
    // Enter on the toggle unfolds too; ↓ wraps around
    await userEvent.keyboard('{Enter}{ArrowDown}');
    expect(activeOption()).toHaveTextContent('fix-login');
    await userEvent.keyboard('{ArrowDown}');
    expect(activeOption()).toHaveTextContent('insta-feed');
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(onPick).toHaveBeenCalledWith(FIX_LOGIN);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(JSON.parse(localStorage.getItem(CODE_RECENT_KEY)!)).toEqual([FIX_LOGIN]);
    expect(trigger).toHaveFocus();
    // Folds made while searching are not stored
    expect(localStorage.getItem(CODE_FOLDS_KEY)).toBeNull();
  });

  it('lists a worktree only when it matches by itself', async () => {
    const { trigger } = renderPicker();
    await userEvent.click(trigger);
    await userEvent.keyboard('login');
    expect(options()).toEqual(['insta-feed', 'fix-login']);
    expect(screen.getByText('0 projects · 1 worktree')).toBeInTheDocument();
  });

  it('remembers unfolded worktrees across openings', async () => {
    const { trigger } = renderPicker();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('option', { name: /1 worktree/ }));
    expect(options()).toContain('fix-login');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(trigger);
    expect(options()).toEqual(['beta', 'alpha', 'insta-feed', '1 worktree', 'fix-login']);
  });

  it('explains an empty search', async () => {
    const { trigger } = renderPicker();
    await userEvent.click(trigger);
    await userEvent.keyboard('zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No folder matches “zzz”/)).toBeInTheDocument();
  });

  it('closes with Esc and returns focus to the trigger', async () => {
    const { trigger, onPick } = renderPicker();
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('opens with Ctrl+O and collapses a scan root by its header', async () => {
    renderPicker();
    fireEvent.keyDown(document, { key: 'o', ctrlKey: true });
    expect(screen.getByRole('combobox')).toHaveFocus();
    const projects = screen.getByRole('button', { name: /^PROJECTS/ });
    await userEvent.click(projects);
    expect(projects).toHaveAttribute('aria-expanded', 'false');
    expect(options()).toEqual(['beta']);
  });

  it('records opened folders newest first', () => {
    rememberCodeFolder('/a');
    rememberCodeFolder('/b');
    rememberCodeFolder('/a');
    expect(JSON.parse(localStorage.getItem(CODE_RECENT_KEY)!)).toEqual(['/a', '/b']);
  });
});
