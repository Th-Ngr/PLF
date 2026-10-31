import { openDatabase, getAllShifts, putShift, putManyShifts, deleteShift, replaceAllShifts } from "./infrastructure/storage/database.js";
import { generateWeeklyShifts, generateCycleShifts, detectConflicts, overlaps, isActive } from "./core/schedule.js";
import { addHours, dateAtTime, formatDate, formatTime, toLocalDateInput, toLocalMonthInput, isSameMonth } from "./core/date-time.js";
import { toCents, formatMoney, sum } from "./core/money.js";
import { expectedPaymentDate } from "./core/payment-rules.js";
import { buildIcs, buildCsv, csvMoney, download } from "./core/exports.js";


const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const APP_VERSION = "0.2.0";
let db;
let shifts = [];
let generationPreview = [];
let previewConflicts = [];
let scheduleMode = "weekly";
let toastTimer;

let today = toLocalDateInput(new Date());
const month = toLocalMonthInput(new Date());
$("#periodStart").value = today;
$("#periodEnd").value = `${month}-${String(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
$("#cycleStartDate").value = today;
$("#listStart").value = `${month}-01`;
$("#listEnd").value = $("#periodEnd").value;
$("#financeMonth").value = month;
$("#paymentDate").value = today;
$("#appVersion").textContent = `v${APP_VERSION}`;

// 1. Registra o Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(err => {
      console.error("Erro ao registrar Service Worker:", err);
    });
  });
}
// ---- Instalação do PWA ----
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();              // impede o mini-aviso automático do navegador
  deferredInstallPrompt = event;       // guarda o evento para usar no clique
  $("#installBtn").classList.remove("hidden");
});

$("#installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();                  // abre a janela de instalação
  await deferredInstallPrompt.userChoice;          // espera o usuário aceitar ou recusar
  deferredInstallPrompt = null;
  $("#installBtn").classList.add("hidden");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  $("#installBtn").classList.add("hidden");
  toast("Aplicativo instalado.");
});




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
  today = toLocalDateInput(new Date());
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
const norm = text => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const matchesQuery = (shift, query) => !query || norm(`${shift.name || ""} ${shift.notes || ""}`).includes(norm(query.trim()));
const isOverdue = shift => isPayable(shift) && remainingCents(shift) > 0 && shift.expectedPaymentDate && shift.expectedPaymentDate < today;
function renderSummary() {
  const range = shifts.filter(shift => shiftInDateRange(shift, $("#listStart").value, $("#listEnd").value));
  const active = range.filter(isActive);
  $("#summaryShifts").textContent = active.length;
  $("#summaryHours").textContent = `${sum(active.map(shift => shift.durationHours))} h`;
  $("#summaryExpected").textContent = formatMoney(sum(active.map(shift => shift.valueCents)));
  $("#summaryPending").textContent = formatMoney(sum(range.filter(isPayable).map(remainingCents)));
}
function renderShiftCard(shift, finance = false) {
  const start = getShiftStart(shift), end = getShiftEnd(shift), paid = getPaidCents(shift), payable = isPayable(shift);
  const id = escapeHtml(shift.id);
  const title = shift.name ? `${escapeHtml(shift.name)} · ` : "";
  const pay = shift.expectedPaymentDate ? ` · Recebimento: ${escapeHtml(formatDate(shift.expectedPaymentDate))}${isOverdue(shift) ? " (atrasado)" : ""}` : "";
  return `<article class="shift-card">
    <div class="shift-main"><strong>${title}${escapeHtml(formatDate(shift.date))} · ${escapeHtml(formatTime(start))}–${escapeHtml(formatTime(end))}</strong>
      <small>${Number(shift.durationHours)} h · ${shift.origin === "schedule" ? "Gerado por escala" : "Cadastro manual"}${pay}${shift.notes ? ` · ${escapeHtml(shift.notes)}` : ""}</small>
      <span class="status ${escapeHtml(shift.status)}">${statusLabel(shift.status)}</span>
    </div>
    <div class="shift-meta"><span>Valor do plantão</span><strong>${formatMoney(shift.valueCents)}</strong></div>
    <div class="shift-meta"><span>${finance ? "Recebido / pendente" : "Pagamento registrado"}</span><strong>${formatMoney(paid)}${finance ? ` / ${formatMoney(payable ? remainingCents(shift) : 0)}` : ""}</strong></div>
    <div class="card-actions">
      ${!finance && shift.status === "scheduled" ? `<button class="small-button" data-action="complete" data-id="${id}"> Marcar como realizado</button>` : ""}  
      ${payable ? `<button class="small-button" data-action="payment" data-id="${id}">Registrar pagamento</button>` : ""}
      <button class="small-button2" data-action="edit" data-id="${id}">Editar</button>
    </div>
  </article>`;
}
function renderShiftList() {
  const start = $("#listStart").value, end = $("#listEnd").value, status = $("#statusFilter").value, query = $("#searchShifts").value;
  const filtered = shifts.filter(shift => shiftInDateRange(shift, start, end) && (status === "all" || shift.status === status) && matchesQuery(shift, query));
  $("#shiftList").innerHTML = filtered.map(shift => renderShiftCard(shift)).join("");
  $("#emptyShifts").classList.toggle("visible", filtered.length === 0);
}

function renderPrintableCalendar(monthValue) {
  const container = $("#printCalendar");

  if (!monthValue) {
    toast("Selecione uma data inicial para definir o mês do calendário.");
    return false;
  }

  const [year, monthNumber] = monthValue.split("-").map(Number);

  // Primeiro e último dia do mês selecionado.
  const firstDay = new Date(year, monthNumber - 1, 1);
  const lastDay = new Date(year, monthNumber, 0);

  // O calendário começa na segunda-feira.
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((mondayOffset + lastDay.getDate()) / 7) * 7;

  // Inclui somente plantões programados ou realizados.
  // Cancelados não entram no calendário.
  const monthShifts = sortShifts(
    shifts.filter(shift =>
      shift.date?.startsWith(monthValue) &&
      (shift.status === "scheduled" || shift.status === "completed")
    )
  );

  if (monthShifts.length === 0) {
    toast("Não há plantões programados ou realizados neste mês.");
    return false;
  }

  const shiftsByDate = new Map();

  for (const shift of monthShifts) {
    if (!shiftsByDate.has(shift.date)) {
      shiftsByDate.set(shift.date, []);
    }

    shiftsByDate.get(shift.date).push(shift);
  }

  const monthTitle = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric"
  }).format(firstDay);

  const weekdays = [
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado",
    "Domingo"
  ];

  const weekdayHeaders = weekdays
    .map(day => `<div class="calendar-weekday">${day}</div>`)
    .join("");

  const cells = [];

  for (let index = 0; index < totalCells; index++) {
    const dayNumber = index - mondayOffset + 1;
    const isCurrentMonth =
      dayNumber >= 1 && dayNumber <= lastDay.getDate();

    if (!isCurrentMonth) {
      cells.push(`
        <div class="calendar-day calendar-day-empty"></div>
      `);
      continue;
    }

    const date = [
      year,
      String(monthNumber).padStart(2, "0"),
      String(dayNumber).padStart(2, "0")
    ].join("-");

    const dayShifts = shiftsByDate.get(date) || [];

    const shiftItems = dayShifts.map(shift => {
      const start = getShiftStart(shift);
      const end = getShiftEnd(shift);

      const startTime = escapeHtml(formatTime(start));
      const endTime = escapeHtml(formatTime(end));
      const name = escapeHtml(shift.name || "Plantão");

      // Observações podem ajudar a identificar o local ou contexto.
      const notes = shift.notes
        ? `<small class="calendar-shift-notes">${escapeHtml(shift.notes)}</small>`
        : "";

      return `
        <div class="calendar-shift">
          <strong>${startTime}–${endTime}</strong>
          <span>${name}</span>
          ${notes}
        </div>
      `;
    }).join("");

    cells.push(`
      <div class="calendar-day">
        <span class="calendar-day-number">${dayNumber}</span>
        <div class="calendar-day-shifts">
          ${shiftItems || ""}
        </div>
      </div>
    `);
  }

  container.innerHTML = `
    <header class="calendar-print-header">
      <h1>Plantão Fácil</h1>
      <h2>Calendário de ${escapeHtml(monthTitle)}</h2>
    </header>

    <div class="calendar-grid">
      ${weekdayHeaders}
      ${cells.join("")}
    </div>

    <footer class="calendar-print-footer">
      Calendário mensal de plantões · Plantão Fácil
    </footer>
  `;

  return true;
}


function financeData() {
  const monthValue = $("#financeMonth").value || toLocalMonthInput(new Date());
  const byPayment = $("#financeRef").value === "payment";
  const query = $("#financeSearch").value;
  const scoped = shifts.filter(shift => (byPayment ? isSameMonth(shift.expectedPaymentDate, monthValue) : isSameMonth(shift.date, monthValue)) && matchesQuery(shift, query));
  const payments = shifts.filter(shift => matchesQuery(shift, query)).flatMap(shift =>
    (shift.payments || []).filter(payment => isSameMonth(payment.date, monthValue)).map(payment => ({ ...payment, shift })));
  return {
    monthValue, scoped, payments,
    rows: scoped.filter(shift => isActive(shift) || isPayable(shift) || getPaidCents(shift) > 0),
    totals: {
      expected: sum(scoped.filter(isActive).map(shift => shift.valueCents)),
      earned: sum(scoped.filter(isPayable).map(shift => shift.valueCents)),
      received: sum(payments.map(payment => payment.amountCents)),
      pending: sum(scoped.filter(isPayable).map(remainingCents))
    }
  };
}
function renderFinance() {
  const { scoped, totals } = financeData();
  $("#financeExpected").textContent = formatMoney(totals.expected);
  $("#financeEarned").textContent = formatMoney(totals.earned);
  $("#financeReceived").textContent = formatMoney(totals.received);
  $("#financePending").textContent = formatMoney(totals.pending);
  // Plantões que já têm pagamentos continuam visíveis mesmo se a situação mudou.
  $("#financeList").innerHTML = sortShifts(scoped.filter(shift => isPayable(shift) || getPaidCents(shift) > 0)).map(shift => renderShiftCard(shift, true)).join("");
}
function renderAll() {
  $("#nameList").innerHTML = [...new Set(shifts.map(shift => shift.name).filter(Boolean))].map(name => `<option value="${escapeHtml(name)}">`).join("");
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
      let workHours = 12; // 12x36 e 12x48 sempre usam 12 h de trabalho
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
    const rule = readRule(), scheduleName = $("#scheduleName").value.trim();
    generationPreview.forEach(shift => { shift.name = scheduleName; shift.paymentRule = rule; shift.expectedPaymentDate = expectedPaymentDate(rule, shift.date); });
    saveRule(rule);
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
    const savedDates = accepted.map(shift => shift.date).sort();
    if (!$("#listStart").value || savedDates[0] < $("#listStart").value) $("#listStart").value = savedDates[0];
    if (!$("#listEnd").value || savedDates.at(-1) > $("#listEnd").value) $("#listEnd").value = savedDates.at(-1);
    await refreshData();
    toast(`${accepted.length} plantão(ões) salvo(s).`);
    setTab("calendario");
  } catch (error) { toast(error.message || "Erro ao salvar escala."); }
});
$("#cancelPreview").addEventListener("click", () => $("#previewWrap").classList.add("hidden"));

let payTouched = false;
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
  $("#shiftName").value = shift?.name || "";
  $("#shiftPayDate").value = shift ? (shift.expectedPaymentDate || "") : (expectedPaymentDate(loadRule(), $("#shiftDate").value) || "");
  payTouched = !!shift;
  $("#deleteShift").classList.toggle("hidden", !shift);
  $("#cancelPayWrap").classList.toggle("hidden", $("#shiftStatus").value !== "cancelled");
  $("#shiftDialog").showModal();
}
$("#newShiftBtn").addEventListener("click", () => openShiftDialog());
document.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const shift = shifts.find(item => item.id === button.dataset.id);
  if (!shift) return;

  if (button.dataset.action === "edit") {
    openShiftDialog(shift);
    return;
  }

  if (button.dataset.action === "payment") {
    openPaymentDialog(shift);
    return;
  }

  if (button.dataset.action !== "complete") return;

  // Só permite marcar plantões programados.
  if (shift.status !== "scheduled") return;

  // Atualiza a data atual antes de verificar se o plantão é futuro.
  today = toLocalDateInput(new Date());

  // Plantões futuros exigem confirmação.
  if (shift.date > today) {
    const confirmed = confirm(
      "Este plantão está programado para uma data futura. " +
      "Tem certeza de que deseja marcá-lo como realizado?"
    );

    if (!confirmed) return;
  }

  button.disabled = true;

  try {
    const completedShift = {
      ...shift,
      status: "completed",
      updatedAt: new Date().toISOString()
    };

    await putShift(db, completedShift);
    await refreshData();

    toast("Plantão marcado como realizado.");
  } catch (error) {
    button.disabled = false;

    toast(
      error.message ||
      "Não foi possível marcar o plantão como realizado."
    );
  }
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
      name: $("#shiftName").value.trim(),
      expectedPaymentDate: $("#shiftPayDate").value || null,
      notes: $("#shiftNotes").value.trim(),
      updatedAt: new Date().toISOString()
    };
    const conflicts = shift.status === "cancelled" ? [] : shifts.filter(item => item.id !== shift.id && isActive(item) && overlaps(shift, item));
    if (conflicts.length && !confirm(`Este plantão se sobrepõe a ${conflicts.length} registro(s). Deseja salvar mesmo assim?`)) return;
    if (existing?.payments?.length && (!isPayable(shift) || shift.valueCents < getPaidCents(existing)) &&
      !confirm("Este plantão já tem pagamentos registrados e a nova situação ou o novo valor deixa o saldo inconsistente. Salvar mesmo assim?")) return;
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
    await putShift(db, { ...shift, updatedAt: new Date().toISOString(), payments: [...(shift.payments || []), {
      id: crypto.randomUUID(), amountCents, date,
      notes: $("#paymentNotes").value.trim(), createdAt: new Date().toISOString()
    }] });
    $("#paymentDialog").close();
    await refreshData();
    toast("Recebimento registrado.");
  } catch (error) { toast(error.message || "Não foi possível registrar o pagamento."); }
});

const refreshList = () => { renderSummary(); renderShiftList(); };
$("#listStart").addEventListener("change", refreshList);
$("#listEnd").addEventListener("change", refreshList);
$("#searchShifts").addEventListener("input", renderShiftList);
$("#financeRef").addEventListener("change", renderFinance);
$("#financeSearch").addEventListener("input", renderFinance);
$("#shiftDate").addEventListener("change", () => { if (!payTouched) $("#shiftPayDate").value = expectedPaymentDate(loadRule(), $("#shiftDate").value) || ""; });
$("#shiftPayDate").addEventListener("input", () => { payTouched = true; });
$("#statusFilter").addEventListener("change", renderShiftList);
$("#printCalendarBtn").addEventListener("click", () => {
  const startDate = $("#listStart").value;

  if (!startDate) {
    toast("Preencha a data inicial do filtro De.");
    return;
  }

  const monthValue = startDate.slice(0, 7);

  if (!renderPrintableCalendar(monthValue)) {
    return;
  }

  document.body.classList.add("print-calendar-mode");

  const cleanup = () => {
    document.body.classList.remove("print-calendar-mode");
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);

  window.print();
});
$("#financeMonth").addEventListener("change", renderFinance);

$("#exportBackup").addEventListener("click", () => {
  const payload = {
    app: "Plantão Fácil",
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    shifts
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `plantao-facil-backup-${toLocalDateInput(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Backup exportado.");
});
$("#importBackup").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.app !== "Plantão Fácil" || ![1, 2].includes(payload.schemaVersion) || !Array.isArray(payload.shifts)) {
      throw new Error("O arquivo não parece ser um backup válido do Plantão Fácil.");
    }
    const valid = payload.shifts.every(shift =>
      shift && typeof shift.id === "string" && typeof shift.startAt === "string" &&
      typeof shift.endAt === "string" && Number.isFinite(shift.valueCents) &&
      ["scheduled", "completed", "cancelled"].includes(shift.status) &&
      typeof shift.date === "string" && Number.isFinite(shift.durationHours) &&
      Array.isArray(shift.payments) && shift.payments.every(p => p && Number.isFinite(p.amountCents) && typeof p.date === "string")
    );
    if (!valid) throw new Error("O backup contém registros inválidos.");
    if (!confirm(`O backup contém ${payload.shifts.length} plantão(ões). Restaurar substituirá os dados atuais. Faça backup antes. Continuar?`)) return;
    await replaceAllShifts(db, payload.shifts);
    await refreshData();
    toast("Backup restaurado.");
  } catch (error) { toast(error.message || "Não foi possível restaurar o backup."); }
  finally { event.target.value = ""; }
});


