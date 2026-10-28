import { toLocalDateInput } from "./date-time.js";
const pad = n => String(n).padStart(2, "0");
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate();

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
// Feriados nacionais (fixos + Sexta-feira Santa). Feriados estaduais/municipais: ajuste a data manualmente.
export function nationalHolidays(y) {
  const set = new Set([[1,1],[4,21],[5,1],[9,7],[10,12],[11,2],[11,15],[11,20],[12,25]].map(([m, d]) => iso(y, m, d)));
  const goodFriday = easter(y); goodFriday.setDate(goodFriday.getDate() - 2);
  set.add(toLocalDateInput(goodFriday));
  return set;
}
export function nthBusinessDay(year, month, n, saturdayCounts = false) {
  const holidays = nationalHolidays(year);
  let count = 0;
  for (let d = 1; d <= lastDay(year, month); d++) {
    const date = new Date(year, month - 1, d), wd = date.getDay();
    if (wd === 0 || (wd === 6 && !saturdayCounts) || holidays.has(toLocalDateInput(date))) continue;
    if (++count === n) return toLocalDateInput(date);
  }
  return iso(year, month, lastDay(year, month));
}
export function expectedPaymentDate(rule, shiftDate) {
  if (!rule || rule.type === "manual" || !shiftDate) return null;
  const [y, m, d] = shiftDate.split("-").map(Number);
  if (rule.type === "month_days") {
    const days = [...rule.days].sort((a, b) => a - b);
    const next = days.find(x => x > d);
    if (next) return iso(y, m, Math.min(next, lastDay(y, m)));
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return iso(ny, nm, Math.min(days[0], lastDay(ny, nm)));
  }
  const total = m + (rule.monthOffset ?? 1);
  const ty = y + Math.floor((total - 1) / 12), tm = ((total - 1) % 12) + 1;
  if (rule.type === "business_day") return nthBusinessDay(ty, tm, rule.n || 5, !!rule.saturday);
  return iso(ty, tm, lastDay(ty, tm));
}
