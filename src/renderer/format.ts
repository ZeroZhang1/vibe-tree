import type { TotalDisplayUnit } from "./types";

export function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(Math.round(value));
}

export function formatByUnit(value: number, unit: TotalDisplayUnit, locale: string) {
  const safeValue = Math.max(0, value);
  if (unit === "raw") return formatIntegerWithCommas(safeValue);
  if (unit === "wan") return `${formatScaledUnit(safeValue, 10_000, locale)}万`;
  if (unit === "yi") return `${formatScaledUnit(safeValue, 100_000_000, locale)}亿`;
  const divisor = unit === "m" ? 1_000_000 : 1_000;
  return `${formatIntegerWithCommas(Math.round(safeValue / divisor))}${unit}`;
}

export function formatIntegerWithCommas(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function formatCompact(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute < 1_000) return `${Math.round(value)}`;

  const units = [
    { value: 1_000_000_000, suffix: "b" },
    { value: 1_000_000, suffix: "m" },
    { value: 1_000, suffix: "k" },
  ];
  const unit = units.find((item) => absolute >= item.value);
  if (!unit) return `${Math.round(value)}`;

  const scaled = absolute / unit.value;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const formatted = scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
  return `${sign}${formatted}${unit.suffix}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatScaledUnit(value: number, divisor: number, locale: string) {
  const scaled = value / divisor;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(scaled);
}
