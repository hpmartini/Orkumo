// Minimal stand-in for shadcn's cn(); the copied Aceternity components only join class names.
export const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');
