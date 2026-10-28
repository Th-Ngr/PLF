import { openDatabase, getAllShifts, putShift, putManyShifts, deleteShift, replaceAllShifts } from "./infrastructure/storage/database.js";
import { generateWeeklyShifts, generateCycleShifts, detectConflicts, buildShift } from "./core/schedule.js";
import { addHours, dateAtTime, formatDate, formatTime, toLocalDateInput, toLocalMonthInput, isSameMonth } from "./core/date-time.js";
import { toCents, formatMoney, sum } from "./core/money.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const APP_VERSION = "0.1.0";
let db;
let shifts = [];
let generationPreview = [];
let previewConflicts = [];
let scheduleMode = "weekly";
let toastTimer;

const today = toLocalDateInput(new Date());
const month = toLocalMonthInput(new Date());
$("#periodStart").value = today;
$("#periodEnd").value = `${month}-${String(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
$("#cycleStartDate").value = today;
$("#listStart").value = `${month}-01`;
$("#listEnd").value = $("#periodEnd").value;
$("#financeMonth").value = month;
$("#paymentDate").value = today;
$("#appVersion").textContent = `v${APP_VERSION}`;

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function getShiftStart(shift) { return new Date(shift.startAt); }
function getShiftEnd(shift) { return new Date(shift.endAt); }
function getPaidCents(shift) { return sum((shift.payments || []).map(payment => payment.amountCents)); }
function isPayable(shift) { return shift.status === "completed" || (shift.status === "cancelled" && shift.cancellationPay); }
function remainingCents(shift) { return Math.max(0, shift.valueCents - getPaidCents(shift)); }
function sortShifts(list) { return [...list].sort((a, b) => a.startAt.localeCompare(b.startAt)); }
async function refreshData() {
  shifts = sortShifts(await getAllShifts(db));
  renderAll();
}
function statusLabel(status) {
  return ({ scheduled: "Programado", completed: "Realizado", cancelled: "Cancelado" })[status] || status;
}
function getDurationHours() {
  const choice = $('input[name="duration"]:checked')?.value || "12";
  return choice === "custom" ? Number($("#customDuration").value) : Number(choice);
}
function selectedWeekdays() {
  return $$("#weekdayPicker input:checked").map(input => Number(input.value));
}
function formatShiftRange(shift) {
  return `${formatDate(shift.date)} · ${formatTime(getShiftStart(shift))}–${formatDate(toLocalDateInput(getShiftEnd(shift)))} ${formatTime(getShiftEnd(shift))}`;
}
function shiftInDateRange(shift, start, end) {
  return (!start || shift.date >= start) && (!end || shift.date <= end);
}
function renderSummary() {
  const active = shifts.filter(shift => shift.status !== "cancelled");
  $("#summaryShifts").textContent = active.length;
  $("#summaryHours").textContent = `${sum(active.map(shift => shift.durationHours))} h`;
  $("#summaryExpected").textContent = formatMoney(sum(active.map(shift => shift.valueCents)));
  $("#summaryPending").textContent = formatMoney(sum(shifts.filter(isPayable).map(remainingCents)));
}
function renderShiftCard(shift, finance = false) {
  const start = getShiftStart(shift);
  const end = getShiftEnd(shift);
  const paid = getPaidCents(shift);
  const payable = isPayable(shift);
  const pending = remainingCents(shift);
  return `<article class="shift-card">
    <div class="shift-main"><strong>${escapeHtml(formatDate(shift.date))} · ${escapeHtml(formatTime(start))}–${escapeHtml(formatTime(end))}</strong>
      <small>${Number(shift.durationHours)} h · ${escapeHtml(shift.origin === "schedule" ? "Gerado por escala" : "Cadastro manual")}${shift.notes ? ` · ${escapeHtml(shift.notes)}` : ""}</small>
      <span class="status ${shift.status}">${statusLabel(shift.status)}</span>
    </div>
    <div class="shift-meta"><span>Valor do plantão</span><strong>${formatMoney(shift.valueCents)}</strong></div>
    <div class="shift-meta"><span>${finance ? "Recebido / pendente" : "Pagamento registrado"}</span><strong>${formatMoney(paid)}${finance ? ` / ${formatMoney(payable ? pending : 0)}` : ""}</strong></div>
    <div class="card-actions">
      ${finance ? `<button class="small-button" data-action="payment" data-id="${shift.id}">Registrar pagamento</button>` : ""}
      <button class="small-button" data-action="edit" data-id="${shift.id}">Editar</button>
    </div>
  </article>`;
}
function renderShiftList() {
  const start = $("#listStart").value;
  const end = $("#listEnd").value;
  const status = $("#statusFilter").value;
  const filtered = shifts.filter(shift => shiftInDateRange(shift, start, end) && (status === "all" || shift.status === status));
  $("#shiftList").innerHTML = filtered.map(shift => renderShiftCard(shift)).join("");
  $("#emptyShifts").classList.toggle("visible", filtered.length === 0);
}
function renderFinance() {
  const selectedMonth = $("#financeMonth").value || toLocalMonthInput(new Date());
  const inMonth = shifts.filter(shift => isSameMonth(shift.date, selectedMonth));
  const expected = sum(inMonth.filter(shift => shift.status !== "cancelled").map(shift => shift.valueCents));
  const earned = sum(inMonth.filter(isPayable).map(shift => shift.valueCents));
  const receivedThisMonth = sum(shifts.flatMap(shift => (shift.payments || []).filter(payment => isSameMonth(payment.date, selectedMonth)).map(payment => payment.amountCents)));
  const pending = sum(inMonth.filter(isPayable).map(remainingCents));
  $("#financeExpected").textContent = formatMoney(expected);
  $("#financeEarned").textContent = formatMoney(earned);
  $("#financeReceived").textContent = formatMoney(receivedThisMonth);
  $("#financePending").textContent = formatMoney(pending);
  $("#financeList").innerHTML = sortShifts(inMonth.filter(isPayable)).map(shift => renderShiftCard(shift, true)).join("");
}
function renderAll() {
  renderSummary();
  renderShiftList();
  renderFinance();
}
function setTab(tabName) {
  $$(".tab").forEach(button => button.classList.toggle("active", button.dataset.tab === tabName));
  $$(".panel").forEach(panel => panel.classList.toggle("active", panel.id === `panel-${tabName}`));
}
$$(".tab").forEach(button => button.addEventListener("click", () => setTab(button.dataset.tab)));

$$(".mode-button").forEach(button => button.addEventListener("click", () => {
  scheduleMode = button.dataset.mode;
  $$(".mode-button").forEach(item => item.classList.toggle("active", item === button));
  $("#weeklyFields").classList.toggle("hidden", scheduleMode !== "weekly");
  $("#cycleFields").classList.toggle("hidden", scheduleMode !== "cycle");
}));
$("#cyclePreset").addEventListener("change", () => {
  $("#customCycleFields").classList.toggle("hidden", $("#cyclePreset").value !== "custom");
});
$$('input[name="duration"]').forEach(input => input.addEventListener("change", () => {
  $("#customDurationField").classList.toggle("hidden", $('input[name="duration"]:checked')?.value !== "custom");
}));
$("#clearScheduleForm").addEventListener("click", () => {
  $$("#weekdayPicker input").forEach(input => input.checked = false);
  toast("Seleção de dias limpa.");
});

$("#scheduleForm").addEventListener("submit", event => {
  event.preventDefault();
  try {
    const common = {
      startDate: $("#periodStart").value,
      endDate: $("#periodEnd").value,
      startTime: $("#startTime").value,
      durationHours: getDurationHours(),
      value: $("#defaultValue").value
    };
    if (common.startDate > common.endDate) throw new Error("A data inicial precisa ser anterior ou igual à data final.");
    if (!common.startTime) throw new Error("Informe o horário de início.");
    if (scheduleMode === "weekly") {
      generationPreview = generateWeeklyShifts({ ...common, weekdays: selectedWeekdays() });
    } else {
      const preset = $("#cyclePreset").value;
      let workHours = common.durationHours;
      let restHours = preset === "12x36" ? 36 : preset === "12x48" ? 48 : Number($("#customRestHours").value);
      if (preset === "custom") workHours = Number($("#customWorkHours").value);
      if (workHours !== common.durationHours) common.durationHours = workHours;
      generationPreview = generateCycleShifts({
        ...common,
        cycleStartDate: $("#cycleStartDate").value,
        restHours
      });
    }
    if (!generationPreview.length) throw new Error("Nenhum plantão foi gerado nesse período. Confira os dias e as datas.");
    previewConflicts = detectConflicts(generationPreview, shifts);
    renderPreview();
  } catch (error) {
    toast(error.message || "Não foi possível gerar a escala.");
  }
});

function renderPreview() {
  $("#previewWrap").classList.remove("hidden");
  const conflictCount = previewConflicts.filter(item => item.conflicts.length).length;
  $("#previewCount").textContent = `${generationPreview.length} plantões`;
  $("#previewMessage").textContent = conflictCount
    ? `${conflictCount} plantão(ões) conflitam com registros existentes. Esses itens serão ignorados ao salvar; revise a lista.`
    : "Revise as datas, os horários e os valores antes de salvar.";
  $("#previewBody").innerHTML = previewConflicts.map(({ shift, conflicts }) => {
    const start = getShiftStart(shift);
    const end = getShiftEnd(shift);
    return `<tr><td>${formatDate(shift.date)}</td><td>${formatTime(start)}</td><td>${formatDate(toLocalDateInput(end))} ${formatTime(end)}</td><td>${shift.durationHours} h</td><td>${formatMoney(shift.valueCents)}</td><td class="${conflicts.length ? "conflict" : "ok"}">${conflicts.length ? `${conflicts.length} conflito(s)` : "Livre"}</td></tr>`;
  }).join("");
  $("#previewWrap").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#confirmGenerate").addEventListener("click", async () => {
  try {
    const accepted = previewConflicts.filter(item => !item.conflicts.length).map(item => item.shift);
    if (!accepted.length) throw new Error("Todos os plantões da prévia conflitam com registros existentes.");
    await putManyShifts(db, accepted);
    $("#previewWrap").classList.add("hidden");
    generationPreview = [];
    previewConflicts = [];
    await refreshData();
    toast(`${accepted.length} plantão(ões) salvo(s).`);
    setTab("calendario");
  } catch (error) { toast(error.message || "Erro ao salvar escala."); }
});
$("#cancelPreview").addEventListener("click", () => $("#previewWrap").classList.add("hidden"));

function openShiftDialog(shift = null) {
  $("#shiftForm").reset();
  $("#shiftId").value = shift?.id || "";
  $("#shiftDialogTitle").textContent = shift ? "Editar plantão" : "Novo plantão";
  $("#shiftDate").value = shift?.date || today;
  $("#shiftStart").value = shift ? getShiftStart(shift).toTimeString().slice(0, 5) : "07:00";
  $("#shiftDuration").value = shift?.durationHours ?? 12;
  $("#shiftValue").value = ((shift?.valueCents ?? 30000) / 100).toFixed(2);
  $("#shiftStatus").value = shift?.status || "scheduled";
  $("#cancelPay").value = shift?.cancellationPay ? "yes" : "no";
  $("#shiftNotes").value = shift?.notes || "";
  $("#deleteShift").classList.toggle("hidden", !shift);
  $("#cancelPayWrap").classList.toggle("hidden", $("#shiftStatus").value !== "cancelled");
  $("#shiftDialog").showModal();
}
$("#newShiftBtn").addEventListener("click", () => openShiftDialog());
$$("[data-action='edit']").forEach(() => {});
document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const shift = shifts.find(item => item.id === button.dataset.id);
  if (!shift) return;
  if (button.dataset.action === "edit") openShiftDialog(shift);
  if (button.dataset.action === "payment") openPaymentDialog(shift);
});
$("#shiftStatus").addEventListener("change", () => $("#cancelPayWrap").classList.toggle("hidden", $("#shiftStatus").value !== "cancelled"));
$("#closeShiftDialog").addEventListener("click", () => $("#shiftDialog").close());
$("#cancelShiftEdit").addEventListener("click", () => $("#shiftDialog").close());
$("#shiftForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const id = $("#shiftId").value;
    const durationHours = Number($("#shiftDuration").value);
    const valueCents = toCents($("#shiftValue").value);
    const start = dateAtTime($("#shiftDate").value, $("#shiftStart").value);
    const end = addHours(start, durationHours);
    if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 48) throw new Error("A duração deve ser maior que zero e até 48 horas.");
    const existing = id ? shifts.find(item => item.id === id) : null;
    const shift = {
      ...(existing || {
        id: crypto.randomUUID(), payments: [], origin: "manual", scheduleId: null,
        createdAt: new Date().toISOString(), cancellationPay: false
      }),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      date: toLocalDateInput(start),
      durationHours,
      valueCents,
      status: $("#shiftStatus").value,
      cancellationPay: $("#shiftStatus").value === "cancelled" && $("#cancelPay").value === "yes",
      notes: $("#shiftNotes").value.trim(),
      updatedAt: new Date().toISOString()
    };
    if (existing) {
      const conflicts = shifts.filter(item => item.id !== existing.id && new Date(shift.startAt) < new Date(item.endAt) && new Date(item.startAt) < new Date(shift.endAt));
      if (conflicts.length && !confirm(`Este plantão se sobrepõe a ${conflicts.length} registro(s). Deseja salvar mesmo assim?`)) return;
    } else {
      const conflicts = shifts.filter(item => new Date(shift.startAt) < new Date(item.endAt) && new Date(item.startAt) < new Date(shift.endAt));
      if (conflicts.length && !confirm(`Este plantão se sobrepõe a ${conflicts.length} registro(s). Deseja salvar mesmo assim?`)) return;
    }
    await putShift(db, shift);
    $("#shiftDialog").close();
    await refreshData();
    toast("Plantão salvo.");
  } catch (error) { toast(error.message || "Não foi possível salvar."); }
});
$("#deleteShift").addEventListener("click", async () => {
  const id = $("#shiftId").value;
  if (!id || !confirm("Excluir este plantão e seus registros de pagamento? Esta ação não pode ser desfeita.")) return;
  await deleteShift(db, id);
  $("#shiftDialog").close();
  await refreshData();
  toast("Plantão excluído.");
});

function openPaymentDialog(shift) {
  if (!isPayable(shift)) {
    toast("Marque o plantão como realizado antes de registrar o recebimento.");
    return;
  }
  $("#paymentShiftId").value = shift.id;
  $("#paymentContext").textContent = `Valor: ${formatMoney(shift.valueCents)} · Recebido: ${formatMoney(getPaidCents(shift))} · Pendente: ${formatMoney(remainingCents(shift))}`;
  $("#paymentAmount").value = (remainingCents(shift) / 100).toFixed(2);
  $("#paymentAmount").max = (remainingCents(shift) / 100).toFixed(2);
  $("#paymentDate").value = today;
  $("#paymentNotes").value = "";
  $("#paymentHistory").innerHTML = (shift.payments || []).map(payment =>
    `<div class="payment-item"><span>${formatDate(payment.date)}${payment.notes ? ` · ${escapeHtml(payment.notes)}` : ""}</span><strong>${formatMoney(payment.amountCents)}</strong></div>`
  ).join("");
  $("#paymentDialog").showModal();
}
$("#closePaymentDialog").addEventListener("click", () => $("#paymentDialog").close());
$("#cancelPayment").addEventListener("click", () => $("#paymentDialog").close());
$("#paymentForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const shift = shifts.find(item => item.id === $("#paymentShiftId").value);
    if (!shift) throw new Error("Plantão não encontrado.");
    const amountCents = toCents($("#paymentAmount").value);
    const outstanding = remainingCents(shift);
    if (amountCents <= 0) throw new Error("O pagamento precisa ser maior que zero.");
    if (amountCents > outstanding) throw new Error("O valor recebido não pode ultrapassar o saldo pendente deste plantão.");
    const date = $("#paymentDate").value;
    if (!date) throw new Error("Informe a data do recebimento.");
    shift.payments = [...(shift.payments || []), {
      id: crypto.randomUUID(), amountCents, date,
      notes: $("#paymentNotes").value.trim(), createdAt: new Date().toISOString()
    }];
    shift.updatedAt = new Date().toISOString();
    await putShift(db, shift);
    $("#paymentDialog").close();
    await refreshData();
    toast("Recebimento registrado.");
  } catch (error) { toast(error.message || "Não foi possível registrar o pagamento."); }
});

$("#listStart").addEventListener("change", renderShiftList);
$("#listEnd").addEventListener("change", renderShiftList);
$("#statusFilter").addEventListener("change", renderShiftList);
$("#financeMonth").addEventListener("change", renderFinance);

$("#exportBackup").addEventListener("click", () => {
  const payload = {
    app: "Plantão Fácil",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    shifts
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `plantao-facil-backup-${today}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Backup exportado.");
});
$("#importBackup").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.app !== "Plantão Fácil" || payload.schemaVersion !== 1 || !Array.isArray(payload.shifts)) {
      throw new Error("O arquivo não parece ser um backup válido do Plantão Fácil.");
    }
    const valid = payload.shifts.every(shift =>
      shift && typeof shift.id === "string" && typeof shift.startAt === "string" &&
      typeof shift.endAt === "string" && Number.isFinite(shift.valueCents) &&
      ["scheduled", "completed", "cancelled"].includes(shift.status) &&
      Array.isArray(shift.payments)
    );
    if (!valid) throw new Error("O backup contém registros inválidos.");
    if (!confirm(`O backup contém ${payload.shifts.length} plantão(ões). Restaurar substituirá os dados atuais. Faça backup antes. Continuar?`)) return;
    await replaceAllShifts(db, payload.shifts);
    await refreshData();
    toast("Backup restaurado.");
  } catch (error) { toast(error.message || "Não foi possível restaurar o backup."); }
  finally { event.target.value = ""; }
});

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("#installBtn").classList.remove("hidden");
});
$("#installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("#installBtn").classList.add("hidden");
});
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

async function init() {
  try {
    db = await openDatabase();
    await refreshData();
  } catch (error) {
    toast(error.message || "Erro ao iniciar o aplicativo.");
    console.error(error);
  }
}
init();