// ---- Tema com Efeito de Círculo Expandindo ----
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const metaColor = document.querySelector('meta[name="theme-color"]');
  if (metaColor) {
    metaColor.content = theme === "dark" ? "#0f1a15" : "#14251f";
  }
}

// Inicializa o tema salvo ou padrão
const savedTheme = document.documentElement.dataset.theme || localStorage.getItem("pf-theme") || "light";
applyTheme(savedTheme);

$("#themeBtn").addEventListener("click", event => {
  const currentTheme = document.documentElement.dataset.theme || "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";

  if (!document.startViewTransition) {
    applyTheme(nextTheme);
    try { localStorage.setItem("pf-theme", nextTheme); } catch {}
    return;
  }

  const button = event.target.closest('button') || event.target;
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  // Inicia a transição
  const transition = document.startViewTransition(() => {
    applyTheme(nextTheme);
    try { localStorage.setItem("pf-theme", nextTheme); } catch {}
  });

  transition.ready.then(() => {
    // Força o navegador a renderizar o frame zero do círculo sem atraso de tick
    document.documentElement.animate(
      [
        { clipPath: `circle(0px at ${x}px ${y}px)` },
        { clipPath: `circle(${endRadius}px at ${x}px ${y}px)` }
      ],
      {
        duration: 450,
        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
        pseudoElement: '::view-transition-new(root)'
      }
    );
  });
});

