window.AppConfig = window.AppConfig || {};

(function () {
  var loc = window.location || {};
  var protocol = loc.protocol || '';
  var host = String(loc.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  var port = String(loc.port || '');
  var isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
  var isLoopback = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  var isLocal = protocol === 'file:' || isLoopback || isPrivateIp;

  if (!window.AppConfig.apiBaseUrl) {
    if (protocol === 'file:') {
      window.AppConfig.apiBaseUrl = 'http://127.0.0.1:3001/api';
    } else if (isLocal && (port === '3001' || port === '')) {
      window.AppConfig.apiBaseUrl = loc.origin + '/api';
    } else if (isLocal) {
      var apiHost = host === '::1' ? '127.0.0.1' : host;
      window.AppConfig.apiBaseUrl = 'http://' + apiHost + ':3001/api';
    } else {
      window.AppConfig.apiBaseUrl = 'https://cdcapi.onrender.com/api';
    }
  }
})();

/**
 * Go-live cutoff: without this, every historical GPN appears in the queue.
 *
 * 1 April 2026 — the start of the financial year, so the queue and the date
 * pickers reach back over the whole of it. The API keeps the same date in
 * FGQC_FROM_GPN_DATE; the two have to move together or the count on the
 * dashboard will not match the list behind it.
 */
window.AppConfig.fromGPNDate = window.AppConfig.fromGPNDate || '2026-04-01';
/**
 * The company the FG QC data lives under in Indus. This one value is sent to
 * all three procedures — the pending queue, the template, and the save — so it
 * has to be the company that owns the GPNs, the sampling plans and the
 * parameter master alike. Get it wrong and the queue comes back empty with no
 * error: the spec marks FinishGoodsTransactionMain.CompanyID [VERIFY] for
 * exactly this reason. Keep it in step with FGQC_COMPANY_ID on the API.
 */
window.AppConfig.companyId = window.AppConfig.companyId || 2;
window.AppConfig.defaultDatabase = window.AppConfig.defaultDatabase || 'KOL';
window.AppConfig.pageSize = window.AppConfig.pageSize || 25;
/** A shift is treated as 8 hours for "waiting too long" highlighting. */
window.AppConfig.shiftHours = window.AppConfig.shiftHours || 8;
