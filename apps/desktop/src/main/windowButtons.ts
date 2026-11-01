/**
 * How wide macOS draws the three window buttons, in points. There's no API for it: 52 is the long-standing size, and
 * 58 was measured on macOS 26 and later, which draws them further apart.
 * shortcut: a later macOS that resizes them again needs a new entry, measured from a screenshot.
 */
export const buttonsWidth = (macVersion: string): number => (Number.parseInt(macVersion, 10) >= 26 ? 58 : 52);

/** The Mac rail's width in the CSS (`--rail-w`): the window buttons sit on it. */
export const RAIL_WIDTH = 80;

/** Where the window buttons go: in the middle of the rail, with as much space on their left as on their right. */
export const buttonsPosition = (macVersion: string): { x: number; y: number } => ({
  x: Math.round((RAIL_WIDTH - buttonsWidth(macVersion)) / 2),
  y: 16,
});
