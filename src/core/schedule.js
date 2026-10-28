import { addHours, dateAtTime, toLocalDateInput } from "./date-time.js";
import { toCents } from "./money.js";

export function durationInHours(duration) {
  const hours = Number(duration);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 48) {
    throw new Error("A duração deve ser maior que zero e não pode ultrapassar 48 horas.");
  }
  return hours;
}

export function buildShift({ date, startTime, durationHours, valueCents, origin = "manual", scheduleId = null, notes = "" }) {
  const start = dateAtTime(date, startTime);
  const duration = durationInHours(durationHours);
  const end = addHours(start, duration);
  return {
    id: crypto.randomUUID(),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    date: toLocalDateInput(start),
    durationHours: duration,
    valueCents: Number(valueCents),
    status: "scheduled",
    cancellationPay: false,
    payments: [],
    notes,
    origin,
    scheduleId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function generateWeeklyShifts({ weekdays, startDate, endDate, startTime, durationHours, value }) {
  if (!weekdays.length) throw new Error("Selecione pelo menos um dia da semana.");
  if (!startDate || !endDate || startDate > endDate) throw new Error("Informe um período válido.");
  if ((new Date(`${endDate}T12:00:00`) - new Date(`${startDate}T12:00:00`)) / 864e5 > 3700) throw new Error("O período é grande demais (máximo de 10 anos).");
  const valueCents = toCents(value);
  const result = [];
  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  for (let d = new Date(cursor); d <= end; d.setDate(d.getDate() + 1)) {
    if (weekdays.includes(d.getDay())) {
      result.push(buildShift({
        date: toLocalDateInput(d), startTime, durationHours, valueCents,
        origin: "schedule"
      }));
    }
  }
  return result;
}

export function generateCycleShifts({ cycleStartDate, startDate, endDate, startTime, durationHours, restHours, value }) {
  if (!cycleStartDate || !startDate || !endDate || startDate > endDate) {
    throw new Error("Informe a data inicial do ciclo e um período válido.");
  }
  const duration = durationInHours(durationHours);
  const rest = Number(restHours);
  if (!Number.isFinite(rest) || rest <= 0 || rest > 240) throw new Error("O descanso deve ser maior que zero e até 240 horas.");
  const valueCents = toCents(value);
  const periodStart = dateAtTime(startDate, "00:00");
  const periodEnd = dateAtTime(endDate, "23:59");
  let cursor = dateAtTime(cycleStartDate, startTime);
  const intervalHours = duration + rest;
  const result = [];
  // Backtrack/advance by full cycles to reach the first occurrence that can overlap the requested period.
  while (addHours(cursor, duration) <= periodStart) cursor = addHours(cursor, intervalHours);
  while (cursor > periodStart) {
    const previous = addHours(cursor, -intervalHours);
    if (addHours(previous, duration) <= periodStart) break;
    cursor = previous;
  }
  let guard = 0;
  while (cursor <= periodEnd && guard < 5000) {
    const date = toLocalDateInput(cursor);
    if (cursor >= periodStart && cursor <= periodEnd) {
      result.push(buildShift({ date, startTime: cursor.toTimeString().slice(0, 5), durationHours: duration,
        valueCents, origin: "schedule" }));
    }
    cursor = addHours(cursor, intervalHours);
    guard++;
  }
  if (guard >= 5000) throw new Error("O período é grande demais para gerar essa escala.");
  return result;
}

export function overlaps(a, b) {
  return new Date(a.startAt) < new Date(b.endAt) && new Date(b.startAt) < new Date(a.endAt);
}

export const isActive = shift => shift.status !== "cancelled";

// Plantões cancelados não bloqueiam horário; candidatos também são comparados entre si.
export function detectConflicts(candidates, existing) {
  const active = existing.filter(isActive);
  return candidates.map((candidate, i) => ({
    shift: candidate,
    conflicts: [...active, ...candidates.slice(0, i)].filter(item => overlaps(candidate, item))
  }));
}
