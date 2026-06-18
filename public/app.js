const REGIONS = [
  "서울특별시", "경기도", "인천광역시", "대전광역시", "세종특별자치시",
  "충청남도", "충청북도", "강원도", "부산광역시", "울산광역시",
  "경상남도", "경상북도", "대구광역시", "광주광역시", "전라남도",
  "전라북도", "제주특별자치도"
];

const EXPENSE_ITEMS = ["인건비", "차량렌탈비", "차량유지비", "성과급", "자재비"];
const PAGE_SIZE = 20;

let app = {
  jobs: [],
  filteredJobs: [],
  fees: [],
  expenses: {
    monthlyExpenses: {},
    workerWages: {}
  },
  currentPage: 1,
  editingMaintenanceNo: null,
  incomeTypeChart: null,
  incomeMonthlyChart: null,
  expenseChart: null
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  document.getElementById("current-date").textContent =
    new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

  fillRegionSelects();
  fillYearSelect();
  bindExcelUpload();
  bindModalClose();
  await reloadAll();
}

function fillRegionSelects() {
  const filterRegion = document.getElementById("f-region");
  const modalRegion = document.getElementById("m-region");

  filterRegion.innerHTML = `<option value="">전체</option>` + REGIONS.map(r => `<option>${escapeHtml(r)}</option>`).join("");
  modalRegion.innerHTML = `<option value="">선택</option>` + REGIONS.map(r => `<option>${escapeHtml(r)}</option>`).join("");
}

function fillYearSelect() {
  const select = document.getElementById("expense-year");
  const y = new Date().getFullYear();
  select.innerHTML = "";
  for (let year = y - 2; year <= y + 1; year++) {
    const opt = document.createElement("option");
    opt.value = String(year);
    opt.textContent = `${year}년`;
    if (year === y) opt.selected = true;
    select.appendChild(opt);
  }
}