// ---- Forma de pagamento ----
const RULE_KEY = "pf-rule";
function loadRule() { try { return JSON.parse(localStorage.getItem(RULE_KEY)) || { type: "manual" }; } catch { return { type: "manual" }; } }
function saveRule(rule) { try { localStorage.setItem(RULE_KEY, JSON.stringify(rule)); } catch {} }
function readRule() {
  const type = $("#ruleType").value;
  if (type === "manual") return { type };
  const monthOffset = Number($("#ruleOffset").value);
  if (type === "business_day") return { type, n: Number($("#ruleN").value) || 5, monthOffset, saturday: $("#ruleSat").checked };
  if (type === "last_day") return { type, monthOffset };
  const days = [...new Set($("#ruleDays").value.split(/[,;\s]+/).map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 31))];
  if (!days.length) throw new Error("Informe os dias do mês, como 10, 25.");
  return { type, days };
}
function syncRuleFields() {
  const type = $("#ruleType").value;
  $("#ruleExtra").classList.toggle("hidden", type === "manual");
  $("#ruleNWrap").classList.toggle("hidden", type !== "business_day");
  $("#ruleSatWrap").classList.toggle("hidden", type !== "business_day");
  $("#ruleDaysWrap").classList.toggle("hidden", type !== "month_days");
  $("#ruleOffsetWrap").classList.toggle("hidden", type === "month_days");
}
$("#ruleType").addEventListener("change", syncRuleFields);
(() => {
  const rule = loadRule();
  $("#ruleType").value = rule.type;
  if (rule.n) $("#ruleN").value = rule.n;
  if (rule.days) $("#ruleDays").value = rule.days.join(", ");
  if (rule.monthOffset != null) $("#ruleOffset").value = rule.monthOffset;
  $("#ruleSat").checked = !!rule.saturday;
  syncRuleFields();
})();

