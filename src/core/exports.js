const icsDate = isoString => isoString.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = s => String(s).replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
export function buildIcs(shifts) {
  const stamp = icsDate(new Date().toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Plantao Facil//PT-BR", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Plantões"];
  for (const s of shifts) {
    lines.push("BEGIN:VEVENT", `UID:${s.id}@plantao-facil`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(s.startAt)}`, `DTEND:${icsDate(s.endAt)}`,
      `SUMMARY:${icsText(s.name ? `Plantão — ${s.name}` : "Plantão")}`);
    if (s.notes) lines.push(`DESCRIPTION:${icsText(s.notes)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
export const csvMoney = cents => ((cents || 0) / 100).toFixed(2).replace(".", ",");
// Separador ";" + BOM: abre direto no Excel em português.
export function buildCsv(header, rows) {
  return "\ufeff" + [header, ...rows].map(r => r.map(cell).join(";")).join("\r\n");
}
export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
