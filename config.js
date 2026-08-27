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

/** Go-live cutoff: without this, every historical GPN appears in the queue. */
window.AppConfig.fromGPNDate = window.AppConfig.fromGPNDate || '2026-08-01';
/** Sampling plans and QC settings in Indus are stored against CompanyID = 1. */
window.AppConfig.companyId = window.AppConfig.companyId || 1;
window.AppConfig.defaultDatabase = window.AppConfig.defaultDatabase || 'KOL';
window.AppConfig.pageSize = window.AppConfig.pageSize || 25;
/** A shift is treated as 8 hours for "waiting too long" highlighting. */
window.AppConfig.shiftHours = window.AppConfig.shiftHours || 8;