async function reloadAll() {
  try {
    await Promise.all([loadFees(), loadJobs(), loadExpenses()]);
    syncFeeRowsWithJobs();
    renderAll();
    showToast("데이터를 불러왔습니다.");
  } catch (err) {
    console.error(err);
    showToast("데이터 불러오기 실패: " + err.message, true);
  }
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!res.ok) {
    const msg = body?.error || body?.message || `API 오류 (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

async function loadJobs() {
  const data = await apiFetch("/api/jobs");
  app.jobs = data.jobs || [];
  app.filteredJobs = [...app.jobs];
}

async function loadFees() {
  const data = await apiFetch("/api/fees");
  app.fees = data.fees || [];
}

async function loadExpenses() {
  const data = await apiFetch("/api/expenses");
  app.expenses = {
    monthlyExpenses: data.monthlyExpenses || {},
    workerWages: data.workerWages || {}
  };
}

function renderAll() {
  renderManagerOptions();
  applyWorkFilter(false);
  renderFees();
  renderIncome();
  renderExpense();
}

function showPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("page-" + id).classList.add("active");
  document.getElementById("nav-" + id).classList.add("active");

  if (id === "income") setTimeout(renderIncome, 100);
  if (id === "expense") setTimeout(() => { renderExpense(); renderExpenseChart(); }, 100);
}

function renderManagerOptions() {
  const managers = [...new Set(app.jobs.map(j => j.manager).filter(Boolean))].sort();
  const select = document.getElementById("f-manager");
  const current = select.value;
  select.innerHTML = `<option value="">전체</option>` + managers.map(m => `<option>${escapeHtml(m)}</option>`).join("");
  select.value = current;
}

function applyWorkFilter(showMessage = true) {
  const fs = {
    requestStart: document.getElementById("f-request-start").value,
    requestEnd: document.getElementById("f-request-end").value,
    completeStart: document.getElementById("f-complete-start").value,
    completeEnd: document.getElementById("f-complete-end").value,
    dueStart: document.getElementById("f-due-start").value,
    dueEnd: document.getElementById("f-due-end").value,
    manager: document.getElementById("f-manager").value,
    region: document.getElementById("f-region").value,
    status: document.getElementById("f-status").value
  };

  app.filteredJobs = app.jobs.filter(j => {
    if (fs.requestStart && compareDate(j.requestDate, fs.requestStart) < 0) return false;
    if (fs.requestEnd && compareDate(j.requestDate, fs.requestEnd) > 0) return false;
    if (fs.completeStart && compareDate(j.completeDate, fs.completeStart) < 0) return false;
    if (fs.completeEnd && compareDate(j.completeDate, fs.completeEnd) > 0) return false;
    if (fs.dueStart && compareDate(j.urgentDueDate, fs.dueStart) < 0) return false;
    if (fs.dueEnd && compareDate(j.urgentDueDate, fs.dueEnd) > 0) return false;
    if (fs.manager && j.manager !== fs.manager) return false;
    if (fs.region && j.region !== fs.region) return false;
    if (fs.status && j.status !== fs.status) return false;
    return true;
  });

  app.currentPage = 1;
  renderWork();
  if (showMessage) showToast(`${app.filteredJobs.length.toLocaleString()}건 조회되었습니다.`);
}

function resetWorkFilter() {
  [
    "f-request-start", "f-request-end", "f-complete-start", "f-complete-end",
    "f-due-start", "f-due-end"
  ].forEach(id => document.getElementById(id).value = "");
  ["f-manager", "f-region", "f-status"].forEach(id => document.getElementById(id).value = "");
  applyWorkFilter(false);
}

function renderWork() {
  const total = app.filteredJobs.length;
  const supplement = app.filteredJobs.filter(j => j.status === "보완 요청").length;
  const done = app.filteredJobs.filter(j => j.status === "완료").length;

  document.getElementById("stat-total").textContent = total.toLocaleString();
  document.getElementById("stat-supplement").textContent = supplement.toLocaleString();
  document.getElementById("stat-done").textContent = done.toLocaleString();
  document.getElementById("work-count-label").textContent = `총 ${total.toLocaleString()}건`;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (app.currentPage > totalPages) app.currentPage = totalPages;
  const start = (app.currentPage - 1) * PAGE_SIZE;
  const pageRows = app.filteredJobs.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById("work-tbody");
  if (!pageRows.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">
      <div class="icon">📋</div>
      <p>작업 데이터가 없습니다.<br>엑셀을 업로드하거나 작업을 직접 추가하세요.</p>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = pageRows.map((j, i) => `
      <tr>
        <td class="muted">${start + i + 1}</td>
        <td>${escapeHtml(j.maintenanceNo)}</td>
        <td><span class="badge-pill ${statusClass(j.status)}">${escapeHtml(j.status || "-")}</span></td>
        <td>${escapeHtml(j.requestDate || "-")}</td>
        <td>${escapeHtml(j.urgentDueDate || "-")}</td>
        <td>${escapeHtml(j.completeDate || "-")}</td>
        <td>${escapeHtml(j.region || "-")}</td>
        <td>${escapeHtml(j.manager || "-")}</td>
        <td>${escapeHtml(j.resultType || "-")}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editWork('${escapeJs(j.maintenanceNo)}')">수정</button>
          <button class="btn btn-sm btn-danger" onclick="deleteWork('${escapeJs(j.maintenanceNo)}')">삭제</button>
        </td>
      </tr>
    `).join("");
  }

  document.getElementById("work-page-info").textContent =
    total === 0 ? "0 - 0 / 0건" : `${start + 1} - ${Math.min(start + PAGE_SIZE, total)} / ${total.toLocaleString()}건`;

  const btns = document.getElementById("work-page-btns");
  btns.innerHTML = "";

  const maxButtons = 7;
  let pStart = Math.max(1, app.currentPage - 3);
  let pEnd = Math.min(totalPages, pStart + maxButtons - 1);
  pStart = Math.max(1, pEnd - maxButtons + 1);

  for (let p = pStart; p <= pEnd; p++) {
    const b = document.createElement("button");
    b.textContent = p;
    if (p === app.currentPage) b.classList.add("active");
    b.onclick = () => { app.currentPage = p; renderWork(); };
    btns.appendChild(b);
  }
}

function statusClass(status) {
  return "badge-" + String(status || "신청").replace(/\s+/g, "-");
}

function openAddWorkModal() {
  app.editingMaintenanceNo = null;
  document.getElementById("work-modal-title").textContent = "작업 추가";
  setWorkModalValues({});
  document.getElementById("m-maintenance-no").disabled = false;
  document.getElementById("work-modal").classList.add("open");
}

function editWork(maintenanceNo) {
  const job = app.jobs.find(j => j.maintenanceNo === maintenanceNo);
  if (!job) return;
  app.editingMaintenanceNo = maintenanceNo;
  document.getElementById("work-modal-title").textContent = "작업 수정";
  setWorkModalValues(job);
  document.getElementById("m-maintenance-no").disabled = true;
  document.getElementById("work-modal").classList.add("open");
}

function setWorkModalValues(j) {
  document.getElementById("m-maintenance-no").value = j.maintenanceNo || "";
  document.getElementById("m-status").value = j.status || "신청";
  document.getElementById("m-request-date").value = j.requestDate || "";
  document.getElementById("m-urgent-due-date").value = j.urgentDueDate || "";
  document.getElementById("m-complete-date").value = j.completeDate || "";
  document.getElementById("m-region").value = j.region || "";
  document.getElementById("m-manager").value = j.manager || "";
  document.getElementById("m-result-type").value = j.resultType || "";
}

async function saveWork() {
  const job = {
    maintenanceNo: document.getElementById("m-maintenance-no").value.trim(),
    status: normalizeStatus(document.getElementById("m-status").value),
    requestDate: document.getElementById("m-request-date").value,
    urgentDueDate: document.getElementById("m-urgent-due-date").value,
    completeDate: document.getElementById("m-complete-date").value,
    region: document.getElementById("m-region").value,
    manager: document.getElementById("m-manager").value.trim(),
    resultType: document.getElementById("m-result-type").value.trim()
  };

  if (!/^\d{12}$/.test(job.maintenanceNo)) {
    showToast("유지보수 No는 12자리 숫자여야 합니다.", true);
    return;
  }

  try {
    await apiFetch("/api/jobs", { method: "POST", body: JSON.stringify({ job }) });
    closeModal("work-modal");
    await reloadAll();
    showToast(app.editingMaintenanceNo ? "수정되었습니다." : "추가되었습니다.");
  } catch (err) {
    showToast("저장 실패: " + err.message, true);
  }
}

async function deleteWork(maintenanceNo) {
  if (!confirm(`유지보수 No ${maintenanceNo} 건을 삭제하시겠습니까?`)) return;
  try {
    await apiFetch("/api/jobs", { method: "DELETE", body: JSON.stringify({ maintenanceNo }) });
    await reloadAll();
    showToast("삭제되었습니다.");
  } catch (err) {
    showToast("삭제 실패: " + err.message, true);
  }
}

function bindExcelUpload() {
  document.getElementById("excel-upload").addEventListener("change", handleExcelUpload);
}

async function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: "",
      raw: false,
      dateNF: "yyyy-mm-dd"
    });

    const parsed = parseExcelRows(rows);

    if (parsed.invalid.length) {
      console.warn("Invalid rows", parsed.invalid);
    }

    if (!parsed.jobs.length) {
      showToast("업로드 가능한 데이터가 없습니다. A~H열과 헤더를 확인하세요.", true);
      return;
    }

    const message =
      `${parsed.jobs.length.toLocaleString()}건을 업로드합니다.\n` +
      `유지보수 No가 이미 있으면 업데이트하고, 없으면 신규 추가합니다.\n` +
      (parsed.invalid.length ? `\n제외된 행: ${parsed.invalid.length}건` : "");

    if (!confirm(message)) return;

    const result = await apiFetch("/api/jobs/import", {
      method: "POST",
      body: JSON.stringify({ rows: parsed.jobs })
    });

    await reloadAll();
    syncFeeRowsWithJobs();
    showToast(`업로드 완료: 신규 ${result.inserted}건, 업데이트 ${result.updated}건`);
  } catch (err) {
    console.error(err);
    showToast("엑셀 업로드 실패: " + err.message, true);
  } finally {
    e.target.value = "";
  }
}

function parseExcelRows(rows) {
  const jobs = [];
  const invalid = [];

  rows.forEach((row, idx) => {
    const rowNo = idx + 1;
    const first = String(row[0] ?? "").trim();

    if (!first) return;
    if (rowNo === 1 && first.includes("유지보수")) return;

    const maintenanceNo = normalizeMaintenanceNo(row[0]);
    const status = normalizeStatus(row[1]);
    const requestDate = normalizeDate(row[2]);
    const urgentDueDate = normalizeDate(row[3]);
    const completeDate = normalizeDate(row[4]);
    const region = String(row[5] ?? "").trim();
    const manager = String(row[6] ?? "").trim();
    const resultType = String(row[7] ?? "").trim();

    if (!/^\d{12}$/.test(maintenanceNo)) {
      invalid.push({ rowNo, reason: "유지보수 No 12자리 오류", value: row[0] });
      return;
    }

    if (!["신청", "보완 요청", "완료"].includes(status)) {
      invalid.push({ rowNo, reason: "상태값 오류", value: row[1] });
      return;
    }

    jobs.push({
      maintenanceNo,
      status,
      requestDate,
      urgentDueDate,
      completeDate,
      region,
      manager,
      resultType
    });
  });

  return { jobs, invalid };
}

function normalizeMaintenanceNo(v) {
  return String(v ?? "").replace(/[^0-9]/g, "").trim();
}

function normalizeStatus(value) {
  const raw = String(value ?? "").trim();
  const compact = raw.replace(/\s+/g, "");

  if (!compact || compact === "신청") return "신청";
  if (compact === "보완" || compact === "보완요청") return "보완 요청";
  if (compact === "완료") return "완료";

  return "";
}

function normalizeDate(v) {
  if (v === null || v === undefined || v === "") return "";

  if (v instanceof Date && !isNaN(v)) {
    return v.toISOString().slice(0, 10);
  }

  const s = String(v).trim();
  if (!s) return "";

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  if (/^\d{4}[./]\d{1,2}[./]\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split(/[./]/);
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const date = new Date(s);
  if (!isNaN(date)) return date.toISOString().slice(0, 10);

  return s;
}

function compareDate(a, b) {
  if (!a) return -999999;
  return String(a).localeCompare(String(b));
}

function syncFeeRowsWithJobs() {
  const resultTypes = [...new Set(app.jobs.map(j => j.resultType).filter(Boolean))];
  let changed = false;
  resultTypes.forEach(rt => {
    if (!app.fees.some(f => f.resultType === rt)) {
      app.fees.push({ resultType: rt, incomeFee: 0, expertFee: 0 });
      changed = true;
    }
  });
  if (changed) renderFees();
}

function renderFees() {
  const incomeTbody = document.getElementById("income-fee-tbody");
  const expertTbody = document.getElementById("expert-fee-tbody");

  if (!app.fees.length) {
    incomeTbody.innerHTML = `<tr><td colspan="3" class="muted">단가표 데이터가 없습니다.</td></tr>`;
    expertTbody.innerHTML = `<tr><td colspan="3" class="muted">단가표 데이터가 없습니다.</td></tr>`;
    return;
  }

  incomeTbody.innerHTML = app.fees.map((f, i) => `
    <tr>
      <td><input value="${escapeHtml(f.resultType || "")}" onchange="updateFee(${i}, 'resultType', this.value)"></td>
      <td><input type="number" value="${Number(f.incomeFee || 0)}" onchange="updateFee(${i}, 'incomeFee', this.value)"></td>
      <td style="text-align:center"><button class="btn btn-sm btn-danger" onclick="removeFeeRow(${i})">삭제</button></td>
    </tr>
  `).join("");

  expertTbody.innerHTML = app.fees.map((f, i) => `
    <tr>
      <td><input value="${escapeHtml(f.resultType || "")}" onchange="updateFee(${i}, 'resultType', this.value)"></td>
      <td><input type="number" value="${Number(f.expertFee || 0)}" onchange="updateFee(${i}, 'expertFee', this.value)"></td>
      <td style="text-align:center"><button class="btn btn-sm btn-danger" onclick="removeFeeRow(${i})">삭제</button></td>
    </tr>
  `).join("");
}

function updateFee(idx, field, value) {
  if (field === "incomeFee" || field === "expertFee") {
    app.fees[idx][field] = Number(value) || 0;
  } else {
    app.fees[idx][field] = String(value).trim();
  }
}

function addFeeRow() {
  app.fees.push({ resultType: "새 유형", incomeFee: 0, expertFee: 0 });
  renderFees();
}

function removeFeeRow(idx) {
  if (!confirm("해당 단가 행을 삭제하시겠습니까?")) return;
  app.fees.splice(idx, 1);
  renderFees();
}

async function saveFees() {
  const seen = new Set();
  const fees = app.fees
    .map(f => ({
      resultType: String(f.resultType || "").trim(),
      incomeFee: Number(f.incomeFee) || 0,
      expertFee: Number(f.expertFee) || 0
    }))
    .filter(f => f.resultType)
    .filter(f => {
      if (seen.has(f.resultType)) return false;
      seen.add(f.resultType);
      return true;
    });

  try {
    const result = await apiFetch("/api/fees", { method: "POST", body: JSON.stringify({ fees }) });
    app.fees = result.fees || fees;
    renderFees();
    renderIncome();
    showToast("단가표가 저장되었습니다.");
  } catch (err) {
    showToast("단가표 저장 실패: " + err.message, true);
  }
}

function getIncomeDateRange() {
  let start = document.getElementById("ie-start").value;
  let end = document.getElementById("ie-end").value;
  if (!start) {
    const d = new Date();
    d.setDate(1);
    start = d.toISOString().slice(0, 10);
  }
  if (!end) end = new Date().toISOString().slice(0, 10);
  return { start, end };
}

function resetIncomeFilter() {
  document.getElementById("ie-start").value = "";
  document.getElementById("ie-end").value = "";
  renderIncome();
}

function feeMap() {
  const map = {};
  app.fees.forEach(f => {
    map[f.resultType] = {
      incomeFee: Number(f.incomeFee) || 0,
      expertFee: Number(f.expertFee) || 0
    };
  });
  return map;
}

function calculateIncome(start, end) {
  const map = feeMap();
  const byType = {};
  let total = 0;

  app.jobs.forEach(j => {
    if (j.status !== "완료") return;
    if (start && compareDate(j.completeDate, start) < 0) return;
    if (end && compareDate(j.completeDate, end) > 0) return;

    const type = j.resultType || "미분류";
    const fee = Number(j.appliedIncomeFee || 0) || Number(map[type]?.incomeFee || 0);
    if (!byType[type]) byType[type] = { count: 0, fee: Number(map[type]?.incomeFee || 0), amount: 0 };
    byType[type].count += 1;
    byType[type].amount += fee;
    total += fee;
  });

  return { total, byType };
}

function calculateExpense(start, end) {
  let total = 0;
  const monthly = app.expenses.monthlyExpenses || {};
  const wages = app.expenses.workerWages || {};

  for (const [monthKey, items] of Object.entries(monthly)) {
    const d = monthKey + "-15";
    if (start && compareDate(d, start) < 0) continue;
    if (end && compareDate(d, end) > 0) continue;
    EXPENSE_ITEMS.forEach(item => total += Number(items[item]) || 0);
  }

  for (const [monthKey, workers] of Object.entries(wages)) {
    const d = monthKey + "-15";
    if (start && compareDate(d, start) < 0) continue;
    if (end && compareDate(d, end) > 0) continue;
    Object.values(workers).forEach(v => total += Number(v) || 0);
  }

  return total;
}

function renderIncome() {
  const { start, end } = getIncomeDateRange();
  const income = calculateIncome(start, end);
  const expense = calculateExpense(start, end);
  const profit = income.total - expense;

  document.getElementById("ie-income").textContent = won(income.total);
  document.getElementById("ie-expense").textContent = won(expense);
  document.getElementById("ie-profit").textContent = won(profit);

  const tbody = document.getElementById("income-detail-tbody");
  const rows = Object.entries(income.byType).sort((a,b) => b[1].amount - a[1].amount);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">완료 데이터가 없습니다.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(([type, v]) => `
      <tr>
        <td>${escapeHtml(type)}</td>
        <td style="text-align:right">${won(v.fee)}</td>
        <td style="text-align:center">${v.count.toLocaleString()}건</td>
        <td style="text-align:right;font-weight:700;color:var(--primary)">${won(v.amount)}</td>
      </tr>
    `).join("");
  }

  renderIncomeCharts(income.byType);
}

function renderIncomeCharts(byType) {
  const labels = Object.keys(byType);
  const amounts = labels.map(l => byType[l].amount);

  const ctx1 = document.getElementById("income-type-chart");
  if (app.incomeTypeChart) app.incomeTypeChart.destroy();
  app.incomeTypeChart = new Chart(ctx1, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: amounts }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "right" } }
    }
  });

  const months = recentMonths(6);
  const incomeData = months.map(m => {
    const { total } = calculateIncome(`${m}-01`, `${m}-31`);
    return total;
  });
  const expenseData = months.map(m => calculateExpense(`${m}-01`, `${m}-31`));

  const ctx2 = document.getElementById("income-monthly-chart");
  if (app.incomeMonthlyChart) app.incomeMonthlyChart.destroy();
  app.incomeMonthlyChart = new Chart(ctx2, {
    type: "bar",
    data: {
      labels: months,
      datasets: [
        { label: "수입", data: incomeData },
        { label: "지출", data: expenseData }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { ticks: { callback: v => won(v) } } }
    }
  });
}

function recentMonths(count) {
  const arr = [];
  const base = new Date();
  base.setDate(1);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setMonth(d.getMonth() - i);
    arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return arr;
}

function renderExpense() {
  const year = document.getElementById("expense-year").value;
  const grid = document.getElementById("expense-grid");
  grid.innerHTML = "";

  for (let m = 1; m <= 12; m++) {
    const monthKey = `${year}-${String(m).padStart(2, "0")}`;
    const items = app.expenses.monthlyExpenses[monthKey] || {};
    const total = EXPENSE_ITEMS.reduce((sum, item) => sum + (Number(items[item]) || 0), 0);

    const card = document.createElement("div");
    card.className = "expense-month-card";
    card.innerHTML = `
      <div class="month-label">
        <span>${m}월</span>
        <span>${won(total)}</span>
      </div>
      ${EXPENSE_ITEMS.map(item => `
        <div class="expense-row">
          <label>${item}</label>
          <input type="number" value="${Number(items[item] || "") || ""}" placeholder="0"
            onchange="updateMonthlyExpense('${monthKey}', '${item}', this.value)">
        </div>
      `).join("")}
      <div class="expense-total" id="expense-total-${monthKey}">
        <span>합계</span><span>${won(total)}</span>
      </div>
    `;
    grid.appendChild(card);
  }

  renderWorkerWages();
  renderExpenseChart();
}

function updateMonthlyExpense(monthKey, item, value) {
  if (!app.expenses.monthlyExpenses[monthKey]) app.expenses.monthlyExpenses[monthKey] = {};
  app.expenses.monthlyExpenses[monthKey][item] = Number(value) || 0;

  const items = app.expenses.monthlyExpenses[monthKey];
  const total = EXPENSE_ITEMS.reduce((sum, name) => sum + (Number(items[name]) || 0), 0);
  const el = document.getElementById(`expense-total-${monthKey}`);
  if (el) el.innerHTML = `<span>합계</span><span>${won(total)}</span>`;
}

function renderWorkerWages() {
  const year = document.getElementById("expense-year").value;
  const tbody = document.getElementById("worker-wage-tbody");
  const workers = workerNames();

  if (!workers.length) {
    tbody.innerHTML = `<tr><td colspan="15" class="muted">작업자 데이터가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = workers.map(worker => {
    let total = 0;
    const monthCells = Array.from({ length: 12 }, (_, i) => {
      const monthKey = `${year}-${String(i + 1).padStart(2, "0")}`;
      const value = Number(app.expenses.workerWages?.[monthKey]?.[worker]) || 0;
      total += value;
      return `<td><input class="inline-money" type="number" value="${value || ""}" placeholder="0"
        onchange="updateWorkerWage('${monthKey}', '${escapeJs(worker)}', this.value)"></td>`;
    }).join("");

    return `<tr>
      <td style="font-weight:600">${escapeHtml(worker)}</td>
      ${monthCells}
      <td style="text-align:right;font-weight:700">${won(total)}</td>
      <td><button class="btn btn-sm btn-danger" onclick="removeWorker('${escapeJs(worker)}')">삭제</button></td>
    </tr>`;
  }).join("");
}

