export function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error("Informe um valor válido.");
  return Math.round(number * 100);
}

export function formatMoney(cents = 0) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((cents || 0) / 100);
}

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
