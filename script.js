(function () {
  'use strict';

  const cfg = window.AppConfig || {};
  const API_BASE = cfg.apiBaseUrl || 'http://127.0.0.1:3001/api';
  const FROM_GPN_DATE = cfg.fromGPNDate || '2026-09-01';
  const EXCLUDED_PENDING_CATEGORIES = Array.isArray(cfg.excludedPendingCategories)
    ? cfg.excludedPendingCategories
    : ['Books', 'Leaflets', 'Tag', 'Rigid Box', 'Unprinted card'];
  const PAGE_SIZE = Number(cfg.pageSize || 25);
  const SHIFT_HOURS = Number(cfg.shiftHours || 8);
  /*
   * A GPN below this many pieces does not need QC. The API sends its own value
   * with the queue and that one wins — the two deciding differently would put a
   * button on screen that the save then refuses.
   */
  const MIN_LOT_QTY_FALLBACK = Number(cfg.minLotQty || 50);
  const SEVERITY_ORDER = ['Critical', 'Major', 'Minor'];
  /*
   * A characteristic whose severity the master does not resolve. Spec section 5
   * question 1 is still open, so the form shows these in their own block and
   * refuses to count them rather than filing them under Minor — a Critical
   * defect counted as Minor turns a lot that must be rejected on one defect
   * into a lot that accepts up to the Minor accept number.
   */
  const UNCLASSIFIED = 'Unclassified';
  const SESSION_KEY = 'fgqc_session';
  const DRAFT_PREFIX = 'fgqc-draft-';
  const PENDING_ROW_KEY = 'fgqc-pending-row';
  const RESULT_KEY = 'fgqc-last-result';

  const els = {
    loginSection: document.getElementById('login-section'),
    loginForm: document.getElementById('login-form'),
    loginUsername: document.getElementById('login-username'),
    loginDatabase: document.getElementById('login-database'),
    loginError: document.getElementById('login-error'),
    btnLogin: document.getElementById('btn-login'),
    appShell: document.getElementById('app-shell'),
    userInfo: document.getElementById('user-info'),
    btnLogout: document.getElementById('btn-logout'),
    globalStatus: document.getElementById('global-status'),
    mainTabs: document.getElementById('main-tabs'),
    btnHome: document.getElementById('btn-home'),
    pendingSearch: document.getElementById('pending-search'),
    pendingRange: document.getElementById('pending-range'),
    pendingCustomDates: document.getElementById('pending-custom-dates'),
    pendingFrom: document.getElementById('pending-from'),
    pendingTo: document.getElementById('pending-to'),
    pendingMeta: document.getElementById('pending-meta'),
    pendingTable: document.getElementById('pending-table'),
    pendingBody: document.getElementById('pending-body'),
    pendingPager: document.getElementById('pending-pager'),
    pendingPageLabel: document.getElementById('pending-page-label'),
    btnPendingExport: document.getElementById('btn-pending-export'),
    btnPendingRefresh: document.getElementById('btn-pending-refresh'),
    btnPendingPrev: document.getElementById('btn-pending-prev'),
    btnPendingNext: document.getElementById('btn-pending-next'),
    dashRange: document.getElementById('dash-range'),
    dashCustomDates: document.getElementById('dash-custom-dates'),
    dashFrom: document.getElementById('dash-from'),
    dashTo: document.getElementById('dash-to'),
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
    formRejectBanner: document.getElementById('form-reject-banner'),
    formPlanBanner: document.getElementById('form-plan-banner'),
    formSeverityBanner: document.getElementById('form-severity-banner'),
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
    pendingAllRows: [],
    minLotQty: MIN_LOT_QTY_FALLBACK,
    pendingFrom: '',
    pendingTo: '',
    colFilters: {
      gpnNo: '',
      gpnDate: '',
      waiting: '',
      jobNo: '',
      jobName: '',
      client: '',
      categoryName: '',
      lotSize: '',
      requiredSample: '',
      status: ''
    },
    dashPage: 1,
    dashTotal: 0,
    dashStatusFilter: '',
    dashColFilters: {},
    dashLoaded: false,
    lot: null,
    template: null,
    counts: {},
    lastResult: null,
    detailBack: 'dashboard'
  };

  let searchTimer = null;
  let draftTimer = null;

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

  function todayYmd() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    } catch {
      return toDateInput(new Date());
    }
  }

  function addDaysYmd(ymdStr, deltaDays) {
    const parts = String(ymdStr || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return ymdStr;
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + deltaDays));
    return dt.toISOString().slice(0, 10);
  }

  function clampYmd(value, min, max) {
    let v = value;
    if (min && v < min) v = min;
    if (max && v > max) v = max;
    return v;
  }

  function rangeFromPreset(preset, customFrom, customTo) {
    const today = todayYmd();
    const days = Number(preset);
    if (preset === 'custom' || !Number.isFinite(days) || days <= 0) {
      let from = customFrom || addDaysYmd(today, -13);
      let to = customTo || today;
      if (from > to) {
        const swap = from;
        from = to;
        to = swap;
      }
      from = clampYmd(from, FROM_GPN_DATE, today);
      to = clampYmd(to, FROM_GPN_DATE, today);
      if (from > to) from = to;
      return { from, to };
    }
    return {
      from: clampYmd(addDaysYmd(today, -(days - 1)), FROM_GPN_DATE, today),
      to: today
    };
  }

  function bindDateLimits() {
    const today = todayYmd();
    [els.pendingFrom, els.pendingTo, els.dashFrom, els.dashTo].forEach((el) => {
      if (!el) return;
      el.min = FROM_GPN_DATE;
      el.max = today;
    });
  }

  function syncCustomDates(wrap, fromEl, toEl, preset, range) {
    const custom = preset === 'custom';
    if (wrap) wrap.hidden = !custom;
    if (fromEl) fromEl.value = range.from;
    if (toEl) toEl.value = range.to;
  }

  function pendingDateRange() {
    const preset = (els.pendingRange && els.pendingRange.value) || '14';
    const range = rangeFromPreset(
      preset,
      els.pendingFrom && els.pendingFrom.value,
      els.pendingTo && els.pendingTo.value
    );
    syncCustomDates(els.pendingCustomDates, els.pendingFrom, els.pendingTo, preset, range);
    state.pendingFrom = range.from;
    state.pendingTo = range.to;
    return range;
  }

  function dashDateRange() {
    const preset = (els.dashRange && els.dashRange.value) || '14';
    const range = rangeFromPreset(
      preset,
      els.dashFrom && els.dashFrom.value,
      els.dashTo && els.dashTo.value
    );
    syncCustomDates(els.dashCustomDates, els.dashFrom, els.dashTo, preset, range);
    return range;
  }

  function getSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (s && s.userId && s.userName && s.database) return s;
    } catch {
      /* ignore */
    }
    return null;
  }

  function setSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function showLoggedOut() {
    els.loginSection.hidden = false;
    els.appShell.hidden = true;
    els.loginError.hidden = true;
    els.loginError.textContent = '';
    if (els.loginDatabase && els.loginDatabase.value) {
      loadLoginUsers();
    } else if (els.loginUsername) {
      els.loginUsername.innerHTML = '<option value="">Select database first</option>';
      els.loginUsername.disabled = true;
    }
    if (els.loginDatabase) els.loginDatabase.focus();
  }

  function showLoggedIn() {
    const s = getSession();
    if (!s) {
      showLoggedOut();
      return false;
    }
    els.loginSection.hidden = true;
    els.appShell.hidden = false;
    els.userInfo.textContent = s.userName + ' (' + s.database + ')';
    return true;
  }

  function db() {
    const s = getSession();
    return (s && s.database) || cfg.defaultDatabase || 'KOL';
  }

  function inspectorId() {
    const s = getSession();
    const n = Number(s && s.userId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function inspectorName() {
    const s = getSession();
    return (s && s.userName) || '';
  }

  async function loadLoginUsers() {
    const database = String(els.loginDatabase && els.loginDatabase.value || '').trim();
    const saved = String(els.loginUsername && els.loginUsername.value || '');
    els.loginUsername.innerHTML = '<option value="">Select username</option>';
    if (!database) {
      els.loginUsername.innerHTML = '<option value="">Select database first</option>';
      els.loginUsername.disabled = true;
      return;
    }
    els.loginUsername.disabled = true;
    try {
      const data = await api('/qc/inspectors?' + qs({ database }));
      const rows = data.rows || [];
      rows.forEach((row) => {
        const opt = document.createElement('option');
        opt.value = row.userName;
        opt.textContent = row.userName;
        if (row.userName === saved) opt.selected = true;
        els.loginUsername.appendChild(opt);
      });
      els.loginUsername.disabled = false;
      els.loginError.hidden = true;
      els.loginError.textContent = '';
      if (!rows.length) {
        els.loginError.textContent = 'No users found in ' + database;
        els.loginError.hidden = false;
      }
    } catch (err) {
      els.loginUsername.disabled = true;
      els.loginError.textContent = err.message || 'Could not load usernames.';
      els.loginError.hidden = false;
    }
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
    if (s.startsWith('min')) return 'Minor';
    return UNCLASSIFIED;
  }

  function itemKey(item) {
    return String(item.fgqcParameterSettingID || item.characterstics);
  }

  function emptyCount() {
    return { critical: 0, major: 0, minor: 0, unclassified: 0, remark: '' };
  }

  function countFor(item) {
    const key = itemKey(item);
    const row = state.counts[key] || emptyCount();
    const sev = normalizeSeverity(item.severity);
    if (sev === 'Critical') return Number(row.critical) || 0;
    if (sev === 'Major') return Number(row.major) || 0;
    if (sev === 'Minor') return Number(row.minor) || 0;
    return Number(row.unclassified) || 0;
  }

  function setCount(item, value, remark) {
    const key = itemKey(item);
    const sev = normalizeSeverity(item.severity);
    const n = Math.max(0, Math.trunc(Number(value) || 0));
    const prev = state.counts[key] || emptyCount();
    state.counts[key] = {
      critical: sev === 'Critical' ? n : 0,
      major: sev === 'Major' ? n : 0,
      minor: sev === 'Minor' ? n : 0,
      // Never lands in a class column, so it can never move a verdict.
      unclassified: sev === UNCLASSIFIED ? n : 0,
      remark: remark == null ? prev.remark : String(remark)
    };
  }

  function unclassifiedItems() {
    return (state.template?.items || []).filter(
      (item) => normalizeSeverity(item.severity) === UNCLASSIFIED
    );
  }

  function unclassifiedTotal() {
    return unclassifiedItems().reduce((sum, item) => sum + countFor(item), 0);
  }

  function classTotals() {
    const totals = { Critical: 0, Major: 0, Minor: 0 };
    (state.template?.items || []).forEach((item) => {
      const sev = normalizeSeverity(item.severity);
      if (sev === UNCLASSIFIED) return;
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
      'Lot ' + fmtInt(t.lotSize) + '  →  Required sample ' + fmtInt(t.sampleSize);
    const a = t.referenceAQL || {};
    els.planAcceptLine.textContent =
      'Accept:  Critical ' + fmtInt(a.critical) + '  ·  Major ' + fmtInt(a.major) + '  ·  Minor ' + fmtInt(a.minor);
    const noPlan = t.planFound === false;
    els.formPlanBanner.hidden = !noPlan;
    els.formPlanBanner.textContent = noPlan
      ? 'No sampling plan covers this lot size. You can still fill the sheet — it will be saved as Pending review.'
      : '';

    const unresolved = unclassifiedItems().length;
    els.formSeverityBanner.hidden = unresolved === 0;
    els.formSeverityBanner.textContent = unresolved === 0
      ? ''
      : (unresolved === 1
        ? '1 characteristic on this sheet has no severity on the master, so there is no'
          + ' way to tell which AQL class it belongs to. It is listed at the bottom and'
          + ' is not counted. Leave it at zero to submit, and ask the QC in-charge to'
          + ' set its severity.'
        : unresolved + ' characteristics on this sheet have no severity on the master, so'
          + ' there is no way to tell which AQL class they belong to. They are listed at'
          + ' the bottom and are not counted. Leave them at zero to submit, and ask the'
          + ' QC in-charge to set their severity.');
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
      ['Inspector', inspectorName() || '—']
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

  function groupItems() {
    const grouped = { Critical: [], Major: [], Minor: [], [UNCLASSIFIED]: [] };
    (state.template?.items || []).forEach((item) => {
      grouped[normalizeSeverity(item.severity)].push(item);
    });
    return grouped;
  }

  function renderDefectRow(item, offender) {
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
  }

  function renderUnclassifiedBlock(rows) {
    if (!rows.length) return '';
    const total = unclassifiedTotal();
    return (
      '<article class="severity-block is-unclassified" data-severity="' + UNCLASSIFIED + '">'
      + '<header class="severity-head ' + (total > 0 ? 'is-over' : '') + '">'
      + '<span>Not classified</span>'
      + '<span>' + escapeHtml(total > 0
        ? fmtInt(total) + ' entered — cannot be submitted'
        : 'no severity on the master') + '</span>'
      + '</header>'
      + '<p class="severity-note">These characteristics have no Critical / Major / Minor'
      + ' setting on the parameter master, so counting them would put the defect in'
      + ' the wrong AQL class. They are not counted towards any accept number.</p>'
      + rows.map((item) => renderDefectRow(item, null)).join('')
      + '</article>'
    );
  }

  function renderSections() {
    const grouped = groupItems();
    const flags = liveFlags();

    /*
     * No characteristics means the parameter master has nothing for this
     * category — there is no sheet to fill. The form used to render an empty
     * space with a live Submit button under it, which reads as "no defects
     * found" rather than "nothing was loaded". Say which it is.
     */
    if (!(state.template?.items || []).length) {
      els.formSections.innerHTML =
        '<article class="severity-block is-unclassified">'
        + '<header class="severity-head is-over"><span>No inspection sheet</span>'
        + '<span>0 characteristics</span></header>'
        + '<p class="severity-note">No defect characteristics are set up for this'
        + ' product category, so there is nothing to count. This is a setup gap, not'
        + ' a clean lot — ask the QC in-charge to add the characteristics to the'
        + ' parameter master, then reopen this lot.</p>'
        + '</article>';
      updateLiveFlags();
      return;
    }

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
        + rows.map((item) => renderDefectRow(item, offender)).join('')
        + '</article>'
      );
    }).join('') + renderUnclassifiedBlock(grouped[UNCLASSIFIED]);

    updateLiveFlags();
  }

  function updateLiveFlags() {
    const grouped = groupItems();
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

    const unclassifiedBlock = els.formSections.querySelector('[data-severity="' + UNCLASSIFIED + '"]');
    if (unclassifiedBlock) {
      const total = unclassifiedTotal();
      const head = unclassifiedBlock.querySelector('.severity-head');
      if (head) {
        head.classList.toggle('is-over', total > 0);
        const label = head.querySelector('span:last-child');
        if (label) {
          label.textContent = total > 0
            ? fmtInt(total) + ' entered — cannot be submitted'
            : 'no severity on the master';
        }
      }
      unclassifiedBlock.querySelectorAll('.defect-row').forEach((rowEl) => {
        const item = findItem(rowEl.getAttribute('data-key'));
        const n = item ? countFor(item) : 0;
        const input = rowEl.querySelector('.count-input');
        if (input && document.activeElement !== input && String(input.value) !== String(n)) {
          input.value = String(n);
        }
      });
    }

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
    if (!(state.template?.items || []).length) {
      return 'There is no inspection sheet for this product category — no defect'
        + ' characteristics are set up on the parameter master. Nothing can be'
        + ' recorded against this lot until they are added.';
    }
    const sample = Math.trunc(Number(els.sampleSize.value) || 0);
    const lotSize = Number(state.template?.lotSize);
    if (sample <= 0) return 'Quantity inspected must be greater than zero.';
    if (Number.isFinite(lotSize) && sample > lotSize) {
      return 'Quantity inspected (' + fmtInt(sample) + ') cannot exceed the lot size (' + fmtInt(lotSize) + ').';
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
    const stranded = unclassifiedTotal();
    if (stranded > 0) {
      return 'Not classified (' + fmtInt(stranded) + ' entered). These characteristics have no'
        + ' severity on the master, so the counts cannot be placed in an AQL class and the'
        + ' verdict would be wrong. Set them back to zero and ask the QC in-charge to fix'
        + ' the parameter master.';
    }
    const flags = liveFlags();
    const over = SEVERITY_ORDER.some((sev) => flags[sev].state === 'over');
    if (over && !String(els.formRemark.value || '').trim()) {
      return 'A class is over its accept number. Enter a remark before submitting.';
    }
    if (!inspectorId()) return 'Sign in before submitting.';
    return null;
  }

  function showFormError(message) {
    els.formError.hidden = !message;
    els.formError.textContent = message || '';
  }

  function containsFilter(hay, needle) {
    if (!needle) return true;
    return String(hay == null ? '' : hay).toLowerCase().includes(String(needle).trim().toLowerCase());
  }

  function normalizeCategoryName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function categoryStem(name) {
    const n = normalizeCategoryName(name);
    if (!n) return '';
    if (n.endsWith('ies') && n.length > 4) return n.slice(0, -3) + 'y';
    if (n.endsWith('s') && n.length > 2 && !n.endsWith('ss')) return n.slice(0, -1);
    return n;
  }

  function categoryExcluded(categoryName) {
    const norm = normalizeCategoryName(categoryName);
    if (!norm) return false;
    const stem = categoryStem(norm);
    for (const raw of EXCLUDED_PENDING_CATEGORIES) {
      const base = normalizeCategoryName(raw);
      if (!base) continue;
      const baseStem = categoryStem(base);
      if (norm === base || stem === baseStem) return true;
      const prefixes = [base, baseStem];
      for (const p of prefixes) {
        if (!p) continue;
        if (norm === p) return true;
        if (norm.startsWith(p + ' ') || norm.startsWith(p + '-') || norm.startsWith(p + '|')) return true;
      }
    }
    return false;
  }

  /*
   * One answer to "can this lot be inspected", asked by the queue row, by the
   * click on its button, and again when the form opens from a pasted URL.
   *
   * The API decides; this only reads what it said, and falls back to the
   * threshold when talking to an API that does not send the flag yet. A lot
   * size of 0 is unknown, not tiny, and is never skipped on that basis.
   */
  function qcSkipReason(row) {
    if (!row) return null;
    if (row.qcSkipReason) return String(row.qcSkipReason);
    if (row.qcRequired === false) {
      return 'GPN quantity is ' + fmtInt(row.lotSize) + ', below the '
        + fmtInt(state.minLotQty) + ' minimum. This lot does not need QC.';
    }
    const qty = Number(row.lotSize);
    if (Number.isFinite(qty) && qty > 0 && qty < state.minLotQty) {
      return 'GPN quantity is ' + fmtInt(qty) + ', below the '
        + fmtInt(state.minLotQty) + ' minimum. This lot does not need QC.';
    }
    return null;
  }

  function pendingDisplayValues(row) {
    const wait = waitingLabel(row.gpnDate);
    const reason = row.pendingReason || 'Not started';
    return {
      gpnNo: row.gpnNo || '',
      gpnDate: fmtDate(row.gpnDate),
      waiting: wait.text,
      jobNo: row.jobNo || '',
      jobName: row.jobName || '',
      client: row.client || '',
      categoryName: row.categoryName || '',
      lotSize: fmtInt(row.lotSize),
      /*
       * No sample is owed on a lot that does not need inspecting, and none is
       * known when no band covers the lot. Both print as a dash.
       *
       * Not fmtInt alone: Number(null) is 0, so a lot the plan does not cover
       * would read "required sample 0" — inspect nothing — rather than saying
       * the plan has no answer for it.
       */
      requiredSample: (qcSkipReason(row) || row.requiredSample == null)
        ? '—'
        : fmtInt(row.requiredSample),
      status: statusWord(reason),
      waitOverShift: wait.overShift,
      reason: reason,
      reinspect: Number(row.submissionCount) > 0,
      skipReason: qcSkipReason(row)
    };
  }

  function filteredPendingRows() {
    const q = String(els.pendingSearch && els.pendingSearch.value || '').trim().toLowerCase();
    const filters = state.colFilters;
    return (state.pendingAllRows || []).filter((row) => {
      const d = pendingDisplayValues(row);
      if (q) {
        const blob = [d.gpnNo, d.jobNo, d.jobName, d.client].join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return Object.keys(filters).every((key) => containsFilter(d[key], filters[key]));
    });
  }

  function escapeCsvCell(value) {
    if (value == null) return '';
    const s = String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportPendingExcel() {
    const rows = filteredPendingRows();
    if (!rows.length) {
      showStatus('No lots to export for the current filters.', true);
      return;
    }
    const columns = [
      ['GPN No', (row, d) => d.gpnNo],
      ['GPN Date', (row, d) => d.gpnDate],
      ['Waiting', (row, d) => d.waiting],
      ['Job No', (row, d) => d.jobNo],
      ['Job Name', (row, d) => d.jobName],
      ['Client', (row, d) => d.client],
      ['Category', (row, d) => d.categoryName],
      ['Lot size', (row, d) => (Number.isFinite(Number(row.lotSize)) ? String(row.lotSize) : '')],
      ['Required sample', (row, d) => (Number.isFinite(Number(row.requiredSample)) ? String(row.requiredSample) : '')],
      ['Status', (row, d) => d.status]
    ];
    const header = columns.map((c) => escapeCsvCell(c[0])).join(',');
    const body = rows.map((row) => {
      const d = pendingDisplayValues(row);
      return columns.map((c) => escapeCsvCell(c[1](row, d))).join(',');
    });
    const csv = [header].concat(body).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fg-qc-pending-' + todayYmd() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function fetchAllPending(range) {
    const all = [];
    let page = 1;
    const fetchSize = 200;
    let total = Infinity;
    while (all.length < total) {
      const data = await api('/qc/pending?' + qs({
        ...commonParams(),
        fromGPNDate: range.from,
        toGPNDate: range.to,
        page,
        pageSize: fetchSize
      }));
      const rows = data.rows || [];
      /* The API owns the threshold; keep the browser's copy in step with it. */
      const reportedMin = Number(data.minLotQty);
      if (Number.isFinite(reportedMin) && reportedMin > 0) state.minLotQty = reportedMin;
      const reported = Number(data.total);
      total = Number.isFinite(reported) && reported >= 0 ? reported : all.length + rows.length;
      all.push(...rows);
      if (!rows.length || rows.length < fetchSize) break;
      page += 1;
      if (page > 100) break;
    }
    return all;
  }

  async function loadPending() {
    showStatus('Loading lots awaiting inspection…');
    els.pendingBody.innerHTML = '<tr><td colspan="11" class="empty">Loading lots awaiting inspection…</td></tr>';
    const range = pendingDateRange();
    try {
      state.pendingAllRows = (await fetchAllPending(range)).filter((row) => !categoryExcluded(row.categoryName));
      renderPending();
      showStatus('');
    } catch (err) {
      state.pendingAllRows = [];
      els.pendingBody.innerHTML = '<tr><td colspan="11" class="empty">' + escapeHtml(err.message) + '</td></tr>';
      els.pendingMeta.textContent = '';
      els.pendingPager.hidden = true;
      showStatus(err.message, true);
    }
  }

  function renderPending() {
    const filtered = filteredPendingRows();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.pendingPage > pages) state.pendingPage = pages;
    if (state.pendingPage < 1) state.pendingPage = 1;
    const start = (state.pendingPage - 1) * PAGE_SIZE;
    const rows = filtered.slice(start, start + PAGE_SIZE);
    state.pendingRows = rows;
    state.pendingTotal = filtered.length;
    if (!rows.length) {
      els.pendingBody.innerHTML = '<tr><td colspan="11" class="empty">No lots waiting for inspection.</td></tr>';
    } else {
      els.pendingBody.innerHTML = rows.map((row, idx) => {
        const d = pendingDisplayValues(row);
        const isRework = /rework|rejected/i.test(d.reason);
        const btnLabel = d.skipReason ? 'No QC needed' : (d.reinspect ? 'Re-inspect' : 'Start QC');
        /*
         * Not the disabled attribute: a disabled button swallows the click, and
         * then nothing explains itself. It looks unavailable and says why when
         * pressed, which is what someone reaching for it wants to know.
         */
        const btnClass = d.skipReason ? 'btn-muted' : 'btn-primary';
        const rowClass = [
          isRework ? 'row-rework' : '',
          d.waitOverShift ? 'row-overshift' : '',
          d.skipReason ? 'row-skip' : ''
        ].filter(Boolean).join(' ');
        return (
          '<tr class="' + rowClass + '">'
          + '<td>' + escapeHtml(d.gpnNo || '—') + '</td>'
          + '<td>' + escapeHtml(d.gpnDate) + '</td>'
          + '<td>' + escapeHtml(d.waiting) + '</td>'
          + '<td>' + escapeHtml(d.jobNo || '—') + '</td>'
          + '<td>' + escapeHtml(d.jobName || '—') + '</td>'
          + '<td>' + escapeHtml(d.client || '—') + '</td>'
          + '<td>' + escapeHtml(d.categoryName || '—') + '</td>'
          + '<td class="num">' + escapeHtml(d.lotSize) + '</td>'
          + '<td class="num">' + escapeHtml(d.requiredSample) + '</td>'
          + '<td>' + pill(d.reason) + '</td>'
          + '<td><button type="button" class="' + btnClass + '" data-start="' + idx + '"'
          /*
           * A title, not aria-disabled. The button does respond — pressing it
           * is how the reason appears — and aria-disabled would tell a screen
           * reader, and anything driving the page, that it does not.
           */
          + (d.skipReason ? ' title="' + escapeHtml(d.skipReason) + '"' : '')
          + '>' + escapeHtml(btnLabel) + '</button></td>'
          + '</tr>'
        );
      }).join('');
    }
    const from = filtered.length ? start + 1 : 0;
    const to = Math.min(start + PAGE_SIZE, filtered.length);
    const rangeLabel = fmtDate(state.pendingFrom) + ' – ' + fmtDate(state.pendingTo);
    const allCount = (state.pendingAllRows || []).length;
    const filteredNote = filtered.length !== allCount ? (' (filtered from ' + allCount + ')') : '';
    els.pendingMeta.textContent = filtered.length
      ? ('Showing ' + from + '–' + to + ' of ' + filtered.length + ' lots' + filteredNote + ', ' + rangeLabel + '. Oldest GPN first.')
      : ('No lots awaiting inspection in ' + rangeLabel + '.');
    els.pendingPager.hidden = filtered.length <= PAGE_SIZE;
    els.pendingPageLabel.textContent = 'Page ' + state.pendingPage + ' of ' + pages;
    els.btnPendingPrev.disabled = state.pendingPage <= 1;
    els.btnPendingNext.disabled = state.pendingPage >= pages;
  }

  async function openForm(lot) {
    const skip = qcSkipReason(lot);
    if (skip) {
      showStatus(skip, true);
      return;
    }
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
    // Clear the previous lot's banners — a stale "no sampling plan" or
    // over-limit warning on a different lot is worse than none.
    [els.formRejectBanner, els.formPlanBanner, els.formSeverityBanner].forEach((el) => {
      el.hidden = true;
      el.textContent = '';
    });
    renderFormHeader();

    if (!lot.categoryId || lot.lotSize == null) {
      showFormError('This form needs categoryId and lotSize on the URL. Open it from the awaiting list.');
      return;
    }

    /*
     * The queue greys the button out, but the form is reachable by its URL —
     * a bookmark, a tab left open, a link passed to a colleague. Same rule
     * here, and the save refuses it a third time.
     */
    const skip = qcSkipReason(lot);
    if (skip) {
      showFormError(skip);
      els.formSections.innerHTML = '';
      els.planLotLine.textContent = '';
      return;
    }

    try {
      const template = await api('/qc/template?' + qs({
        ...commonParams(),
        categoryId: lot.categoryId,
        lotSize: lot.lotSize
      }));
      state.template = template;
      /*
       * planFound comes from the sampling plan and is never overwritten here.
       *
       * This used to fill in the pending row's requiredSample and flip
       * planFound to true, which hid the "no sampling plan" banner that spec
       * section 7.2 requires. It also left the accept numbers null, so the live
       * limit flagging in section 7.2 silently did nothing — the inspector saw
       * a normal form, entered counts, and got no warning at all. If the plan
       * did not resolve, the inspector has to know.
       */
      if (!template.planFound && Number(lot.requiredSample) > 0) {
        // Still offer the queue's sample as a starting number, but keep the
        // verdict path honest about the plan being missing.
        template.sampleSize = template.sampleSize || Number(lot.requiredSample);
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
            unclassified: Number(saved.unclassified) || 0,
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
      + '<p>Lot ' + fmtInt(result.lotSize) + ' · inspected ' + fmtInt(result.inspected)
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
          ['Lot size', fmtInt(main.lotSize)], ['Sample size', fmtInt(main.sampleSize)]]
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
        + '</tbody></table></div>'
        + renderSubmissionHistory(data.submissions || [], main);
    } catch (err) {
      els.detailCard.innerHTML = '<p class="empty">' + escapeHtml(err.message) + '</p>';
    }
  }

  /*
   * Spec section 5 question 2: a rejected lot is re-inspected against the same
   * (JobBookingID, FGTransactionID) and the main row is replaced, so the main
   * row no longer shows that the lot ever failed. The detail history survives
   * replacement by design, so the rework story is told from there — which is
   * what a buyer audit needs to see, and what spots a lot that failed twice.
   */
  function renderSubmissionHistory(submissions, main) {
    if (submissions.length < 2) return '';
    const everRejected = submissions.some((sub) => sub.wouldPass === false);
    return (
      '<h3 class="history-head">Inspection history</h3>'
      + '<p class="panel-sub">'
      + escapeHtml(
        'This lot was submitted ' + submissions.length + ' times. The verdict above was'
        + ' computed from the latest submission alone — earlier counts are history and'
        + ' are never carried forward.'
        + (everRejected
          ? ' This lot was rejected at least once before reaching its current status of '
            + statusWord(main.qcStatus) + '.'
          : '')
      )
      + '</p>'
      + '<div class="table-wrap"><table class="data-table"><thead><tr>'
      + '<th>#</th><th>Date</th><th>Inspector</th><th class="num">Sample</th>'
      + '<th class="num">Critical</th><th class="num">Major</th><th class="num">Minor</th><th>Outcome</th>'
      + '</tr></thead><tbody>'
      + submissions.map((sub) => {
        const outcome = sub.wouldPass == null
          ? pill('Pending')
          : pill(sub.wouldPass ? 'Accepted' : 'Rejected');
        return (
          '<tr' + (sub.wouldPass === false ? ' class="row-rework"' : '') + '>'
          + '<td>' + fmtInt(sub.submissionNo) + (sub.submissionNo === 1 ? ' <span class="th-hint">first pass</span>' : '') + '</td>'
          + '<td>' + escapeHtml(fmtDate(sub.createdDate)) + '</td>'
          + '<td>' + escapeHtml(sub.inspector || '—') + '</td>'
          + '<td class="num">' + fmtInt(sub.sampleSize) + '</td>'
          + '<td class="num">' + fmtInt(sub.foundCritical) + '</td>'
          + '<td class="num">' + fmtInt(sub.foundMajor) + '</td>'
          + '<td class="num">' + fmtInt(sub.foundMinor) + '</td>'
          + '<td>' + outcome + '</td>'
          + '</tr>'
        );
      }).join('')
      + '</tbody></table></div>'
    );
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
  }

  function renderKpis(kpis) {
    const k = kpis || {};
    state.kpis = k;
    const tiles = [
      { key: '', label: 'Lots inspected', value: fmtInt(k.lotsInspected), sub: 'Latest verdict per lot' },
      { key: 'Accepted', label: 'Acceptance rate', value: k.acceptanceRate == null ? '—' : fmtNum(k.acceptanceRate, 1) + '%', sub: fmtInt(k.lotsAccepted) + ' of ' + fmtInt(k.lotsInspected) + ' lots' },
      {
        key: '',
        label: 'First-pass acceptance',
        value: k.firstPassAcceptanceRate == null ? '—' : fmtNum(k.firstPassAcceptanceRate, 1) + '%',
        // Section 7.4: this one cannot come from the main row, which holds only
        // the latest verdict. It is computed from the earliest submission in
        // the detail history.
        sub: fmtInt(k.firstPassAccepted) + ' of ' + fmtInt(k.firstPassLots) + ' lots passed first time'
      },
      { key: 'Rejected', label: 'Lots rejected', value: fmtInt(k.lotsRejected), sub: 'Current status Rejected' },
      { key: 'Pending', label: 'Pending verdicts', value: fmtInt(k.pendingVerdicts), sub: 'No sampling plan matched' },
      { key: '', label: 'Average defect %', value: k.avgDefectPercent == null ? '—' : fmtNum(k.avgDefectPercent, 2) + '%', sub: 'Weighted by sample size (' + fmtInt(k.totalSample) + ')' },
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
    const range = dashDateRange();
    try {
      const dash = await api('/qc/dashboard?' + qs({
        ...commonParams(),
        from: range.from,
        to: range.to
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

  /*
   * Per-column filters for the inspections table.
   *
   * The row is built here rather than written into index.html so the markup
   * stays a plain table, and so this keeps working if the header is restyled.
   *
   * Every filter is sent to the API and applied in SQL. Filtering the rows
   * already on screen would be a lie on a paged table: it would hide matches
   * sitting on page two while the count in the panel heading went on quoting
   * the unfiltered total.
   *
   * Date has no box of its own — the From / To fields in the toolbar are that
   * filter, and a second pair here would be two controls for one thing.
   */
  const DASH_FILTERS = [
    { key: 'fgqcNo', type: 'text', placeholder: 'FGQC no' },
    { key: '', type: 'note', note: 'From / To above' },
    { key: 'inspector', type: 'text', placeholder: 'Name' },
    { key: 'jobBookingNo', type: 'text', placeholder: 'Job no' },
    { key: 'gpnNo', type: 'text', placeholder: 'GPN no' },
    { key: 'minLotSize', type: 'number', placeholder: '≥' },
    { key: 'minSample', type: 'number', placeholder: '≥' },
    { key: 'minCritical', type: 'number', placeholder: '≥' },
    { key: 'minMajor', type: 'number', placeholder: '≥' },
    { key: 'minMinor', type: 'number', placeholder: '≥' },
    { key: 'status', type: 'select' }
  ];

  /* Status is also driven by the KPI tiles, so both write the same state. */
  const DASH_STATUSES = ['Accepted', 'Rejected', 'In Progress', 'Pending'];

  let dashFilterTimer = null;

  function dashFilterCell(f) {
    if (f.type === 'note') {
      return '<td class="col-filter-note" title="The Date column is filtered by the From and To fields in the toolbar above.">'
        + escapeHtml(f.note) + '</td>';
    }
    if (f.type === 'select') {
      return '<td><select data-colfilter="status" aria-label="Filter by status">'
        + '<option value="">All</option>'
        + DASH_STATUSES.map((v) => (
            '<option value="' + escapeHtml(v) + '"'
            + (state.dashStatusFilter === v ? ' selected' : '') + '>'
            + escapeHtml(statusWord(v)) + '</option>'
          )).join('')
        + '</select></td>';
    }
    const value = state.dashColFilters[f.key] == null ? '' : String(state.dashColFilters[f.key]);
    return '<td' + (f.type === 'number' ? ' class="num"' : '') + '>'
      + '<input data-colfilter="' + f.key + '"'
      + ' type="' + (f.type === 'number' ? 'number' : 'search') + '"'
      + (f.type === 'number' ? ' inputmode="numeric" min="0" step="1"' : '')
      + ' value="' + escapeHtml(value) + '"'
      + ' placeholder="' + escapeHtml(f.placeholder) + '"'
      + ' aria-label="Filter by ' + escapeHtml(f.key) + '"'
      + ' autocomplete="off" /></td>';
  }

  function activeDashFilterCount() {
    let n = Object.keys(state.dashColFilters).filter((k) => state.dashColFilters[k] !== '').length;
    if (state.dashStatusFilter && state.dashStatusFilter !== '__awaiting') n += 1;
    return n;
  }

  function renderDashFilterRow() {
    const head = document.querySelector('#dash-table thead');
    if (!head) return;
    let row = head.querySelector('.col-filter-row');
    if (!row) {
      row = document.createElement('tr');
      row.className = 'col-filter-row';
      head.appendChild(row);
      row.addEventListener('input', onDashFilterChange);
      row.addEventListener('change', onDashFilterChange);
    }
    /*
     * Rebuilt from state, but not while someone is typing in it — replacing the
     * innerHTML would drop focus and the caret after every keystroke.
     */
    if (row.contains(document.activeElement)) return;
    row.innerHTML = DASH_FILTERS.map(dashFilterCell).join('');
    updateDashFilterClear();
  }

  function updateDashFilterClear() {
    const title = els.dashTableTitle;
    if (!title || !title.parentNode) return;
    let btn = document.getElementById('btn-dash-clear-filters');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btn-dash-clear-filters';
      btn.className = 'btn-quiet';
      btn.addEventListener('click', () => {
        state.dashColFilters = {};
        state.dashStatusFilter = '';
        state.dashPage = 1;
        renderKpis(state.kpis || {});
        renderDashFilterRow();
        loadDashTable();
      });
      title.parentNode.insertBefore(btn, title.nextSibling);
    }
    const n = activeDashFilterCount();
    btn.hidden = n === 0;
    btn.textContent = 'Clear ' + n + (n === 1 ? ' filter' : ' filters');
  }

  function onDashFilterChange(e) {
    const el = e.target.closest('[data-colfilter]');
    if (!el) return;
    const key = el.getAttribute('data-colfilter');
    const value = String(el.value || '').trim();
    if (key === 'status') {
      state.dashStatusFilter = value;
      renderKpis(state.kpis || {});
    } else if (value === '') {
      delete state.dashColFilters[key];
    } else {
      state.dashColFilters[key] = value;
    }
    state.dashPage = 1;
    updateDashFilterClear();
    /* Typing is debounced; picking from the select is not. */
    window.clearTimeout(dashFilterTimer);
    const delay = el.tagName === 'SELECT' ? 0 : 300;
    dashFilterTimer = window.setTimeout(loadDashTable, delay);
  }

  /*
   * Summary row under the inspections table.
   *
   * The figures come from the API, not from the rows on screen. The table is
   * paged twenty-five at a time, so adding up what is visible would describe
   * this page while sitting under a heading that counts every matching lot —
   * two different numbers, one row apart.
   *
   * Inspector, job and GPN are counts of distinct values; lot size and sample
   * are totals. The two are labelled differently on purpose: "6 unique" and
   * "9,300" side by side must not read as the same kind of number.
   */
  function renderDashSummary(summary, hasRows) {
    const table = document.getElementById('dash-table');
    if (!table) return;
    let foot = table.querySelector('tfoot');
    if (!hasRows) {
      if (foot) foot.remove();
      return;
    }
    if (!foot) {
      foot = document.createElement('tfoot');
      table.appendChild(foot);
    }
    /*
     * Rows but no figures means the API predates this row and is not sending
     * them. Say so rather than dropping the footer: an absent row and an API
     * that needs deploying look identical from here, and quietly adding up the
     * rows on screen would answer the question with the wrong number.
     */
    if (!summary) {
      foot.innerHTML = '<tr class="summary-row"><td colspan="11" class="summary-missing">'
        + 'Totals unavailable — the API this page is talking to does not send them yet. '
        + 'Deploy the matching version of /api/qc/inspections.'
        + '</td></tr>';
      return;
    }
    const uniq = (n) => (n == null ? '—' : fmtInt(n) + ' unique');
    const lots = Number(summary.lots) || 0;
    foot.innerHTML = '<tr class="summary-row">'
      + '<th scope="row">Totals<span class="summary-sub">'
        + fmtInt(lots) + (lots === 1 ? ' lot' : ' lots') + '</span></th>'
      + '<td></td>'
      + '<td title="Distinct inspectors across every lot matching these filters">'
        + escapeHtml(uniq(summary.inspectors)) + '</td>'
      + '<td title="Distinct job numbers across every lot matching these filters">'
        + escapeHtml(uniq(summary.jobs)) + '</td>'
      + '<td title="Distinct GPN numbers across every lot matching these filters">'
        + escapeHtml(uniq(summary.gpns)) + '</td>'
      + '<td class="num" title="Lot size added up across every lot matching these filters">'
        + escapeHtml(summary.totalLotSize == null ? '—' : fmtInt(summary.totalLotSize)) + '</td>'
      + '<td class="num" title="Sample size added up across every lot matching these filters">'
        + escapeHtml(summary.totalSampleSize == null ? '—' : fmtInt(summary.totalSampleSize)) + '</td>'
      + '<td></td><td></td><td></td><td></td>'
      + '</tr>';
  }

  async function loadDashTable() {
    renderDashFilterRow();
    els.dashBody.innerHTML = '<tr><td colspan="11" class="empty">Loading inspections…</td></tr>';
    const status = state.dashStatusFilter && state.dashStatusFilter !== '__awaiting' ? state.dashStatusFilter : '';
    if (state.dashStatusFilter === '__awaiting') {
      setHash('pending');
      return;
    }
    try {
      const range = dashDateRange();
      const data = await api('/qc/inspections?' + qs({
        ...commonParams(),
        from: range.from,
        to: range.to,
        jobNo: els.dashJob.value.trim(),
        status,
        ...state.dashColFilters,
        page: state.dashPage,
        pageSize: PAGE_SIZE
      }));
      const rows = data.rows || [];
      state.dashTotal = Number(data.total) || 0;
      renderDashSummary(data.summary, rows.length > 0);
      els.dashTableTitle.textContent = status
        ? ('Inspections — ' + statusWord(status) + ' (' + state.dashTotal + ')')
        : ('Inspections (' + state.dashTotal + ')');
      if (!rows.length) {
        els.dashBody.innerHTML = '<tr><td colspan="11" class="empty">'
          + (activeDashFilterCount()
              ? 'No inspections match these filters. Clearing them is the button beside the heading.'
              : 'No inspections in this filter.')
          + '</td></tr>';
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
      renderDashSummary(null, false);
      els.dashBody.innerHTML = '<tr><td colspan="11" class="empty">' + escapeHtml(err.message) + '</td></tr>';
    }
  }

  async function route() {
    if (!showLoggedIn()) return;
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
      bindDateLimits();
      dashDateRange();
      if (!state.dashLoaded) await loadDashboard();
      return;
    }
    showView('pending');
    bindDateLimits();
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
    renderPending();
  });
  els.btnPendingNext.addEventListener('click', () => {
    state.pendingPage += 1;
    renderPending();
  });
  els.pendingSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.pendingPage = 1;
      renderPending();
    }, 200);
  });
  els.pendingRange.addEventListener('change', () => {
    state.pendingPage = 1;
    loadPending();
  });
  function onPendingCustomDate() {
    if (!els.pendingRange || els.pendingRange.value !== 'custom') return;
    state.pendingPage = 1;
    loadPending();
  }
  els.pendingFrom.addEventListener('change', onPendingCustomDate);
  els.pendingTo.addEventListener('change', onPendingCustomDate);
  if (els.pendingTable) {
    els.pendingTable.addEventListener('input', (e) => {
      const input = e.target.closest('input[data-col]');
      if (!input) return;
      const col = input.getAttribute('data-col');
      if (!col || !(col in state.colFilters)) return;
      state.colFilters[col] = input.value;
      state.pendingPage = 1;
      renderPending();
    });
  }
  if (els.btnPendingExport) {
    els.btnPendingExport.addEventListener('click', exportPendingExcel);
  }
  els.pendingBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-start]');
    if (!btn) return;
    const row = state.pendingRows[Number(btn.getAttribute('data-start'))];
    if (!row) return;
    const skip = qcSkipReason(row);
    if (skip) {
      showStatus(skip, true);
      return;
    }
    openForm(row);
  });

  els.loginDatabase.addEventListener('change', () => {
    els.loginError.hidden = true;
    els.loginError.textContent = '';
    loadLoginUsers();
  });

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = String(els.loginUsername.value || '').trim();
    const database = String(els.loginDatabase.value || '').trim();
    els.loginError.hidden = true;
    els.loginError.textContent = '';
    if (!username || !database) {
      els.loginError.textContent = 'Select username and database.';
      els.loginError.hidden = false;
      return;
    }
    els.btnLogin.disabled = true;
    try {
      const data = await api('/qc/login?' + qs({ username, database }));
      setSession({
        userId: data.userId,
        userName: data.userName || username,
        database: data.database || database
      });
      state.dashLoaded = false;
      state.pendingPage = 1;
      await route();
    } catch (err) {
      els.loginError.textContent = err.message || 'Login failed.';
      els.loginError.hidden = false;
    } finally {
      els.btnLogin.disabled = false;
    }
  });

  els.btnLogout.addEventListener('click', () => {
    clearSession();
    state.dashLoaded = false;
    state.pendingPage = 1;
    showLoggedOut();
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
  els.dashRange.addEventListener('change', () => {
    state.dashPage = 1;
    state.dashLoaded = false;
    loadDashboard();
  });
  function onDashCustomDate() {
    if (!els.dashRange || els.dashRange.value !== 'custom') return;
    state.dashPage = 1;
    state.dashLoaded = false;
    loadDashboard();
  }
  els.dashFrom.addEventListener('change', onDashCustomDate);
  els.dashTo.addEventListener('change', onDashCustomDate);
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
    try { localStorage.removeItem('fgqc-company'); } catch (e) { /* ignore */ }
    try { localStorage.removeItem('fgqc-inspector'); } catch (e) { /* ignore */ }
    try { localStorage.removeItem('fgqc-database'); } catch (e) { /* ignore */ }
    if (getSession()) {
      await route();
    } else {
      showLoggedOut();
    }
  })();
})();
