export const COLORS: {
  readonly green: string;
  readonly orange: string;
  readonly blue: string;
  readonly purple: string;
  readonly red: string;
  readonly white: string;
  readonly black: string;
  readonly yellow: string;
  readonly gray: string;
  readonly brown: string;
  readonly pink: string;
};
export type Color = keyof typeof COLORS;
export const COLOR_NAMES: readonly Color[];
