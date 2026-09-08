export function formatFileSize(size: number | null): string | undefined {
  if (size === null || !Number.isFinite(size) || size < 0) return undefined;
  const unit = size >= 1024 * 1024 ? "MB" : size >= 1024 ? "KB" : "B";
  const divisor = unit === "MB" ? 1024 * 1024 : unit === "KB" ? 1024 : 1;
  return `${new Intl.NumberFormat("de-CH", { maximumFractionDigits: 1 }).format(size / divisor)} ${unit}`;
}