function workerNames() {
  const names = new Set();
  app.jobs.forEach(j => { if (j.manager) names.add(j.manager); });
  Object.values(app.expenses.workerWages || {}).forEach(workers => {
    Object.keys(workers || {}).forEach(name => names.add(name));
  });
  return [...names].sort();
}

function updateWorkerWage(monthKey, worker, value) {
  if (!app.expenses.workerWages[monthKey]) app.expenses.workerWages[monthKey] = {};
  app.expenses.workerWages[monthKey][worker] = Number(value) || 0;
}

function openWorkerModal() {
  document.getElementById("new-worker-name").value = "";
  document.getElementById("worker-modal").classList.add("open");
}

function saveNewWorker() {
  const name = document.getElementById("new-worker-name").value.trim();
  if (!name) {
    showToast("작업자명을 입력하세요.", true);
    return;
  }
  const year = document.getElementById("expense-year").value;
  const monthKey = `${year}-01`;
  if (!app.expenses.workerWages[monthKey]) app.expenses.workerWages[monthKey] = {};
  if (app.expenses.workerWages[monthKey][name] === undefined) {
    app.expenses.workerWages[monthKey][name] = 0;
  }
  closeModal("worker-modal");
  renderWorkerWages();
}

function removeWorker(worker) {
  if (!confirm(`${worker} 작업자의 인건비 행을 삭제하시겠습니까?\n작업현황의 담당자명은 삭제되지 않습니다.`)) return;
  Object.values(app.expenses.workerWages || {}).forEach(workers => {
    if (workers && Object.prototype.hasOwnProperty.call(workers, worker)) {
      delete workers[worker];
    }
  });
  renderWorkerWages();
}

