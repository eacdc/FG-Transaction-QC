(function () {
  'use strict';

  const cfg = window.AppConfig || {};
  const API_BASE = cfg.apiBaseUrl || 'http://127.0.0.1:3001/api';
  const FROM_GPN_DATE = cfg.fromGPNDate || '2026-08-01';
  const PAGE_SIZE = Number(cfg.pageSize || 25);
  const SHIFT_HOURS = Number(cfg.shiftHours || 8);
  const SEVERITY_ORDER = ['Critical', 'Major', 'Minor'];
  const INSPECTOR_KEY = 'fgqc-inspector';
  const DB_KEY = 'fgqc-database';
  const DRAFT_PREFIX = 'fgqc-draft-';
  const PENDING_ROW_KEY = 'fgqc-pending-row';
  const RESULT_KEY = 'fgqc-last-result';

  const els = {
    inspector: document.getElementById('inspector'),
    database: document.getElementById('database'),
    globalStatus: document.getElementById('global-status'),
    mainTabs: document.getElementById('main-tabs'),
    btnHome: document.getElementById('btn-home'),
    pendingSearch: document.getElementById('pending-search'),
    pendingUnit: document.getElementById('pending-unit'),
    pendingMeta: document.getElementById('pending-meta'),
    pendingBody: document.getElementById('pending-body'),
    pendingPager: document.getElementById('pending-pager'),
    pendingPageLabel: document.getElementById('pending-page-label'),
    btnPendingRefresh: document.getElementById('btn-pending-refresh'),
    btnPendingPrev: document.getElementById('btn-pending-prev'),
    btnPendingNext: document.getElementById('btn-pending-next'),
    dashFrom: document.getElementById('dash-from'),
    dashTo: document.getElementById('dash-to'),
    dashUnit: document.getElementById('dash-unit'),
    dashJob: document.getElementById('dash-job'),
    dashKpis: document.getElementById('dash-kpis'),
    dashBody: document.getElementById('dash-body'),
    dashPager: document.getElementById('dash-pager'),
    dashPageLabel: document.getElementById('dash-page-label'),
    dashTableTitle: document.getElementById('dash-table-title'),
    btnDashLoad: document.getElementById('btn-dash-load'),
    btnDashPrev: document.getElementById('btn-dash-prev'),
    btnDashNext: document.getElementById('btn-dash-next'),
    chartDefects: document.getElementById('chart-defects'),
    chartTrend: document.getElementById('chart-trend'),
    chartClass: document.getElementById('chart-class'),
    chartUnit: document.getElementById('chart-unit'),
    formRejectBanner: document.getElementById('form-reject-banner'),
    formPlanBanner: document.getElementById('form-plan-banner'),
    formPrevBanner: document.getElementById('form-prev-banner'),
    planLotLine: document.getElementById('plan-lot-line'),
    planAcceptLine: document.getElementById('plan-accept-line'),
    formHeader: document.getElementById('form-header'),
    sampleSize: document.getElementById('sample-size'),
    formSections: document.getElementById('form-sections'),
    formRemark: document.getElementById('form-remark'),
    remarkRequired: document.getElementById('remark-required'),
    formError: document.getElementById('form-error'),
    btnSubmit: document.getElementById('btn-submit'),
    btnFormBack: document.getElementById('btn-form-back'),
    resultCard: document.getElementById('result-card'),
    btnResultList: document.getElementById('btn-result-list'),
    btnResultDetail: document.getElementById('btn-result-detail'),
    detailCard: document.getElementById('detail-card'),
    btnDetailBack: document.getElementById('btn-detail-back')
  };

  const state = {
    view: 'pending',
    pendingPage: 1,
    pendingTotal: 0,
    pendingRows: [],
    dashPage: 1,
    dashTotal: 0,
    dashStatusFilter: '',
    dashLoaded: false,
    lot: null,
    template: null,
    counts: {},
    lastResult: null,
    detailBack: 'dashboard'
  };

  let searchTimer = null;
  let draftTimer = null;
  let unitsLoaded = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Math.round(n).toLocaleString('en-IN');
  }

  function fmtNum(value, digits) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-IN', { maximumFractionDigits: digits == null ? 1 : digits });
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function toDateInput(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function waitingLabel(gpnDate) {
    if (!gpnDate) return { text: '—', overShift: false };
    const d = new Date(gpnDate);
    if (Number.isNaN(d.getTime())) return { text: '—', overShift: false };
    const ms = Date.now() - d.getTime();
    const hours = Math.max(0, ms / 3600000);
    const overShift = hours >= SHIFT_HOURS;
    if (hours < 24) {
      const h = Math.max(1, Math.round(hours));
      return { text: h + 'h', overShift };
    }
    const days = Math.floor(hours / 24);
    return { text: days + 'd', overShift: true };
  }

  function statusClass(reasonOrStatus) {
    const s = String(reasonOrStatus || '').toLowerCase();
    if (s.includes('rework') || s === 'rejected') return 'st-rework';
    if (s.includes('no sampling') || s === 'pending') return 'st-noplan';
    if (s.includes('incomplete') || s === 'in progress') return 'st-incomplete';
    if (s === 'accepted') return 'st-accepted';
    if (s.includes('not started')) return 'st-new';
    return 'st-new';
  }

  function statusWord(reasonOrStatus) {
    const s = String(reasonOrStatus || '').trim();
    if (!s) return 'Not started';
    if (s === 'Pending') return 'Pending review';
    return s;
  }

  function pill(text, extraClass) {
    return `<span class="status-pill ${extraClass || statusClass(text)}">${escapeHtml(statusWord(text))}</span>`;
  }

  function showStatus(message, isError) {
    if (!message) {
      els.globalStatus.hidden = true;
      els.globalStatus.textContent = '';
      return;
    }
    els.globalStatus.hidden = false;
    els.globalStatus.textContent = message;
    els.globalStatus.classList.toggle('is-error', !!isError);
  }

  function qs(params) {
    const u = new URLSearchParams();
    Object.keys(params).forEach((k) => {
      const v = params[k];
      if (v == null || v === '') return;
      u.set(k, String(v));
    });
    return u.toString();
  }

  async function api(path, options) {
    const opts = options || {};
    const url = API_BASE + path;
    let res;
    try {
      res = await fetch(url, {
        method: opts.method || 'GET',
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (networkErr) {
      throw new Error(
        'Cannot reach the API at ' + url + '. Start the CDC backend on port 3001 (and restart it if FG QC routes were just added).'
      );
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === false || data.success === false) {
      const err = new Error(data.error || data.message || ('Request failed (' + res.status + ') at ' + url));
      err.data = data;
      throw err;
    }
    return data;
  }

  function db() {
    return els.database.value || cfg.defaultDatabase || 'KOL';
  }

  function inspectorId() {
    const n = Number(els.inspector.value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function inspectorName() {
    const opt = els.inspector.selectedOptions[0];
    return opt ? opt.textContent : '';
  }

  function companyId() {
    return Number(cfg.companyId || 1);
  }

  function commonParams() {
    return { database: db(), companyId: companyId() };
  }

  function parseHash() {
    const raw = (location.hash || '#pending').replace(/^#/, '');
    const [viewPart, queryPart] = raw.split('?');
    const view = viewPart || 'pending';
    const params = {};
    new URLSearchParams(queryPart || '').forEach((v, k) => { params[k] = v; });
    return { view, params };
  }

  function setHash(view, params) {
    const q = params ? qs(params) : '';
    const next = '#' + view + (q ? '?' + q : '');
    if (location.hash === next) {
      route();
      return;
    }
    location.hash = next;
  }

  function showView(view) {
    state.view = view;
    showStatus('');
    document.querySelectorAll('.view').forEach((el) => {
      el.hidden = el.getAttribute('data-view') !== view;
    });
    const showTabs = view === 'pending' || view === 'dashboard';
    els.mainTabs.hidden = !showTabs;
    els.mainTabs.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.getAttribute('data-view') === view);
    });
  }

  function draftKey(lot) {
    return DRAFT_PREFIX + lot.jobBookingId + '-' + lot.fgTransactionId;
  }

  function readDraft(lot) {
    try {
      return JSON.parse(localStorage.getItem(draftKey(lot)) || 'null');
    } catch {
      return null;
    }
  }

  function writeDraft() {
    if (!state.lot) return;
    const payload = {
      sampleSize: Number(els.sampleSize.value) || 0,
      remark: els.formRemark.value || '',
      counts: state.counts,
      savedAt: Date.now()
    };
    localStorage.setItem(draftKey(state.lot), JSON.stringify(payload));
  }

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDraft, 400);
  }

  function clearDraft(lot) {
    if (!lot) return;
    localStorage.removeItem(draftKey(lot));
  }

  function normalizeSeverity(value) {
    const s = String(value || '').trim().toLowerCase();
    if (s.startsWith('crit')) return 'Critical';
    if (s.startsWith('maj')) return 'Major';
    return 'Minor';
  }

  function itemKey(item) {
    return String(item.fgqcParameterSettingID || item.characterstics);
  }

  function countFor(item) {
    const key = itemKey(item);
    const row = state.counts[key] || { critical: 0, major: 0, minor: 0, remark: '' };
    const sev = normalizeSeverity(item.severity);
    if (sev === 'Critical') return Number(row.critical) || 0;
    if (sev === 'Major') return Number(row.major) || 0;
    return Number(row.minor) || 0;
  }

  function setCount(item, value, remark) {
    const key = itemKey(item);
    const sev = normalizeSeverity(item.severity);
    const n = Math.max(0, Math.trunc(Number(value) || 0));
    const prev = state.counts[key] || { critical: 0, major: 0, minor: 0, remark: '' };
    state.counts[key] = {
      critical: sev === 'Critical' ? n : 0,
      major: sev === 'Major' ? n : 0,
      minor: sev === 'Minor' ? n : 0,
      remark: remark == null ? prev.remark : String(remark)
    };
  }

  function classTotals() {
    const totals = { Critical: 0, Major: 0, Minor: 0 };
    (state.template?.items || []).forEach((item) => {
      const sev = normalizeSeverity(item.severity);
      totals[sev] += countFor(item);
    });
    return totals;
  }

  function acceptNumbers() {
    const aql = state.template?.referenceAQL || {};
    return {
      Critical: aql.critical == null ? 0 : Number(aql.critical),
      Major: aql.major == null ? null : Number(aql.major),
      Minor: aql.minor == null ? null : Number(aql.minor)
    };
  }

  function classState(sev, found, accept) {
    if (accept == null || Number.isNaN(accept)) return 'unknown';
    if (found > accept) return 'over';
    if (found === accept && found > 0) return 'limit';
    return 'ok';
  }

  function liveFlags() {
    const totals = classTotals();
    const accept = acceptNumbers();
    const flags = {};
    SEVERITY_ORDER.forEach((sev) => {
      flags[sev] = {
        found: totals[sev],
        accept: accept[sev],
        state: classState(sev, totals[sev], accept[sev])
      };
    });
    return flags;
  }

  function renderPlanBand() {
    const t = state.template;
    if (!t) return;
    els.planLotLine.textContent =
      'Lot ' + fmtInt(t.lotSize) + ' inner cartons  →  Required sample ' + fmtInt(t.sampleSize);
    const a = t.referenceAQL || {};
    els.planAcceptLine.textContent =
      'Accept:  Critical ' + fmtInt(a.critical) + '  ·  Major ' + fmtInt(a.major) + '  ·  Minor ' + fmtInt(a.minor);
    const noPlan = t.planFound === false;
    els.formPlanBanner.hidden = !noPlan;
    els.formPlanBanner.textContent = noPlan
      ? 'No sampling plan covers this lot size. You can still fill the sheet — it will be saved as Pending review.'
      : '';
  }

  function renderFormHeader() {
    const lot = state.lot || {};
    const cells = [
      ['GPN No', lot.gpnNo],
      ['Job No', lot.jobNo],
      ['Job Name', lot.jobName],
      ['Client', lot.client],
      ['GPN Date', fmtDate(lot.gpnDate)],
      ['Shift', lot.shift || '—'],
      ['Inspector', inspectorName() || 'Select inspector']
    ];
    els.formHeader.innerHTML = cells.map(([k, v]) => (
      '<div class="kv"><dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v == null || v === '' ? '—' : v) + '</dd></div>'
    )).join('');

    const prev = Number(lot.submissionCount) > 0;
    els.formPrevBanner.hidden = !prev;
    if (prev) {
      els.formPrevBanner.innerHTML =
        'Previous verdict on this lot: <strong>' + escapeHtml(statusWord(lot.qcStatus || 'Inspected')) + '</strong>'
        + ' — found Critical ' + fmtInt(lot.foundCritical)
        + ', Major ' + fmtInt(lot.foundMajor)
        + ', Minor ' + fmtInt(lot.foundMinor)
        + '. This submission starts from zero. Earlier counts are history and are not carried forward.';
    }
  }

  function renderSections() {
    const items = state.template?.items || [];
    const grouped = { Critical: [], Major: [], Minor: [] };
    items.forEach((item) => grouped[normalizeSeverity(item.severity)].push(item));
    const flags = liveFlags();

    els.formSections.innerHTML = SEVERITY_ORDER.map((sev) => {
      const rows = grouped[sev];
      if (!rows.length) return '';
      const flag = flags[sev];
      const headClass = flag.state === 'over' ? 'is-over' : (flag.state === 'limit' ? 'is-limit' : '');
      let headExtra = fmtInt(flag.found) + ' / ' + fmtInt(flag.accept);
      if (flag.state === 'limit') headExtra += ' — at limit';
      if (flag.state === 'over') headExtra += ' — over limit';
      const offender = flag.state === 'over'
        ? rows.reduce((best, item) => (countFor(item) > countFor(best) ? item : best), rows[0])
        : null;

      return (
        '<article class="severity-block" data-severity="' + sev + '">'
        + '<header class="severity-head ' + headClass + '"><span>' + sev + '</span><span>' + escapeHtml(headExtra) + '</span></header>'
        + rows.map((item) => {
          const key = itemKey(item);
          const n = countFor(item);
          const isOff = offender && itemKey(offender) === key && n > 0;
          const remark = (state.counts[key] && state.counts[key].remark) || '';
          return (
            '<div class="defect-row' + (isOff ? ' is-offender' : '') + '" data-key="' + escapeHtml(key) + '">'
            + '<div class="defect-name">' + escapeHtml(item.characterstics || 'Characteristic') + '</div>'
            + '<div class="stepper">'
            + '<button type="button" class="stepper-btn" data-item-step="-1" data-key="' + escapeHtml(key) + '" aria-label="Decrease">−</button>'
            + '<input class="count-input" type="number" inputmode="numeric" min="0" step="1" data-key="' + escapeHtml(key) + '" value="' + n + '" />'
            + '<button type="button" class="stepper-btn" data-item-step="1" data-key="' + escapeHtml(key) + '" aria-label="Increase">+</button>'
            + '</div>'
            + '<input class="line-remark" type="text" data-key="' + escapeHtml(key) + '" placeholder="Line remark (optional)" value="' + escapeHtml(remark) + '" />'
            + '</div>'
          );
        }).join('')
        + '</article>'
      );
    }).join('');

    updateLiveFlags();
  }

  function updateLiveFlags() {
    const items = state.template?.items || [];
    const grouped = { Critical: [], Major: [], Minor: [] };
    items.forEach((item) => grouped[normalizeSeverity(item.severity)].push(item));
    const flags = liveFlags();

    SEVERITY_ORDER.forEach((sev) => {
      const block = els.formSections.querySelector('[data-severity="' + sev + '"]');
      if (!block) return;
      const flag = flags[sev];
      const head = block.querySelector('.severity-head');
      if (head) {
        head.classList.toggle('is-over', flag.state === 'over');
        head.classList.toggle('is-limit', flag.state === 'limit');
        let extra = fmtInt(flag.found) + ' / ' + fmtInt(flag.accept);
        if (flag.state === 'limit') extra += ' — at limit';
        if (flag.state === 'over') extra += ' — over limit';
        const label = head.querySelector('span:last-child');
        if (label) label.textContent = extra;
      }
      const rows = grouped[sev];
      const offender = flag.state === 'over' && rows.length
        ? rows.reduce((best, item) => (countFor(item) > countFor(best) ? item : best), rows[0])
        : null;
      block.querySelectorAll('.defect-row').forEach((rowEl) => {
        const key = rowEl.getAttribute('data-key');
        const item = findItem(key);
        const n = item ? countFor(item) : 0;
        const input = rowEl.querySelector('.count-input');
        if (input && document.activeElement !== input && String(input.value) !== String(n)) {
          input.value = String(n);
        }
        rowEl.classList.toggle('is-offender', !!(offender && itemKey(offender) === key && n > 0));
      });
    });

    const over = SEVERITY_ORDER.filter((sev) => flags[sev].state === 'over');
    const anyOver = over.length > 0;
    els.remarkRequired.hidden = !anyOver;
    if (anyOver) {
      const parts = over.map((sev) => {
        const f = flags[sev];
        if (sev === 'Critical') {
          return 'one critical defect rejects the lot (found ' + fmtInt(f.found) + ', accept 0)';
        }
        return sev + ' ' + fmtInt(f.found) + ' / accept ' + fmtInt(f.accept);
      });
      els.formRejectBanner.hidden = false;
      els.formRejectBanner.textContent = 'This lot will be Rejected: ' + parts.join('; ') + '. You can still submit — a rejected lot is a result, not an error.';
    } else {
      els.formRejectBanner.hidden = true;
      els.formRejectBanner.textContent = '';
    }
  }

  function refreshFormFlags() {
    updateLiveFlags();
    scheduleDraft();
  }

  function clientValidate() {
    const sample = Math.trunc(Number(els.sampleSize.value) || 0);
    const lotSize = Number(state.template?.lotSize);
    if (sample <= 0) return 'Cartons inspected must be greater than zero.';
    if (Number.isFinite(lotSize) && sample > lotSize) {
      return 'Cartons inspected (' + fmtInt(sample) + ') cannot exceed the lot size (' + fmtInt(lotSize) + ' inner cartons).';
    }
    const items = state.template?.items || [];
    let total = 0;
    for (const item of items) {
      const n = countFor(item);
      if (!Number.isInteger(n) || n < 0) return 'Counts must be non-negative integers.';
      total += n;
    }
    if (total > sample) {
      return 'Total defects (' + fmtInt(total) + ') exceed the sample size (' + fmtInt(sample) + '). Check the counts.';
    }
    const flags = liveFlags();
    const over = SEVERITY_ORDER.some((sev) => flags[sev].state === 'over');
    if (over && !String(els.formRemark.value || '').trim()) {
      return 'A class is over its accept number. Enter a remark before submitting.';
    }
    if (!inspectorId()) return 'Select the inspector before submitting.';
    return null;
  }

  function showFormError(message) {
    els.formError.hidden = !message;
    els.formError.textContent = message || '';
  }

  async function loadInspectors() {
    const saved = localStorage.getItem(INSPECTOR_KEY) || '';
    els.inspector.innerHTML = '<option value="">Select inspector…</option>';
    try {
      const data = await api('/qc/inspectors?' + qs(commonParams()));
      (data.rows || []).forEach((row) => {
        const opt = document.createElement('option');
        opt.value = String(row.userId);
        opt.textContent = row.userName;
        if (String(row.userId) === saved) opt.selected = true;
        els.inspector.appendChild(opt);
      });
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  async function loadUnits() {
    if (unitsLoaded) return;
    try {
      const data = await api('/qc/units?' + qs(commonParams()));
      const opts = (data.rows || []).map((row) => (
        '<option value="' + escapeHtml(row.productionUnitId) + '">' + escapeHtml(row.productionUnitName) + '</option>'
      )).join('');
      els.pendingUnit.insertAdjacentHTML('beforeend', opts);
      els.dashUnit.insertAdjacentHTML('beforeend', opts);
      unitsLoaded = true;
    } catch {
      unitsLoaded = true;
    }
  }

  async function loadPending() {
    showStatus('Loading lots awaiting inspection…');
    els.pendingBody.innerHTML = '<tr><td colspan="11" class="empty">Loading lots awaiting inspection…</td></tr>';
    try {
      const data = await api('/qc/pending?' + qs({
        ...commonParams(),
        search: els.pendingSearch.value.trim(),
        fromGPNDate: FROM_GPN_DATE,
        page: state.pendingPage,
        pageSize: PAGE_SIZE,
        unitId: els.pendingUnit.value
      }));
      state.pendingRows = data.rows || [];
      state.pendingTotal = Number(data.total) || 0;
      renderPending();
      showStatus('');
    } catch (err) {
      els.pendingBody.innerHTML = '<tr><td colspan="11" class="empty">' + escapeHtml(err.message) + '</td></tr>';
      els.pendingMeta.textContent = '';
      els.pendingPager.hidden = true;
      showStatus(err.message, true);
    }
  }

  function renderPending() {
    const rows = state.pendingRows;
    if (!rows.length) {
      els.pendingBody.innerHTML = '<tr><td colspan="11" class="empty">No lots waiting for inspection.</td></tr>';
    } else {
      els.pendingBody.innerHTML = rows.map((row, idx) => {
        const wait = waitingLabel(row.gpnDate);
        const reason = row.pendingReason || 'Not started';
        const isRework = /rework|rejected/i.test(reason);
        const reinspect = Number(row.submissionCount) > 0;
        const btnLabel = reinspect ? 'Re-inspect' : 'Start QC';
        const rowClass = [isRework ? 'row-rework' : '', wait.overShift ? 'row-overshift' : ''].filter(Boolean).join(' ');
        return (
          '<tr class="' + rowClass + '">'
          + '<td>' + escapeHtml(row.gpnNo || '—') + '</td>'
          + '<td>' + escapeHtml(fmtDate(row.gpnDate)) + '</td>'
          + '<td>' + escapeHtml(wait.text) + '</td>'
          + '<td>' + escapeHtml(row.jobNo || '—') + '</td>'
          + '<td>' + escapeHtml(row.jobName || '—') + '</td>'
          + '<td>' + escapeHtml(row.client || '—') + '</td>'
          + '<td>' + escapeHtml(row.categoryName || '—') + '</td>'
          + '<td class="num">' + escapeHtml(fmtInt(row.lotSize)) + '</td>'
          + '<td class="num">' + escapeHtml(fmtInt(row.requiredSample)) + '</td>'
          + '<td>' + pill(reason) + '</td>'
          + '<td><button type="button" class="btn-primary" data-start="' + idx + '">' + escapeHtml(btnLabel) + '</button></td>'
          + '</tr>'
        );
      }).join('');
    }
    const from = state.pendingTotal ? (state.pendingPage - 1) * PAGE_SIZE + 1 : 0;
    const to = Math.min(state.pendingPage * PAGE_SIZE, state.pendingTotal);
    els.pendingMeta.textContent = state.pendingTotal
      ? ('Showing ' + from + '–' + to + ' of ' + state.pendingTotal + ' lots. Oldest GPN first. Lot size is inner cartons.')
      : '';
    const pages = Math.max(1, Math.ceil(state.pendingTotal / PAGE_SIZE));
    els.pendingPager.hidden = state.pendingTotal <= PAGE_SIZE;
    els.pendingPageLabel.textContent = 'Page ' + state.pendingPage + ' of ' + pages;
    els.btnPendingPrev.disabled = state.pendingPage <= 1;
    els.btnPendingNext.disabled = state.pendingPage >= pages;
  }

  async function openForm(lot) {
    sessionStorage.setItem(PENDING_ROW_KEY, JSON.stringify(lot));
    setHash('form', {
      jobBookingId: lot.jobBookingId,
      fgTransactionId: lot.fgTransactionId,
      categoryId: lot.categoryId,
      lotSize: lot.lotSize
    });
  }

  async function loadForm(params) {
    showView('form');
    showFormError('');
    let lot = null;
    try { lot = JSON.parse(sessionStorage.getItem(PENDING_ROW_KEY) || 'null'); } catch { lot = null; }
    if (!lot || String(lot.jobBookingId) !== String(params.jobBookingId) || String(lot.fgTransactionId) !== String(params.fgTransactionId)) {
      lot = {
        jobBookingId: Number(params.jobBookingId),
        fgTransactionId: Number(params.fgTransactionId),
        categoryId: Number(params.categoryId),
        lotSize: Number(params.lotSize)
      };
    }
    state.lot = lot;
    state.template = null;
    state.counts = {};
    els.formSections.innerHTML = '<p class="empty">Loading inspection sheet…</p>';
    els.planLotLine.textContent = 'Loading sampling plan…';
    els.planAcceptLine.textContent = '';
    renderFormHeader();

    if (!lot.categoryId || lot.lotSize == null) {
      showFormError('This form needs categoryId and lotSize (inner cartons) on the URL. Open it from the awaiting list.');
      return;
    }

    try {
      const template = await api('/qc/template?' + qs({
        ...commonParams(),
        categoryId: lot.categoryId,
        lotSize: lot.lotSize
      }));
      state.template = template;
      if (!template.planFound && Number(lot.requiredSample) > 0) {
        template.sampleSize = Number(lot.requiredSample);
        template.planFound = true;
      }
      const draft = readDraft(lot);
      (template.items || []).forEach((item) => {
        const key = itemKey(item);
        const saved = draft && draft.counts && draft.counts[key];
        if (saved) {
          state.counts[key] = {
            critical: Number(saved.critical) || 0,
            major: Number(saved.major) || 0,
            minor: Number(saved.minor) || 0,
            remark: saved.remark || ''
          };
        } else {
          setCount(item, 0, '');
        }
      });
      const defaultSample = Number(template.sampleSize) || Number(lot.requiredSample) || 0;
      els.sampleSize.value = String((draft && draft.sampleSize) || defaultSample);
      els.formRemark.value = (draft && draft.remark) || '';
      renderPlanBand();
      renderFormHeader();
      renderSections();
    } catch (err) {
      showFormError(err.message);
    }
  }

  async function submitInspection() {
    const message = clientValidate();
    if (message) {
      showFormError(message);
      return;
    }
    showFormError('');
    els.btnSubmit.disabled = true;
    els.btnSubmit.textContent = 'Submitting…';
    const lot = state.lot;
    const payload = {
      database: db(),
      userId: inspectorId(),
      companyID: companyId(),
      categoryID: lot.categoryId,
      jobBookingID: lot.jobBookingId,
      fgTransactionID: lot.fgTransactionId,
      sampleSize: Math.trunc(Number(els.sampleSize.value) || 0),
      samplingMethodType: 'Carter',
      packingDescription: '',
      remark: String(els.formRemark.value || '').trim(),
      productionUnitID: lot.productionUnitId || null,
      items: (state.template.items || []).map((item) => {
        const key = itemKey(item);
        const row = state.counts[key] || { critical: 0, major: 0, minor: 0, remark: '' };
        return {
          fgqcParameterSettingID: item.fgqcParameterSettingID,
          characterstics: item.characterstics,
          critical: Number(row.critical) || 0,
          major: Number(row.major) || 0,
          minor: Number(row.minor) || 0,
          remark: row.remark || ''
        };
      })
    };
    try {
      const result = await api('/qc/inspections', { method: 'POST', body: payload });
      clearDraft(lot);
      state.lastResult = result;
      sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
      setHash('result');
    } catch (err) {
      showFormError(err.message);
    } finally {
      els.btnSubmit.disabled = false;
      els.btnSubmit.textContent = 'Submit inspection';
    }
  }

  function renderResult() {
    showView('result');
    let result = state.lastResult;
    if (!result) {
      try { result = JSON.parse(sessionStorage.getItem(RESULT_KEY) || 'null'); } catch { result = null; }
    }
    if (!result) {
      els.resultCard.innerHTML = '<p class="empty">No inspection result to show.</p>';
      return;
    }
    state.lastResult = result;
    const status = result.qcStatus || '';
    const fail = /reject/i.test(status);
    const pending = /^pending$/i.test(status);
    const next = fail
      ? '<div class="next-steps"><strong>What to do next.</strong> Rework the lot, then open it again from Awaiting inspection and re-inspect. This submission’s counts are not carried forward — the next inspection starts clean.</div>'
      : pending
        ? '<div class="next-steps"><strong>Pending review.</strong> No sampling plan covered this lot size. A QC in-charge needs to resolve the verdict. The counts are saved.</div>'
        : '<div class="next-steps">Lot recorded. If sample size was short of the plan, it stays in the queue as sample incomplete.</div>';

    function cmp(label, found, accept) {
      const over = found != null && accept != null && Number(found) > Number(accept);
      return (
        '<div class="compare' + (over ? ' is-fail' : '') + '">'
        + '<div class="label">' + escapeHtml(label) + '</div>'
        + '<div class="nums">' + fmtInt(found) + ' / ' + fmtInt(accept) + '</div>'
        + '<div class="label">found / accept</div>'
        + '</div>'
      );
    }

    els.resultCard.innerHTML =
      '<p class="meta-line">FGQC ' + escapeHtml(result.fgqcNo || '—') + '</p>'
      + '<div class="result-status">' + pill(status) + '</div>'
      + '<p>Lot ' + fmtInt(result.lotSize) + ' inner cartons · inspected ' + fmtInt(result.inspected)
      + ' · required sample ' + fmtInt(result.requiredSample) + '</p>'
      + (result.defectPercent != null ? '<p>Defect % (information only): ' + fmtNum(result.defectPercent, 2) + '%</p>' : '')
      + '<div class="result-grid">'
      + cmp('Critical', result.criticalFound, result.criticalAccept)
      + cmp('Major', result.majorFound, result.majorAccept)
      + cmp('Minor', result.minorFound, result.minorAccept)
      + '</div>'
      + next;

    els.btnResultDetail.hidden = !result.mainID;
  }

  async function loadDetail(id) {
    showView('detail');
    els.detailCard.innerHTML = '<p class="empty">Loading inspection…</p>';
    try {
      const data = await api('/qc/inspections/' + encodeURIComponent(id) + '?' + qs(commonParams()));
      const main = data.main || {};
      const detail = data.detail || [];
      const aql = main.referenceAQL || {};
      els.detailCard.innerHTML =
        '<h2>Inspection ' + escapeHtml(main.fgqcNo || ('#' + id)) + ' ' + pill(main.qcStatus) + '</h2>'
        + '<div class="form-header" style="margin-top:12px">'
        + [['Job No', main.jobNo], ['Job Name', main.jobName], ['Client', main.client], ['GPN No', main.gpnNo],
          ['Inspector', main.inspector], ['Date', fmtDate(main.inspectedOn)],
          ['Lot size (inner cartons)', fmtInt(main.lotSize)], ['Sample size', fmtInt(main.sampleSize)]]
          .map(([k, v]) => '<div class="kv"><dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v || '—') + '</dd></div>').join('')
        + '</div>'
        + '<p class="plan-accept">Accept snapshot: Critical ' + fmtInt(aql.critical) + ' · Major ' + fmtInt(aql.major) + ' · Minor ' + fmtInt(aql.minor) + '</p>'
        + (main.remark ? '<p>Remark: ' + escapeHtml(main.remark) + '</p>' : '')
        + '<div class="table-wrap"><table class="data-table"><thead><tr><th>Characteristic</th><th class="num">Critical</th><th class="num">Major</th><th class="num">Minor</th><th>Remark</th></tr></thead><tbody>'
        + (detail.length ? detail.map((row) => (
          '<tr><td>' + escapeHtml(row.characterstics) + '</td><td class="num">' + fmtInt(row.critical)
          + '</td><td class="num">' + fmtInt(row.major) + '</td><td class="num">' + fmtInt(row.minor)
          + '</td><td>' + escapeHtml(row.remark || '') + '</td></tr>'
        )).join('') : '<tr><td colspan="5" class="empty">No detail rows.</td></tr>')
        + '</tbody></table></div>';
    } catch (err) {
      els.detailCard.innerHTML = '<p class="empty">' + escapeHtml(err.message) + '</p>';
    }
  }

  function stackedBar(label, parts, total, right) {
    const max = total || 1;
    const segs = parts.map((p) => {
      const w = Math.max(0, (Number(p.value) || 0) / max * 100);
      return '<span class="bar-seg ' + p.cls + '" style="width:' + w + '%"></span>';
    }).join('');
    return (
      '<div class="bar-row"><div>' + escapeHtml(label) + '</div>'
      + '<div class="bar-track">' + segs + '</div>'
      + '<div class="num">' + escapeHtml(right) + '</div></div>'
    );
  }

  function renderCharts(dash) {
    const defects = dash.topDefects || [];
    const maxDef = Math.max(1, ...defects.map((d) => Number(d.total) || 0));
    els.chartDefects.innerHTML = defects.length
      ? defects.map((d) => stackedBar(d.characterstics, [
        { value: d.critical, cls: 'critical' },
        { value: d.major, cls: 'major' },
        { value: d.minor, cls: 'minor' }
      ], maxDef, fmtInt(d.total))).join('')
      : '<p class="empty">No defect counts in this range.</p>';

    const trend = dash.trend || [];
    els.chartTrend.innerHTML = trend.length
      ? trend.map((t) => {
        const rate = t.acceptanceRate;
        return stackedBar(
          fmtDate(t.periodStart),
          [{ value: rate == null ? 0 : rate, cls: 'ok' }],
          100,
          (rate == null ? '—' : fmtNum(rate, 0) + '%') + ' (' + fmtInt(t.lotsInspected) + ')'
        );
      }).join('')
      : '<p class="empty">No inspections in this range.</p>';

    const byClass = dash.rejectionsByClass || {};
    const classRows = [
      ['Critical', byClass.critical, 'critical'],
      ['Major', byClass.major, 'major'],
      ['Minor', byClass.minor, 'minor']
    ];
    const maxClass = Math.max(1, ...classRows.map((r) => Number(r[1]) || 0));
    els.chartClass.innerHTML = classRows.map(([label, n, cls]) =>
      stackedBar(label, [{ value: n, cls }], maxClass, fmtInt(n))
    ).join('');

    const units = dash.rejectionsByUnit || [];
    const maxUnit = Math.max(1, ...units.map((u) => Number(u.rejectionCount) || 0));
    els.chartUnit.innerHTML = units.length
      ? units.map((u) => stackedBar(u.productionUnit, [{ value: u.rejectionCount, cls: 'plain' }], maxUnit, fmtInt(u.rejectionCount))).join('')
      : '<p class="empty">No rejections in this range.</p>';
  }

  function renderKpis(kpis) {
    const k = kpis || {};
    state.kpis = k;
    const tiles = [
      { key: '', label: 'Lots inspected', value: fmtInt(k.lotsInspected), sub: 'Latest verdict per lot' },
      { key: 'Accepted', label: 'Acceptance rate', value: k.acceptanceRate == null ? '—' : fmtNum(k.acceptanceRate, 1) + '%', sub: fmtInt(k.lotsAccepted) + ' of ' + fmtInt(k.lotsInspected) + ' lots' },
      { key: 'Rejected', label: 'Lots rejected', value: fmtInt(k.lotsRejected), sub: 'Current status Rejected' },
      { key: 'Pending', label: 'Pending verdicts', value: fmtInt(k.pendingVerdicts), sub: 'No sampling plan matched' },
      { key: '', label: 'Average defect %', value: k.avgDefectPercent == null ? '—' : fmtNum(k.avgDefectPercent, 2) + '%', sub: 'Weighted by sample size (' + fmtInt(k.totalSample) + ' cartons)' },
      { key: '__awaiting', label: 'Awaiting inspection now', value: fmtInt(k.awaitingInspection), sub: 'Queue, not a stored status' }
    ];
    els.dashKpis.innerHTML = tiles.map((t) => (
      '<button type="button" class="kpi' + (state.dashStatusFilter === t.key && t.key ? ' is-active' : '') + '" data-kpi="' + t.key + '">'
      + '<span class="kpi-label">' + escapeHtml(t.label) + '</span>'
      + '<span class="kpi-value">' + escapeHtml(t.value) + '</span>'
      + '<span class="kpi-sub">' + escapeHtml(t.sub) + '</span>'
      + '</button>'
    )).join('');
  }

  async function loadDashboard() {
    showStatus('Loading dashboard…');
    try {
      const dash = await api('/qc/dashboard?' + qs({
        ...commonParams(),
        from: els.dashFrom.value,
        to: els.dashTo.value,
        unitId: els.dashUnit.value
      }));
      renderKpis(dash.kpis);
      renderCharts(dash);
      state.dashLoaded = true;
      await loadDashTable();
      showStatus('');
    } catch (err) {
      showStatus(err.message, true);
    }
  }

  async function loadDashTable() {
    els.dashBody.innerHTML = '<tr><td colspan="11" class="empty">Loading inspections…</td></tr>';
    const status = state.dashStatusFilter && state.dashStatusFilter !== '__awaiting' ? state.dashStatusFilter : '';
    if (state.dashStatusFilter === '__awaiting') {
      setHash('pending');
      return;
    }
    try {
      const data = await api('/qc/inspections?' + qs({
        ...commonParams(),
        from: els.dashFrom.value,
        to: els.dashTo.value,
        unitId: els.dashUnit.value,
        jobNo: els.dashJob.value.trim(),
        status,
        page: state.dashPage,
        pageSize: PAGE_SIZE
      }));
      const rows = data.rows || [];
      state.dashTotal = Number(data.total) || 0;
      els.dashTableTitle.textContent = status
        ? ('Inspections — ' + statusWord(status) + ' (' + state.dashTotal + ')')
        : ('Inspections (' + state.dashTotal + ')');
      if (!rows.length) {
        els.dashBody.innerHTML = '<tr><td colspan="11" class="empty">No inspections in this filter.</td></tr>';
      } else {
        els.dashBody.innerHTML = rows.map((row) => (
          '<tr data-id="' + escapeHtml(row.mainId) + '" class="dash-row" style="cursor:pointer">'
          + '<td>' + escapeHtml(row.fgqcNo || '—') + '</td>'
          + '<td>' + escapeHtml(fmtDate(row.inspectedOn)) + '</td>'
          + '<td>' + escapeHtml(row.inspector || '—') + '</td>'
          + '<td>' + escapeHtml(row.jobNo || '—') + '</td>'
          + '<td>' + escapeHtml(row.gpnNo || '—') + '</td>'
          + '<td class="num">' + fmtInt(row.lotSize) + '</td>'
          + '<td class="num">' + fmtInt(row.sampleSize) + '</td>'
          + '<td>' + fmtInt(row.foundCritical) + ' / ' + fmtInt(row.referenceAQL && row.referenceAQL.critical) + '</td>'
          + '<td>' + fmtInt(row.foundMajor) + ' / ' + fmtInt(row.referenceAQL && row.referenceAQL.major) + '</td>'
          + '<td>' + fmtInt(row.foundMinor) + ' / ' + fmtInt(row.referenceAQL && row.referenceAQL.minor) + '</td>'
          + '<td>' + pill(row.qcStatus) + '</td>'
          + '</tr>'
        )).join('');
      }
      const pages = Math.max(1, Math.ceil(state.dashTotal / PAGE_SIZE));
      els.dashPager.hidden = state.dashTotal <= PAGE_SIZE;
      els.dashPageLabel.textContent = 'Page ' + state.dashPage + ' of ' + pages;
      els.btnDashPrev.disabled = state.dashPage <= 1;
      els.btnDashNext.disabled = state.dashPage >= pages;
    } catch (err) {
      els.dashBody.innerHTML = '<tr><td colspan="11" class="empty">' + escapeHtml(err.message) + '</td></tr>';
    }
  }

  async function route() {
    const { view, params } = parseHash();
    if (view === 'form') {
      await loadForm(params);
      return;
    }
    if (view === 'result') {
      renderResult();
      return;
    }
    if (view === 'detail') {
      state.detailBack = params.from || 'dashboard';
      await loadDetail(params.id);
      return;
    }
    if (view === 'dashboard') {
      showView('dashboard');
      if (!els.dashFrom.value) {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - 29);
        els.dashFrom.value = toDateInput(from);
        els.dashTo.value = toDateInput(to);
      }
      await loadUnits();
      if (!state.dashLoaded) await loadDashboard();
      return;
    }
    showView('pending');
    await loadUnits();
    await loadPending();
  }

  function findItem(key) {
    return (state.template?.items || []).find((item) => itemKey(item) === key);
  }

  els.mainTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    setHash(tab.getAttribute('data-view'));
  });

  els.btnHome.addEventListener('click', () => setHash('pending'));
  els.btnFormBack.addEventListener('click', () => setHash('pending'));
  els.btnResultList.addEventListener('click', () => setHash('pending'));
  els.btnDetailBack.addEventListener('click', () => setHash(state.detailBack || 'dashboard'));
  els.btnResultDetail.addEventListener('click', () => {
    const id = state.lastResult && state.lastResult.mainID;
    if (id) setHash('detail', { id, from: 'result' });
  });

  els.btnPendingRefresh.addEventListener('click', () => {
    state.pendingPage = 1;
    loadPending();
  });
  els.btnPendingPrev.addEventListener('click', () => {
    state.pendingPage = Math.max(1, state.pendingPage - 1);
    loadPending();
  });
  els.btnPendingNext.addEventListener('click', () => {
    state.pendingPage += 1;
    loadPending();
  });
  els.pendingUnit.addEventListener('change', () => {
    state.pendingPage = 1;
    loadPending();
  });
  els.pendingSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.pendingPage = 1;
      loadPending();
    }, 300);
  });
  els.pendingBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-start]');
    if (!btn) return;
    const row = state.pendingRows[Number(btn.getAttribute('data-start'))];
    if (row) openForm(row);
  });

  els.database.addEventListener('change', () => {
    localStorage.setItem(DB_KEY, els.database.value);
    unitsLoaded = false;
    els.pendingUnit.innerHTML = '<option value="">All units</option>';
    els.dashUnit.innerHTML = '<option value="">All units</option>';
    state.dashLoaded = false;
    loadInspectors();
    route();
  });
  els.inspector.addEventListener('change', () => {
    localStorage.setItem(INSPECTOR_KEY, els.inspector.value);
    if (state.view === 'form') renderFormHeader();
  });

  document.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const input = document.getElementById(step.getAttribute('data-target'));
      if (input) {
        const next = Math.max(1, (Number(input.value) || 0) + Number(step.getAttribute('data-step')));
        input.value = String(next);
        scheduleDraft();
      }
    }
    const itemStep = e.target.closest('[data-item-step]');
    if (itemStep) {
      const key = itemStep.getAttribute('data-key');
      const item = findItem(key);
      if (item) {
        setCount(item, countFor(item) + Number(itemStep.getAttribute('data-item-step')));
        refreshFormFlags();
      }
    }
  });

  els.formSections.addEventListener('input', (e) => {
    const key = e.target.getAttribute('data-key');
    if (!key) return;
    const item = findItem(key);
    if (!item) return;
    if (e.target.classList.contains('count-input')) {
      setCount(item, e.target.value);
      refreshFormFlags();
    } else if (e.target.classList.contains('line-remark')) {
      setCount(item, countFor(item), e.target.value);
      scheduleDraft();
    }
  });

  els.sampleSize.addEventListener('input', scheduleDraft);
  els.formRemark.addEventListener('input', scheduleDraft);
  els.btnSubmit.addEventListener('click', submitInspection);

  els.btnDashLoad.addEventListener('click', () => {
    state.dashPage = 1;
    state.dashLoaded = false;
    loadDashboard();
  });
  els.btnDashPrev.addEventListener('click', () => {
    state.dashPage = Math.max(1, state.dashPage - 1);
    loadDashTable();
  });
  els.btnDashNext.addEventListener('click', () => {
    state.dashPage += 1;
    loadDashTable();
  });
  els.dashJob.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.dashPage = 1;
      loadDashTable();
    }
  });
  els.dashKpis.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kpi]');
    if (!btn) return;
    const key = btn.getAttribute('data-kpi') || '';
    if (key === '__awaiting') {
      setHash('pending');
      return;
    }
    state.dashStatusFilter = state.dashStatusFilter === key ? '' : key;
    state.dashPage = 1;
    renderKpis(state.kpis || {});
    loadDashTable();
  });

  els.dashBody.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    setHash('detail', { id: row.getAttribute('data-id'), from: 'dashboard' });
  });

  window.addEventListener('hashchange', route);

  (async function init() {
    els.database.value = localStorage.getItem(DB_KEY) || cfg.defaultDatabase || 'KOL';
    try { localStorage.removeItem('fgqc-company'); } catch (e) { /* ignore */ }
    await loadInspectors();
    await route();
  })();
})();
