import type { WeatherId } from "./types";

export function weatherBackHtml(weather: WeatherId) {
  if (weather === "drizzle") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(118, 34, false, "small")}</svg>`;
  }
  if (weather === "rain") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(56, 34, false, "medium")}</svg>`;
  }
  if (weather === "thunder" || weather === "storm") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(weather === "storm" ? 102 : 104, weather === "storm" ? 32 : 30, true, weather === "storm" ? "wide" : "thunder")}</svg>`;
  }
  return "";
}

export function weatherFrontHtml(weather: WeatherId) {
  if (weather === "clear") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="sun">${sunIcon(34, 34)}</g>
        <g class="spark-a">${tinySpark(36, 108)}${tinySpark(82, 84)}</g>
        <g class="spark-b">${tinySpark(146, 98)}</g>
      </svg>
    `;
  }
  if (weather === "breeze") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="wind-a">${windLine(118, 68, 24)}${windLine(110, 84, 30)}</g>
        <g class="wind-b">${windLine(124, 100, 22)}${leafBit(76, 96)}${leafBit(132, 94)}</g>
      </svg>
    `;
  }
  if (weather === "drizzle") {
    return `<svg class="weather-svg" viewBox="0 0 192 192"><g class="rain-slow">${drop(114, 56)}${drop(134, 68)}${drop(152, 86)}${drop(150, 116)}</g></svg>`;
  }
  if (weather === "rain") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slow">${drop(52, 72)}${drop(74, 66)}${drop(112, 68)}${drop(136, 76)}</g>
        <g class="rain-fast">${drop(48, 102)}${drop(88, 94)}${drop(126, 102)}${drop(148, 116)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
      </svg>
    `;
  }
  if (weather === "thunder") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slow">${drop(52, 72)}${drop(74, 66)}${drop(112, 68)}${drop(136, 76)}</g>
        <g class="rain-fast">${drop(48, 102)}${drop(88, 94)}${drop(126, 102)}${drop(148, 116)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
        <g class="bolt">${boltIcon(132, 58)}</g>
      </svg>
    `;
  }
  if (weather === "storm") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slant">${slantDrop(76, 70)}${slantDrop(100, 66)}${slantDrop(124, 72)}${slantDrop(146, 84)}${slantDrop(154, 104)}</g>
        <g class="wind-a">${windLine(56, 112, 28)}${windLine(52, 128, 22)}</g>
        <g class="wind-b">${windLine(112, 124, 30)}${leafBit(150, 92)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
      </svg>
    `;
  }
  return "";
}

function px(x: number, y: number, w: number, h: number, fill: string) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

function tinySpark(x: number, y: number) {
  return `${px(x, y + 4, 10, 4, "#ffd239")}${px(x + 3, y, 4, 12, "#ffd239")}`;
}

function sunIcon(x: number, y: number) {
  return `
    ${px(x, y, 17, 17, "#ffd239")}
    ${px(x + 5, y - 8, 5, 5, "#ffc928")}
    ${px(x + 5, y + 20, 5, 5, "#ffc928")}
    ${px(x - 8, y + 6, 5, 5, "#ffc928")}
    ${px(x + 20, y + 6, 5, 5, "#ffc928")}
    ${px(x + 4, y + 4, 8, 8, "#fff07a")}
  `;
}

function windLine(x: number, y: number, w: number) {
  return px(x, y, w, 4, "#b9e8f4");
}

function leafBit(x: number, y: number) {
  return px(x, y, 5, 5, "#83b93c");
}

function drop(x: number, y: number) {
  return px(x, y, 4, 14, "#86cbed");
}

function slantDrop(x: number, y: number) {
  return `<rect x="${x}" y="${y}" width="4" height="18" fill="#86cbed" transform="rotate(28 ${x} ${y})"/>`;
}

function puddle(x: number, y: number) {
  return `${px(x, y, 15, 4, "#5dbde7")}${px(x + 3, y - 2, 7, 2, "#9fe4ff")}`;
}

function boltIcon(x: number, y: number) {
  return `
    <polygon points="${x + 10},${y} ${x + 24},${y} ${x + 16},${y + 20} ${x + 26},${y + 20} ${x + 2},${y + 52} ${x + 10},${y + 28} ${x},${y + 28}" fill="#070807"/>
    <polygon points="${x + 12},${y + 4} ${x + 20},${y + 4} ${x + 12},${y + 24} ${x + 22},${y + 24} ${x + 6},${y + 44} ${x + 12},${y + 24} ${x + 4},${y + 24}" fill="#ffc928"/>
    ${px(x + 13, y + 6, 5, 7, "#fff07a")}
  `;
}

function cloud(x: number, y: number, dark: boolean, size: "small" | "medium" | "wide" | "thunder") {
  const main = dark ? "#66707a" : "#aebfca";
  const mid = dark ? "#505860" : "#7f929f";
  const hi = dark ? "#929ba3" : "#dfe9ee";
  const scale = size === "small" ? 0.72 : size === "wide" ? 0.92 : size === "thunder" ? 0.96 : 0.82;
  const sx = (value: number) => Math.round(value * scale);
  return `
    <g class="cloud" transform="translate(${x} ${y})">
      ${px(-sx(4), sx(22), sx(70), sx(18), "#070807")}
      ${px(sx(8), sx(10), sx(48), sx(24), "#070807")}
      ${px(sx(2), sx(24), sx(62), sx(12), main)}
      ${px(sx(14), sx(14), sx(40), sx(18), main)}
      ${px(sx(20), sx(14), sx(15), sx(6), hi)}
      ${px(sx(42), sx(24), sx(16), sx(8), mid)}
      ${px(sx(4), sx(32), sx(18), sx(8), mid)}
    </g>
  `;
}