async function saveExpenses() {
  try {
    await apiFetch("/api/expenses", {
      method: "POST",
      body: JSON.stringify(app.expenses)
    });
    await loadExpenses();
    renderExpense();
    renderIncome();
    showToast("지출 데이터가 저장되었습니다.");
  } catch (err) {
    showToast("지출 저장 실패: " + err.message, true);
  }
}

function switchExpenseTab(tab, btn) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("tab-" + tab).classList.add("active");
  if (tab === "monthly") setTimeout(renderExpenseChart, 100);
}

function renderExpenseChart() {
  const year = document.getElementById("expense-year").value;
  const labels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
  const datasets = EXPENSE_ITEMS.map(item => ({
    label: item,
    data: Array.from({ length: 12 }, (_, i) => {
      const monthKey = `${year}-${String(i + 1).padStart(2, "0")}`;
      return Number(app.expenses.monthlyExpenses?.[monthKey]?.[item]) || 0;
    })
  }));

  const ctx = document.getElementById("expense-chart");
  if (!ctx) return;
  if (app.expenseChart) app.expenseChart.destroy();
  app.expenseChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => won(v) } }
      }
    }
  });
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function bindModalClose() {
  document.querySelectorAll(".modal-overlay").forEach(o => {
    o.addEventListener("click", e => {
      if (e.target === o) o.classList.remove("open");
    });
  });
}

function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.background = isError ? "var(--danger)" : "var(--gray-900)";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

function won(v) {
  return "₩" + (Number(v) || 0).toLocaleString();
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function escapeJs(v) {
  return String(v ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
