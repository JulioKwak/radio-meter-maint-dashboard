const REGIONS = [
  "서울특별시", "경기도", "인천광역시", "대전광역시", "세종특별자치시",
  "충청남도", "충청북도", "강원도", "부산광역시", "울산광역시",
  "경상남도", "경상북도", "대구광역시", "광주광역시", "전라남도",
  "전라북도", "제주특별자치도"
];

const EXPENSE_ITEMS = ["인건비", "전문가 수수료", "차량렌탈비", "차량유지비", "출장비", "성과급", "자재비"];
const PAGE_SIZE = 20;

let app = {
  jobs: [],
  filteredJobs: [],
  fees: [],
  allFees: [],
  expenses: {
    monthlyExpenses: {}
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
  setDefaultDateFilters();
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
  for (let year = 2024; year <= y + 10; year++) {
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiFetchWithRetry(url, options = {}, retryCount = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      return await apiFetch(url, options);
    } catch (err) {
      lastError = err;
      if (attempt >= retryCount) break;
      await sleep(800 * attempt);
    }
  }

  throw lastError;
}

async function loadJobs() {
  const data = await apiFetch("/api/jobs");
  app.jobs = data.jobs || [];
  app.filteredJobs = [...app.jobs];
}

async function loadFees() {
  const data = await apiFetch("/api/fees");
  app.fees = data.fees || [];
  app.allFees = data.allFees || data.fees || [];
}

async function loadExpenses() {
  const data = await apiFetch("/api/expenses");
  app.expenses = {
    monthlyExpenses: data.monthlyExpenses || {}
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

  if (id === "work") {
    ensureWorkDateDefaults();
    setTimeout(() => applyWorkFilter(false), 100);
  }
  if (id === "income") {
    ensureIncomeDateDefaults();
    setTimeout(renderIncome, 100);
  }
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
  ensureWorkDateDefaults();

  const dateField = document.getElementById("f-date-field").value || "requestDate";
  const startDate = document.getElementById("f-date-start").value;
  const endDate = document.getElementById("f-date-end").value;
  const fs = {
    manager: document.getElementById("f-manager").value,
    region: document.getElementById("f-region").value,
    status: document.getElementById("f-status").value
  };

  app.filteredJobs = app.jobs.filter(j => {
    const targetDate = j[dateField] || "";
    if (startDate && compareDate(targetDate, startDate) < 0) return false;
    if (endDate && compareDate(targetDate, endDate) > 0) return false;
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
  document.getElementById("f-date-field").value = "requestDate";
  setDateRangeInputs("f-date-start", "f-date-end");
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
      console.warn("Client invalid rows", parsed.invalid);
    }

    if (!parsed.jobs.length) {
      showToast("업로드 가능한 데이터가 없습니다. A~H열과 헤더를 확인하세요.", true);
      return;
    }

    showToast("엑셀 데이터 검토 중입니다...");

    const preview = await apiFetchWithRetry("/api/jobs/preview", {
      method: "POST",
      body: JSON.stringify({ rows: parsed.jobs })
    }, 3);

    const clientInvalidCount = parsed.invalid.length;
    const serverInvalidCount = Number(preview.invalidCount || 0);
    const invalidTotal = clientInvalidCount + serverInvalidCount;
    const insertCount = Number(preview.insertCount || 0);
    const updateCount = Number(preview.updateCount || 0);
    const deleteCount = Number(preview.deleteCount || 0);
    const sameCount = Number(preview.sameCount || 0);
    const toSaveCount = Number(preview.toSaveCount || 0);

    if (preview.invalid?.length) {
      console.warn("Server invalid rows", preview.invalid);
    }
    if (preview.updateSamples?.length) {
      console.warn("Update samples", preview.updateSamples);
    }
    if (preview.deleteSamples?.length) {
      console.warn("Delete samples", preview.deleteSamples);
    }

    const summary =
      `엑셀 검토 결과\n\n` +
      `엑셀 정상 행: ${parsed.jobs.length.toLocaleString()}건\n` +
      `DB 기존 건수: ${Number(preview.dbCount || 0).toLocaleString()}건\n\n` +
      `신규 추가: ${insertCount.toLocaleString()}건\n` +
      `수정 예정: ${updateCount.toLocaleString()}건\n` +
      `삭제 예정: ${deleteCount.toLocaleString()}건\n` +
      `변경 없음: ${sameCount.toLocaleString()}건\n` +
      `오류 제외: ${invalidTotal.toLocaleString()}건\n\n` +
      `처리 대상: ${toSaveCount.toLocaleString()}건\n\n` +
      (deleteCount ? `주의: DB에는 있지만 이번 엑셀에 없는 ${deleteCount.toLocaleString()}건은 삭제됩니다.\n` : "") +
      (invalidTotal ? `오류 상세는 브라우저 콘솔에 표시됩니다.\n` : "") +
      `\n신규/수정/삭제를 반영하시겠습니까?`;

    if (!toSaveCount) {
      alert(summary.replace("신규/수정/삭제를 반영하시겠습니까?", "저장할 신규/수정/삭제 데이터가 없습니다."));
      return;
    }

    if (!confirm(summary)) return;

    const targetNos = new Set([...(preview.insertNos || []), ...(preview.updateNos || [])]);
    const rowsToSave = parsed.jobs.filter(row => targetNos.has(row.maintenanceNo));
    const deleteNos = preview.deleteNos || [];

    const BATCH_SIZE = 100;
    const DELETE_BATCH_SIZE = 100;
    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    let invalid = [];

    for (let i = 0; i < rowsToSave.length; i += BATCH_SIZE) {
      const batch = rowsToSave.slice(i, i + BATCH_SIZE);
      const batchNo = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatch = Math.ceil(rowsToSave.length / BATCH_SIZE);

      showToast(`저장 중... ${batchNo}/${totalBatch} (${i + batch.length}/${rowsToSave.length}건)`);

      const result = await apiFetchWithRetry("/api/jobs/import", {
        method: "POST",
        body: JSON.stringify({ rows: batch })
      }, 3);

      inserted += Number(result.inserted || 0);
      updated += Number(result.updated || 0);

      if (Array.isArray(result.invalid)) {
        invalid = invalid.concat(result.invalid.map(item => ({ ...item, batch: batchNo })));
      }

      await sleep(300);
    }

    for (let i = 0; i < deleteNos.length; i += DELETE_BATCH_SIZE) {
      const batch = deleteNos.slice(i, i + DELETE_BATCH_SIZE);
      const batchNo = Math.floor(i / DELETE_BATCH_SIZE) + 1;
      const totalBatch = Math.ceil(deleteNos.length / DELETE_BATCH_SIZE);

      showToast(`삭제 반영 중... ${batchNo}/${totalBatch} (${i + batch.length}/${deleteNos.length}건)`);

      const result = await apiFetchWithRetry("/api/jobs/import", {
        method: "POST",
        body: JSON.stringify({ deleteNos: batch })
      }, 3);

      deleted += Number(result.deleted || 0);

      if (Array.isArray(result.invalid)) {
        invalid = invalid.concat(result.invalid.map(item => ({ ...item, deleteBatch: batchNo })));
      }

      await sleep(300);
    }

    if (invalid.length) {
      console.warn("Save invalid rows", invalid);
    }

    await reloadAll();
    syncFeeRowsWithJobs();

    showToast(
      `반영 완료: 신규 ${inserted.toLocaleString()}건, 수정 ${updated.toLocaleString()}건, 삭제 ${deleted.toLocaleString()}건` +
      (invalid.length ? `, 제외 ${invalid.length.toLocaleString()}건` : "")
    );
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

  // Excel 날짜 셀이 Date 객체로 들어오는 경우, toISOString()을 쓰면
  // UTC 변환 때문에 한국 시간 기준 날짜가 -1일로 저장될 수 있습니다.
  // 그래서 반드시 로컬 날짜(getFullYear/getMonth/getDate) 기준으로 변환합니다.
  if (v instanceof Date && !isNaN(v)) {
    return formatDateLocal(v);
  }

  // Excel 날짜가 숫자 serial 값으로 들어오는 경우까지 대비합니다.
  if (typeof v === "number" && isFinite(v)) {
    return excelSerialDateToLocalDate(v);
  }

  const s = String(v).trim();
  if (!s) return "";

  // 숫자 형태의 Excel serial 문자열 처리
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return excelSerialDateToLocalDate(n);
  }

  // 2026-6-8, 2026-06-08
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 2026. 6. 8. / 2026.6.8 / 2026/6/8
  if (/^\d{4}[./]\s*\d{1,2}[./]\s*\d{1,2}\.?$/.test(s)) {
    const cleaned = s.replace(/\.$/, "");
    const [y, m, d] = cleaned.split(/[./]/).map(x => x.trim());
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 2026년 6월 8일
  const koreanMatch = s.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
  if (koreanMatch) {
    const [, y, m, d] = koreanMatch;
    return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 마지막 예외 처리도 toISOString()을 쓰지 않고 로컬 날짜로 처리합니다.
  const date = new Date(s);
  if (!isNaN(date)) return formatDateLocal(date);

  return s;
}

function excelSerialDateToLocalDate(serial) {
  // Excel 1900 date system 기준. 시간값이 붙어 있어도 날짜만 사용합니다.
  const wholeDays = Math.floor(Number(serial));
  const utcDays = wholeDays - 25569;
  const utcValue = utcDays * 86400 * 1000;
  const date = new Date(utcValue);

  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function compareDate(a, b) {
  if (!a) return -999999;
  return String(a).localeCompare(String(b));
}

function formatDateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function currentMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: formatDateLocal(first),
    end: formatDateLocal(now)
  };
}

function setDateRangeInputs(startId, endId) {
  const range = currentMonthRange();
  document.getElementById(startId).value = range.start;
  document.getElementById(endId).value = range.end;
}

function setDefaultDateFilters() {
  document.getElementById("f-date-field").value = "requestDate";
  setDateRangeInputs("f-date-start", "f-date-end");
  setDateRangeInputs("ie-start", "ie-end");
}

function ensureWorkDateDefaults() {
  if (!document.getElementById("f-date-start").value || !document.getElementById("f-date-end").value) {
    setDateRangeInputs("f-date-start", "f-date-end");
  }
}

function ensureIncomeDateDefaults() {
  if (!document.getElementById("ie-start").value || !document.getElementById("ie-end").value) {
    setDateRangeInputs("ie-start", "ie-end");
  }
}

function syncFeeRowsWithJobs() {
  const resultTypes = [...new Set(app.jobs.map(j => j.resultType).filter(Boolean))];
  let changed = false;
  const defaultStart = "2026-04-01";

  resultTypes.forEach(rt => {
    if (!app.fees.some(f => f.resultType === rt)) {
      app.fees.push({ resultType: rt, incomeFee: 0, validFrom: defaultStart, validTo: "" });
      changed = true;
    }
  });

  if (changed) renderFees();
}

function renderFees() {
  const incomeTbody = document.getElementById("income-fee-tbody");

  if (!app.fees.length) {
    incomeTbody.innerHTML = `<tr><td colspan="5" class="muted">현재 적용 중인 단가표 데이터가 없습니다.</td></tr>`;
    return;
  }

  incomeTbody.innerHTML = app.fees.map((f, i) => `
    <tr>
      <td>${escapeHtml(f.resultType || "")}</td>
      <td><input type="number" value="${Number(f.incomeFee || 0)}" onchange="updateFee(${i}, 'incomeFee', this.value)"></td>
      <td><input type="date" value="${escapeHtml(f.validFrom || "")}" onchange="updateFee(${i}, 'validFrom', this.value)"></td>
      <td>${f.validTo ? escapeHtml(f.validTo) : '<span class="badge-pill badge-done">현재 적용 중</span>'}</td>
      <td style="text-align:center">
        <button class="btn btn-sm btn-secondary" onclick="showFeeHistory('${escapeJs(f.resultType)}')">이력</button>
      </td>
    </tr>
  `).join("");
}

function updateFee(idx, field, value) {
  if (field === "incomeFee") {
    app.fees[idx][field] = Number(value) || 0;
  } else {
    app.fees[idx][field] = String(value).trim();
  }
}

function addFeeRow() {
  app.fees.push({ resultType: "새 유형", incomeFee: 0, validFrom: formatDateLocal(new Date()), validTo: "" });
  renderFees();
}

function removeFeeRow(idx) {
  app.fees.splice(idx, 1);
  renderFees();
}

async function saveFees() {
  const seen = new Set();
  const fees = app.fees
    .map(f => ({
      id: f.id,
      resultType: String(f.resultType || "").trim(),
      incomeFee: Number(f.incomeFee) || 0,
      validFrom: String(f.validFrom || "").trim() || "2026-04-01"
    }))
    .filter(f => f.resultType)
    .filter(f => {
      if (seen.has(f.resultType)) return false;
      seen.add(f.resultType);
      return true;
    });

  try {
    const result = await apiFetch("/api/fees", {
      method: "POST",
      body: JSON.stringify({ action: "saveCurrent", fees })
    });

    app.fees = result.fees || fees;
    app.allFees = result.allFees || app.fees;
    renderFees();
    renderIncome();
    showToast("현재 단가표가 저장되었습니다.");
  } catch (err) {
    showToast("단가표 저장 실패: " + err.message, true);
  }
}

function openNewRateModal() {
  const today = formatDateLocal(new Date());
  const dateInput = document.getElementById("new-rate-valid-from");
  dateInput.value = today;

  const tbody = document.getElementById("new-rate-tbody");
  tbody.innerHTML = app.fees.map((f, i) => `
    <tr>
      <td>${escapeHtml(f.resultType || "")}</td>
      <td style="text-align:right">${won(f.incomeFee || 0)}</td>
      <td>
        <input type="number" value="${Number(f.incomeFee || 0)}" data-result-type="${escapeHtml(f.resultType || "")}" style="text-align:right">
      </td>
    </tr>
  `).join("");

  document.getElementById("new-rate-modal").classList.add("open");
}

async function saveNewRates() {
  const validFrom = document.getElementById("new-rate-valid-from").value;
  if (!validFrom) {
    showToast("신규 단가 적용시작일을 입력하세요.", true);
    return;
  }

  const inputs = [...document.querySelectorAll("#new-rate-tbody input[data-result-type]")];
  const fees = inputs.map(input => ({
    resultType: input.dataset.resultType,
    incomeFee: Number(input.value) || 0
  })).filter(f => f.resultType);

  const msg =
    `신규 단가를 ${validFrom}부터 적용합니다.\n\n` +
    `기존 현재 단가는 ${addDaysToDate(validFrom, -1)}까지로 자동 종료됩니다.\n` +
    `신규 단가 ${fees.length}건을 저장하시겠습니까?`;

  if (!confirm(msg)) return;

  try {
    const result = await apiFetch("/api/fees", {
      method: "POST",
      body: JSON.stringify({ action: "applyNewRates", validFrom, fees })
    });

    app.fees = result.fees || [];
    app.allFees = result.allFees || app.fees;
    closeModal("new-rate-modal");
    renderFees();
    renderIncome();
    showToast("신규 단가가 적용되었습니다.");
  } catch (err) {
    showToast("신규 단가 저장 실패: " + err.message, true);
  }
}

function showFeeHistory(resultType) {
  document.getElementById("fee-history-title").textContent = `단가 이력 - ${resultType}`;
  const tbody = document.getElementById("fee-history-tbody");
  const rows = (app.allFees || [])
    .filter(f => f.resultType === resultType)
    .sort((a, b) => String(a.validFrom || "").localeCompare(String(b.validFrom || "")));

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">단가 이력이 없습니다.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(f => `
      <tr>
        <td>${escapeHtml(f.validFrom || "-")}</td>
        <td>${f.validTo ? escapeHtml(f.validTo) : '<span class="badge-pill badge-done">현재</span>'}</td>
        <td style="text-align:right">${won(f.incomeFee || 0)}</td>
        <td style="text-align:center">${f.isCurrent ? "현재" : "과거"}</td>
      </tr>
    `).join("");
  }

  document.getElementById("fee-history-modal").classList.add("open");
}

function addDaysToDate(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return formatDateLocal(dt);
}

function getEffectiveFee(resultType, completeDate) {
  if (!resultType || !completeDate) return 0;

  const rows = (app.allFees || [])
    .filter(f => f.resultType === resultType)
    .filter(f => {
      const from = f.validFrom || "0000-00-00";
      const to = f.validTo || "9999-12-31";
      return compareDate(from, completeDate) <= 0 && compareDate(to, completeDate) >= 0;
    })
    .sort((a, b) => String(b.validFrom || "").localeCompare(String(a.validFrom || "")));

  return Number(rows[0]?.incomeFee || 0);
}

function getIncomeDateRange() {
  ensureIncomeDateDefaults();
  return {
    start: document.getElementById("ie-start").value,
    end: document.getElementById("ie-end").value
  };
}

function resetIncomeFilter() {
  setDateRangeInputs("ie-start", "ie-end");
  renderIncome();
}

function calculateIncome(start, end) {
  const byType = {};
  let total = 0;

  app.jobs.forEach(j => {
    if (j.status !== "완료") return;
    if (!j.completeDate) return;
    if (start && compareDate(j.completeDate, start) < 0) return;
    if (end && compareDate(j.completeDate, end) > 0) return;

    const type = j.resultType || "미분류";
    const fee = getEffectiveFee(type, j.completeDate);

    if (!byType[type]) byType[type] = { count: 0, amount: 0, rates: new Set() };
    byType[type].count += 1;
    byType[type].amount += fee;
    byType[type].rates.add(fee);
    total += fee;
  });

  Object.values(byType).forEach(v => {
    const rates = [...v.rates];
    v.fee = rates.length === 1 ? rates[0] : null;
    v.feeLabel = rates.length === 1 ? won(rates[0]) : "기간별 적용";
  });

  return { total, byType };
}

function calculateExpense(start, end) {
  let total = 0;
  const monthly = app.expenses.monthlyExpenses || {};

  for (const [monthKey, items] of Object.entries(monthly)) {
    if (!monthOverlapsRange(monthKey, start, end)) continue;
    EXPENSE_ITEMS.forEach(item => total += Number(items[item]) || 0);
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

  const totalCount = rows.reduce((sum, [, v]) => sum + Number(v.count || 0), 0);
  const totalAmount = rows.reduce((sum, [, v]) => sum + Number(v.amount || 0), 0);

  const totalCountEl = document.getElementById("income-detail-total-count");
  const totalAmountEl = document.getElementById("income-detail-total-amount");
  if (totalCountEl) totalCountEl.textContent = `${totalCount.toLocaleString()}건`;
  if (totalAmountEl) totalAmountEl.textContent = won(totalAmount);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted">완료 데이터가 없습니다.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(([type, v]) => `
      <tr>
        <td>${escapeHtml(type)}</td>
        <td>${escapeHtml(v.feeLabel)}</td>
        <td>${v.count.toLocaleString()}건</td>
        <td class="amount-cell">${won(v.amount)}</td>
      </tr>
    `).join("");
  }

  renderIncomeCharts(income.byType);
}

function renderIncomeCharts(byType) {
  const labels = Object.keys(byType);
  const amounts = labels.map(l => byType[l].amount);
  const counts = labels.map(l => byType[l].count || 0);

  const ctx1 = document.getElementById("income-type-chart");
  if (app.incomeTypeChart) app.incomeTypeChart.destroy();
  app.incomeTypeChart = new Chart(ctx1, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: amounts, counts }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "right" },
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.label || "";
              const amount = Number(context.raw || 0);
              const count = Number(context.dataset.counts?.[context.dataIndex] || 0);
              return `${label}: ${won(amount)} / ${count.toLocaleString()}건`;
            }
          }
        }
      }
    }
  });

  const { start, end } = getIncomeDateRange();
  const months = monthsInRange(start, end);
  const incomeData = months.map(m => {
    const range = clipMonthRange(m, start, end);
    const { total } = calculateIncome(range.start, range.end);
    return total;
  });
  const expenseData = months.map(m => calculateExpense(`${m}-01`, lastDayOfMonth(m)));

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

function monthsInRange(start, end) {
  const arr = [];
  if (!start || !end) return arr;

  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;

  while (y < ey || (y === ey && m <= em)) {
    arr.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (arr.length > 120) break;
  }

  return arr;
}

function lastDayOfMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m, 0);
  return formatDateLocal(d);
}

function clipMonthRange(monthKey, rangeStart, rangeEnd) {
  const monthStart = `${monthKey}-01`;
  const monthEnd = lastDayOfMonth(monthKey);
  return {
    start: compareDate(monthStart, rangeStart) < 0 ? rangeStart : monthStart,
    end: compareDate(monthEnd, rangeEnd) > 0 ? rangeEnd : monthEnd
  };
}

function monthOverlapsRange(monthKey, rangeStart, rangeEnd) {
  const monthStart = `${monthKey}-01`;
  const monthEnd = lastDayOfMonth(monthKey);
  if (rangeStart && compareDate(monthEnd, rangeStart) < 0) return false;
  if (rangeEnd && compareDate(monthStart, rangeEnd) > 0) return false;
  return true;
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

  renderExpenseChart();
}

async function saveExpenses() {
  try {
    await apiFetch("/api/expenses", {
      method: "POST",
      body: JSON.stringify({
        monthlyExpenses: app.expenses.monthlyExpenses || {}
      })
    });

    await loadExpenses();
    renderExpense();
    renderIncome();

    showToast("지출 데이터가 저장되었습니다.");
  } catch (err) {
    console.error(err);
    showToast("지출 데이터 저장 실패: " + err.message, true);
  }
}

async function saveExpense() {
  return saveExpenses();
}

function updateMonthlyExpense(monthKey, item, value) {
  if (!app.expenses.monthlyExpenses[monthKey]) app.expenses.monthlyExpenses[monthKey] = {};
  app.expenses.monthlyExpenses[monthKey][item] = Number(value) || 0;

  const items = app.expenses.monthlyExpenses[monthKey];
  const total = EXPENSE_ITEMS.reduce((sum, name) => sum + (Number(items[name]) || 0), 0);
  const el = document.getElementById(`expense-total-${monthKey}`);
  if (el) el.innerHTML = `<span>합계</span><span>${won(total)}</span>`;
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
