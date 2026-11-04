import { describe, expect, it } from 'vitest';
import { clampMenuPosition } from '../utils/menuPosition';

describe('clampMenuPosition', () => {
  it('keeps the anchor when the menu fits', () => {
    expect(clampMenuPosition(100, 50, 200, 300, 1200, 800)).toEqual({ left: 100, top: 50 });
  });
  it('moves up when it would overflow the bottom', () => {
    expect(clampMenuPosition(100, 700, 200, 400, 1200, 800)).toEqual({ left: 100, top: 392 });
  });
  it('moves left when it would overflow the right edge', () => {
    expect(clampMenuPosition(1150, 50, 200, 300, 1200, 800)).toEqual({ left: 992, top: 50 });
  });
  it('moves up and left at the bottom-right corner', () => {
    expect(clampMenuPosition(1190, 790, 200, 300, 1200, 800)).toEqual({ left: 992, top: 492 });
  });
  it('pins to the top margin when the menu is taller than the viewport', () => {
    // the caller caps the height at vh - 2*margin, so a full-height menu sits at the margin
    expect(clampMenuPosition(100, 250, 200, 284, 1200, 300)).toEqual({ left: 100, top: 8 });
    expect(clampMenuPosition(100, 250, 200, 500, 1200, 300)).toEqual({ left: 100, top: 8 });
  });
});