// ---- Exportações ----
$("#exportIcs").addEventListener("click", () => {
  const list = shifts.filter(shift => isActive(shift) && shiftInDateRange(shift, $("#listStart").value, $("#listEnd").value) && matchesQuery(shift, $("#searchShifts").value));
  
  if (!list.length) return toast("Nenhum plantão no filtro atual para exportar.");

  // Se for apenas 1 plantão ou se quisermos abrir o primeiro/principal no calendário:
  // (Ou se preferir gerar o ICS via WebCal/Data URI sem o atributo 'download')
  const shift = list[0]; // Exemplo pegando o primeiro do filtro para teste direto
  
  const start = new Date(shift.startAt || shift.date).toISOString().replace(/-|:|\.\d\d\d/g, "");
  const end = new Date(shift.endAt || shift.date).toISOString().replace(/-|:|\.\d\d\d/g, "");
  const title = encodeURIComponent(shift.name || "Plantão Fácil");
  const details = encodeURIComponent(`Plantão do sistema Plantão Fácil`);

  // Abre diretamente a página de criação de evento do Google Agenda (funciona em celulares e PCs perfeitamente)
  const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`;
  
  window.open(googleCalendarUrl, '_blank');
  toast("Abrindo no calendário...");
});

$("#exportCsv").addEventListener("click", () => {
  const { monthValue, rows } = financeData();
  if (!rows.length) return toast("Nada para exportar neste mês.");
  const header = ["Data", "Início", "Nome", "Horas", "Situação", "Valor", "Pago", "Pendente", "Recebimento previsto"];
  const lines = sortShifts(rows).map(shift => [formatDate(shift.date), formatTime(getShiftStart(shift)), shift.name || "", String(shift.durationHours).replace(".", ","),
    statusLabel(shift.status), csvMoney(shift.valueCents), csvMoney(getPaidCents(shift)), csvMoney(isPayable(shift) ? remainingCents(shift) : 0),
    shift.expectedPaymentDate ? formatDate(shift.expectedPaymentDate) : ""]);
  download(`financeiro-${monthValue}.csv`, buildCsv(header, lines), "text/csv;charset=utf-8");
  toast("CSV exportado.");
});

$("#exportPdf").addEventListener("click", () => {
  const { monthValue, rows, payments, totals } = financeData();
  if (!rows.length && !payments.length) return toast("Nada para o relatório neste mês.");
  const [year, mon] = monthValue.split("-");
  const shiftRows = sortShifts(rows).map(shift => `<tr><td>${formatDate(shift.date)}</td><td>${escapeHtml(shift.name || "—")}</td><td>${shift.durationHours} h</td><td>${statusLabel(shift.status)}</td><td>${formatMoney(shift.valueCents)}</td><td>${formatMoney(getPaidCents(shift))}</td><td>${formatMoney(isPayable(shift) ? remainingCents(shift) : 0)}</td><td>${shift.expectedPaymentDate ? formatDate(shift.expectedPaymentDate) : "—"}</td></tr>`).join("");
  const payRows = payments.sort((x, y) => x.date.localeCompare(y.date)).map(payment => `<tr><td>${formatDate(payment.date)}</td><td>${escapeHtml(payment.shift.name || "—")}</td><td>${formatDate(payment.shift.date)}</td><td>${formatMoney(payment.amountCents)}</td></tr>`).join("");
  $("#printReport").innerHTML = `<h1>Relatório financeiro — ${mon}/${year}</h1>
    <p>Previsto: <b>${formatMoney(totals.expected)}</b> · Devido por trabalho realizado: <b>${formatMoney(totals.earned)}</b> · Recebido no mês: <b>${formatMoney(totals.received)}</b> · Pendente: <b>${formatMoney(totals.pending)}</b></p>
    <h2>Plantões</h2><table><thead><tr><th>Data</th><th>Nome</th><th>Duração</th><th>Situação</th><th>Valor</th><th>Pago</th><th>Pendente</th><th>Recebimento previsto</th></tr></thead><tbody>${shiftRows}</tbody></table>
    <h2>Pagamentos recebidos no mês</h2><table><thead><tr><th>Recebido em</th><th>Plantão</th><th>Data do plantão</th><th>Valor</th></tr></thead><tbody>${payRows || "<tr><td colspan=4>Nenhum pagamento no mês.</td></tr>"}</tbody></table>`;
  window.print();
});


