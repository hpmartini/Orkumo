import { describe, it, expect, vi } from 'vitest';
import { buildMenuTemplate } from '../electron/menu.js';

function build(isMac) {
  const actions = {
    appName: 'Orkumo',
    isMac,
    onRefresh: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onOpenSettings: vi.fn(),
    openExternal: vi.fn(),
  };
  return { template: buildMenuTemplate(actions), actions };
}

const items = (menu) => menu.submenu.filter((i) => i.type !== 'separator');
const find = (template, label) => template.flatMap((m) => m.submenu).find((i) => i.label === label);

describe('application menu', () => {
  it('macOS: app menu first, then File/Edit/View/Window/Help', () => {
    const { template } = build(true);
    expect(template.map((m) => m.label)).toEqual([
      'Orkumo',
      'File',
      'Edit',
      'View',
      'Window',
      'Help',
    ]);
    expect(items(template[0]).map((i) => i.role ?? i.label)).toEqual([
      'about',
      'Check for Updates…',
      'Settings…',
      'services',
      'hide',
      'hideOthers',
      'unhide',
      'quit',
    ]);
  });

  it('Settings… has Cmd+, and asks the renderer to open the settings', () => {
    const { template, actions } = build(true);
    const settings = template[0].submenu.find((i) => i.label === 'Settings…');
    expect(settings.accelerator).toBe('CmdOrCtrl+,');
    settings.click();
    expect(actions.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('Check for Updates… starts a manual check', () => {
    const { template, actions } = build(true);
    find(template, 'Check for Updates…').click();
    expect(actions.onCheckForUpdates).toHaveBeenCalledTimes(1);
  });

  it('macOS: Quit and Settings only once (app menu), Refresh stays in File', () => {
    const { template } = build(true);
    const all = template.flatMap((m) => m.submenu);
    expect(all.filter((i) => i.role === 'quit')).toHaveLength(1);
    expect(all.filter((i) => i.accelerator === 'CmdOrCtrl+,')).toHaveLength(1);
    expect(items(template[1]).map((i) => i.label)).toEqual(['Refresh']);
  });

  it('Linux/Windows: no app menu; Settings in File, Check for Updates in Help', () => {
    const { template } = build(false);
    expect(template.map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Window', 'Help']);
    expect(template[0].submenu.some((i) => i.label === 'Settings…')).toBe(true);
    expect(template[0].submenu.some((i) => i.role === 'quit')).toBe(true);
    expect(template[4].submenu.some((i) => i.label === 'Check for Updates…')).toBe(true);
  });
});
