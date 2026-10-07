export const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  Home: "#f87171",
  Car: "#60a5fa",
  Health: "#4ade80",
  Money: "#fbbf24",
  Documents: "#a78bfa",
  Pets: "#fb923c",
  Other: "#94a3b8",
};

/** 12-color picker palette shown in the Settings color editor. */
export const COLOR_PALETTE = [
  "#f87171", "#fb923c", "#fbbf24", "#a3e635",
  "#4ade80", "#34d399", "#60a5fa", "#818cf8",
  "#a78bfa", "#e879f9", "#fb7185", "#94a3b8",
];

/** Return the color for a category, falling back to the built-in default. */
export function getCategoryColor(
  category: string,
  overrides: Record<string, string> = {}
): string {
  return overrides[category] ?? DEFAULT_CATEGORY_COLORS[category] ?? "#94a3b8";
}
