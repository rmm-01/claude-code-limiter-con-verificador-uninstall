/**
 * app.js — Main SPA logic for the Claude Code Limiter dashboard.
 * Hash-based routing, API client, page renderers, event delegation.
 */
(function () {
  'use strict';

  /* ================================================================
     STATE
     ================================================================ */
  var state = {
    token: localStorage.getItem('clm_token') || null,
    team: null,
    users: [],
    events: [],         // live feed events
    refreshTimer: null,
    currentRoute: null,
  };

  /* ================================================================
     API CLIENT
     ================================================================ */
  var API = {
    /** @param {string} path @param {object} [opts] @returns {Promise<object>} */
    _fetch: function (path, opts) {
      opts = opts || {};
      var headers = { 'Content-Type': 'application/json' };
      if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
      return fetch(path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }).then(function (res) {
        if (res.status === 401) {
          state.token = null;
          localStorage.removeItem('clm_token');
          navigate('login');
          return Promise.reject(new Error('Sesión expirada'));
        }
        return res.json().then(function (data) {
          if (!res.ok) return Promise.reject(new Error(data.error || 'Error en la solicitud'));
          return data;
        });
      });
    },

    login: function (password) {
      return API._fetch('/api/admin/login', { method: 'POST', body: { password: password } });
    },

    getUsers: function () {
      return API._fetch('/api/admin/users');
    },

    getUser: function (id) {
      return API._fetch('/api/admin/users').then(function (data) {
        var user = null;
        for (var i = 0; i < data.users.length; i++) {
          if (data.users[i].id === id) { user = data.users[i]; break; }
        }
        if (!user) return Promise.reject(new Error('User not found'));
        return user;
      });
    },

    createUser: function (body) {
      return API._fetch('/api/admin/users', { method: 'POST', body: body });
    },

    updateUser: function (id, body) {
      return API._fetch('/api/admin/users/' + id, { method: 'PUT', body: body });
    },

    deleteUser: function (id) {
      return API._fetch('/api/admin/users/' + id, { method: 'DELETE' });
    },

    getUsage: function (params) {
      var qs = '';
      if (params) {
        var parts = [];
        for (var k in params) {
          if (params[k] != null) parts.push(k + '=' + encodeURIComponent(params[k]));
        }
        qs = '?' + parts.join('&');
      }
      return API._fetch('/api/admin/usage' + qs);
    },

    getEvents: function (params) {
      var qs = '';
      if (params) {
        var parts = [];
        for (var k in params) {
          if (params[k] != null) parts.push(k + '=' + encodeURIComponent(params[k]));
        }
        qs = '?' + parts.join('&');
      }
      return API._fetch('/api/admin/events' + qs);
    },

    updateSettings: function (body) {
      return API._fetch('/api/admin/settings', { method: 'PUT', body: body });
    },

    getAnalytics: function (params) {
      var qs = '';
      if (params) {
        var parts = [];
        for (var k in params) {
          if (params[k] != null) parts.push(k + '=' + encodeURIComponent(params[k]));
        }
        qs = '?' + parts.join('&');
      }
      return API._fetch('/api/admin/analytics' + qs);
    },

    getUsageVersions: function (params) {
      var qs = '';
      if (params) {
        var parts = [];
        for (var k in params) {
          if (params[k] != null) parts.push(k + '=' + encodeURIComponent(params[k]));
        }
        qs = '?' + parts.join('&');
      }
      return API._fetch('/api/admin/usage/versions' + qs);
    },
  };

  /* ================================================================
     TOAST NOTIFICATIONS
     ================================================================ */
  var toastCounter = 0;

  /**
   * Show a toast notification.
   * @param {string} title
   * @param {string} message
   * @param {'info'|'success'|'warning'|'error'} [type]
   * @param {number} [duration] - ms, default 5000
   */
  function showToast(title, message, type, duration) {
    type = type || 'info';
    duration = duration || 5000;
    var id = 'toast-' + (++toastCounter);
    var icons = { info: '\u2139\uFE0F', success: '\u2705', warning: '\u26A0\uFE0F', error: '\u274C' };

    var container = document.getElementById('toast-container');
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.id = id;
    el.innerHTML =
      '<span class="toast-icon">' + (icons[type] || '') + '</span>' +
      '<div class="toast-body">' +
        '<div class="toast-title">' + escapeHtml(title) + '</div>' +
        '<div class="toast-message">' + escapeHtml(message) + '</div>' +
      '</div>' +
      '<button class="toast-close" data-toast-close="' + id + '">&times;</button>';
    container.appendChild(el);

    var removeTimer = setTimeout(function () { removeToast(id); }, duration);

    el.querySelector('.toast-close').addEventListener('click', function () {
      clearTimeout(removeTimer);
      removeToast(id);
    });
  }

  function removeToast(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add('removing');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
  }

  /* ================================================================
     CONFIRM DIALOG
     ================================================================ */
  /**
   * Show a confirm dialog. Returns a Promise that resolves true/false.
   * @param {string} title
   * @param {string} message
   * @param {string} [okLabel]
   * @returns {Promise<boolean>}
   */
  function confirmDialog(title, message, okLabel) {
    return new Promise(function (resolve) {
      var overlay = document.getElementById('confirm-overlay');
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      var okBtn = document.getElementById('confirm-ok');
      okBtn.textContent = okLabel || 'Confirm';
      overlay.classList.remove('hidden');

      function cleanup(result) {
        overlay.classList.add('hidden');
        document.getElementById('confirm-cancel').removeEventListener('click', onCancel);
        okBtn.removeEventListener('click', onOk);
        resolve(result);
      }
      function onCancel() { cleanup(false); }
      function onOk() { cleanup(true); }

      document.getElementById('confirm-cancel').addEventListener('click', onCancel);
      okBtn.addEventListener('click', onOk);
    });
  }

  /* ================================================================
     MODAL HELPERS
     ================================================================ */
  function openModal(html) {
    var overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-content').innerHTML = html;
    overlay.classList.remove('hidden');
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.getElementById('modal-content').innerHTML = '';
  }

  /* ================================================================
     COPY TO CLIPBOARD
     ================================================================ */
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('Copiado', 'Comando copiado al portapapeles', 'success', 2500);
      }).catch(function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Copied', 'Command copied to clipboard', 'success', 2500);
    } catch (e) {
      showToast('Error', 'No se pudo copiar al portapapeles', 'error');
    }
    document.body.removeChild(ta);
  }

  /* ================================================================
     UTILITY HELPERS
     ================================================================ */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(dateStr) {
    if (!dateStr) return 'nunca';
    var d = new Date(dateStr);
    var now = Date.now();
    var diff = now - d.getTime();
    if (diff < 0) return 'ahora mismo';
    var seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'hace ' + seconds + 's';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return 'hace ' + minutes + 'm';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return 'hace ' + hours + 'h';
    var days = Math.floor(hours / 24);
    return 'hace ' + days + 'd';
  }

  function formatTime(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var h = d.getHours();
    var m = d.getMinutes();
    var s = d.getSeconds();
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  /** Generate a deterministic color from a string (for avatars). */
  function hashColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    var hues = [210, 150, 340, 40, 280, 180, 20, 100, 300, 60];
    var hue = hues[Math.abs(hash) % hues.length];
    return 'hsl(' + hue + ', 60%, 55%)';
  }

  function initials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function statusBadge(status) {
    var cls = 'badge badge-' + (status || 'active');
    var labels = { active: 'activo', paused: 'pausado', killed: 'revocado' };
    return '<span class="' + cls + '">' + escapeHtml(labels[status] || status || 'activo') + '</span>';
  }

  /** Get a usage percentage for progress bars. */
  function usagePct(used, limit) {
    if (limit <= 0) return 0;
    var p = used / limit;
    return p > 1 ? 1 : p;
  }

  function progressClass(pct) {
    if (pct >= 0.9) return 'progress-fill-danger';
    if (pct >= 0.7) return 'progress-fill-warn';
    return 'progress-fill-ok';
  }

  function renderProgressBar(label, used, limit, large) {
    var pct = limit > 0 ? usagePct(used, limit) : 0;
    var cls = progressClass(pct);
    var barCls = large ? 'progress-bar progress-bar-lg' : 'progress-bar';
    var valStr = used + (limit > 0 ? ' / ' + limit : (limit === -1 ? ' / unlimited' : ''));
    return (
      '<div class="progress-row">' +
        '<div class="progress-label">' +
          '<span class="progress-label-name">' + escapeHtml(label) + '</span>' +
          '<span class="progress-label-value">' + valStr + '</span>' +
        '</div>' +
        '<div class="' + barCls + '">' +
          '<div class="progress-fill ' + cls + '" style="width:' + (pct * 100).toFixed(1) + '%"></div>' +
        '</div>' +
      '</div>'
    );
  }

  /** Extract the per-model limit value for a given model and window from a user's limits array. */
  function getModelLimit(limits, model, windowType) {
    windowType = windowType || 'daily';
    for (var i = 0; i < limits.length; i++) {
      var r = limits[i];
      if (r.type === 'per_model' && r.model === model && r.window === windowType) return r.value;
    }
    return -1; // unlimited
  }

  function getCreditRule(limits) {
    for (var i = 0; i < limits.length; i++) {
      if (limits[i].type === 'credits') return limits[i];
    }
    return null;
  }

  /* ================================================================
     ROUTER
     ================================================================ */
  function getRoute() {
    var hash = location.hash.replace(/^#\/?/, '');
    if (!hash) return { page: 'overview', params: {} };
    var parts = hash.split('/');
    var page = parts[0];
    var params = {};
    if (page === 'user' && parts[1]) params.id = parts[1];
    return { page: page, params: params };
  }

  function navigate(page, params) {
    var hash = '#' + page;
    if (params && params.id) hash += '/' + params.id;
    location.hash = hash;
  }

  function handleRoute() {
    var route = getRoute();
    state.currentRoute = route;

    // Auth gate
    if (!state.token && route.page !== 'login') {
      navigate('login');
      return;
    }
    if (state.token && route.page === 'login') {
      navigate('overview');
      return;
    }

    // Show/hide screens
    var loginScreen = document.getElementById('login-screen');
    var appShell = document.getElementById('app-shell');

    if (route.page === 'login') {
      loginScreen.classList.remove('hidden');
      appShell.classList.add('hidden');
      stopAutoRefresh();
      WS.disconnect();
      return;
    }

    loginScreen.classList.add('hidden');
    appShell.classList.remove('hidden');

    // Connect WS if not connected
    if (!WS.isConnected()) WS.connect();

    // Update sidebar active state
    var links = document.querySelectorAll('.nav-link');
    for (var i = 0; i < links.length; i++) {
      var linkPage = links[i].getAttribute('data-page');
      if (linkPage === route.page || (linkPage === 'users' && route.page === 'user')) {
        links[i].classList.add('active');
      } else {
        links[i].classList.remove('active');
      }
    }

    // Close mobile sidebar
    closeMobileSidebar();

    // Render the page
    renderPage(route);
  }

  function renderPage(route) {
    var content = document.getElementById('content');
    content.innerHTML = '<div class="spinner"></div>';

    switch (route.page) {
      case 'overview':
      case 'users':
        renderOverview(content);
        break;
      case 'user':
        renderUserDetail(content, route.params.id);
        break;
      case 'analytics':
        renderAnalytics(content);
        break;
      case 'settings':
        renderSettings(content);
        break;
      default:
        content.innerHTML = '<div class="empty-state"><p>Page not found</p></div>';
    }
  }

  /* ================================================================
     PAGE: OVERVIEW / USERS
     ================================================================ */
  function renderOverview(container) {
    Promise.all([API.getUsers(), API.getEvents({ limit: 30 })])
      .then(function (results) {
        var usersData = results[0];
        var eventsData = results[1];
        state.users = usersData.users;

        var users = usersData.users;
        var events = eventsData.events || [];

        // Stats
        var totalUsers = users.length;
        var activeUsers = users.filter(function (u) { return u.status === 'active'; }).length;
        var pausedUsers = users.filter(function (u) { return u.status === 'paused'; }).length;
        var killedUsers = users.filter(function (u) { return u.status === 'killed'; }).length;
        var totalCreditsUsed = 0;
        var totalCreditBudget = 0;
        for (var ci = 0; ci < users.length; ci++) {
          if (users[ci].credit_budget && users[ci].credit_budget > 0) {
            totalCreditsUsed += (users[ci].credit_budget - (users[ci].credit_balance || 0));
            totalCreditBudget += users[ci].credit_budget;
          }
        }

        var html = '';
        html += '<div class="page-header">';
        html += '  <h2>Resumen</h2>';
        html += '  <div class="page-header-actions">';
        html += '    <button class="btn btn-secondary" data-action="explain-credits">¿Cómo funcionan los créditos?</button>';
        html += '    <button class="btn btn-primary" data-action="add-user">+ Agregar Usuario</button>';
        html += '  </div>';
        html += '</div>';

        // Stats row
        html += '<div class="stats-row">';
        html += statCard('Total Usuarios', totalUsers, '');
        html += statCard('Activos', activeUsers, '', 'text-green');
        html += statCard('Pausados', pausedUsers, '', 'text-yellow');
        html += statCard('Eliminados', killedUsers, '', 'text-red');
        html += '</div>';

        // Two column: user cards + live feed
        html += '<div class="two-col">';

        // User cards
        html += '<div>';
        html += '<div class="card mb-2"><div class="card-header"><h3>Usuarios</h3></div>';
        if (users.length === 0) {
          html += '<div class="card-body"><div class="empty-state"><p>Sin usuarios. Click en "Agregar Usuario" para comenzar.</p></div></div>';
        } else {
          html += '<div class="card-body"><div class="user-grid" style="margin-bottom:0">';
          for (var i = 0; i < users.length; i++) {
            html += renderUserCard(users[i]);
          }
          html += '</div></div>';
        }
        html += '</div></div>';

        // Live feed
        html += '<div>';
        html += '<div class="card"><div class="card-header"><h3>Actividad en Vivo</h3></div>';
        html += '<div class="card-body-flush"><div class="live-feed" id="live-feed">';
        if (events.length === 0) {
          html += '<div class="feed-empty">Sin actividad aún. Los eventos aparecerán aquí en tiempo real.</div>';
        } else {
          for (var j = 0; j < events.length; j++) {
            html += renderFeedItem(eventToFeed(events[j]));
          }
        }
        html += '</div></div></div>';
        html += '</div>';

        html += '</div>'; // .two-col

        container.innerHTML = html;
        startAutoRefresh();
      })
      .catch(function (err) {
        container.innerHTML = '<div class="empty-state"><p>Error al cargar datos: ' + escapeHtml(err.message) + '</p></div>';
      });
  }

  function statCard(label, value, sub, colorClass) {
    return (
      '<div class="stat-card">' +
        '<div class="stat-label">' + escapeHtml(label) + '</div>' +
        '<div class="stat-value ' + (colorClass || '') + '">' + escapeHtml(String(value)) + '</div>' +
        (sub ? '<div class="stat-sub">' + escapeHtml(sub) + '</div>' : '') +
      '</div>'
    );
  }

  function renderUserCard(user) {
    var limits = user.limits || [];
    var usage = user.usage || {};
    var dailyUsage = (usage.daily && usage.daily.counts) ? usage.daily.counts : {};

    // Primary progress: credit budget or total daily prompts
    var progressHtml = '';
    var creditRule = getCreditRule(limits);
    if (creditRule && user.credit_budget > 0) {
      var creditUsed = user.credit_budget - (user.credit_balance || 0);
      progressHtml += renderProgressBar('Credits', creditUsed, user.credit_budget, false);
    }

    // Per-model bars
    var models = ['fable', 'opus', 'sonnet', 'haiku'];
    for (var mi = 0; mi < models.length; mi++) {
      var m = models[mi];
      var mLimit = getModelLimit(limits, m);
      var mUsed = dailyUsage[m] || 0;
      if (mLimit > 0 || mUsed > 0) {
        progressHtml += renderProgressBar(m, mUsed, mLimit > 0 ? mLimit : 0, false);
      }
    }
    if (!progressHtml) {
      progressHtml = '<div class="text-muted text-sm">Sin límites configurados</div>';
    }

    var color = hashColor(user.name || user.slug);

    return (
      '<div class="user-card" data-action="view-user" data-user-id="' + user.id + '" data-status="' + escapeHtml(user.status || 'active') + '">' +
        '<div class="user-card-head">' +
          '<div class="user-card-info">' +
            '<div class="user-avatar" style="background:' + color + '">' + initials(user.name) + '</div>' +
            '<div>' +
              '<div class="user-card-name">' + escapeHtml(user.name) + '</div>' +
              '<div class="user-card-slug">@' + escapeHtml(user.slug) + '</div>' +
            '</div>' +
          '</div>' +
          statusBadge(user.status) +
        '</div>' +
        '<div class="user-card-usage">' + progressHtml + '</div>' +
        '<div class="user-card-actions">' +
          (user.status === 'active'
            ? '<button class="btn btn-sm btn-warning" data-action="pause-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Pausar</button>'
              + '<button class="btn btn-sm btn-danger" data-action="kill-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Revocar</button>'
            : user.status === 'paused'
            ? '<button class="btn btn-sm btn-success" data-action="reinstate-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Reactivar</button>'
              + '<button class="btn btn-sm btn-danger" data-action="kill-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Revocar</button>'
            : '<button class="btn btn-sm btn-success" data-action="reinstate-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Reactivar</button>'
          ) +
        '</div>' +
      '</div>'
    );
  }

  /* ================================================================
     LIVE FEED HELPERS
     ================================================================ */
  /** Convert a usage_event DB row into a feed display object. */
  function eventToFeed(evt) {
    return {
      type: 'counted',
      user: evt.user_name || evt.userName || 'Unknown',
      detail: evt.model + ' (+' + evt.credit_cost + ' credits)',
      time: evt.timestamp,
    };
  }

  /** Convert a WebSocket event into a feed display object. */
  function wsEventToFeed(evt) {
    switch (evt.type) {
      case 'user_check':
        return { type: 'check', user: evt.userName, detail: 'Verificando ' + (evt.model || ''), time: evt.timestamp };
      case 'user_blocked':
        return { type: 'blocked', user: evt.userName, detail: 'Bloqueado en ' + (evt.model || '') + (evt.reason ? ': ' + evt.reason.split('\n')[0] : ''), time: evt.timestamp };
      case 'user_counted':
        return { type: 'counted', user: evt.userName, detail: (evt.model || '') + ' (+' + (evt.creditCost || 0) + ' créditos)', time: evt.timestamp };
      case 'user_status_change':
      case 'user_killed':
        return { type: 'status', user: evt.userName, detail: (evt.oldStatus || '?') + ' -> ' + (evt.newStatus || '?'), time: evt.timestamp };
      case 'user_status':
        return { type: 'check', user: evt.userName, detail: 'Inicio de sesión (' + (evt.model || '') + ')', time: evt.timestamp };
      default:
        return null;
    }
  }

  function renderFeedItem(feed) {
    if (!feed) return '';
    var dotCls = 'feed-dot feed-dot-' + (feed.type || 'system');
    return (
      '<div class="feed-item">' +
        '<span class="' + dotCls + '"></span>' +
        '<div class="feed-content">' +
          '<span class="feed-user">' + escapeHtml(feed.user) + '</span> ' +
          '<span class="feed-detail">' + escapeHtml(feed.detail) + '</span>' +
        '</div>' +
        '<span class="feed-time">' + formatTime(feed.time) + '</span>' +
      '</div>'
    );
  }

  function addLiveFeedItem(feed) {
    var feedEl = document.getElementById('live-feed');
    if (!feedEl) return;

    // Remove empty state message if present
    var empty = feedEl.querySelector('.feed-empty');
    if (empty) empty.remove();

    var div = document.createElement('div');
    div.innerHTML = renderFeedItem(feed);
    var newItem = div.firstElementChild;
    if (newItem) {
      feedEl.insertBefore(newItem, feedEl.firstChild);
      // Keep feed to 50 items max
      while (feedEl.children.length > 50) {
        feedEl.removeChild(feedEl.lastChild);
      }
    }
  }

  /* ================================================================
     PAGE: USER DETAIL
     ================================================================ */
  function renderUserDetail(container, userId) {
    Promise.all([API.getUser(userId), API.getUsage({ user_id: userId, days: 30 }), API.getEvents({ user_id: userId, limit: 20 }), API.getAnalytics({ user_id: userId, days: 30 }), API.getUsageVersions({ user_id: userId, days: 30 })])
      .then(function (results) {
        var user = results[0];
        var usageData = results[1];
        var eventsData = results[2];
        var userAnalytics = results[3] || {};
        var versionsData = (results[4] && results[4].versions) || [];
        var limits = user.limits || [];
        var usage = user.usage || {};
        var dailyUsage = (usage.daily && usage.daily.counts) ? usage.daily.counts : {};
        var color = hashColor(user.name || user.slug);

        var html = '';
        // Breadcrumb
        html += '<div class="breadcrumb"><a href="#overview">Resumen</a> / <span>' + escapeHtml(user.name) + '</span></div>';

        // Tamper detection banner
        if (user.last_tampering_at && (Date.now() - new Date(user.last_tampering_at).getTime()) < 2 * 60 * 60 * 1000) {
          html += '<div class="alert alert-danger" style="margin-bottom:1rem;padding:0.75rem 1rem;border-radius:8px;border:1px solid rgba(248,81,73,0.4);background:rgba(248,81,73,0.1);color:#f0a0a0;font-size:0.85rem">';
          html += '<strong>⚠ Manipulación detectada.</strong> ';
          html += 'El hook reportó que <code>managed-settings.json</code> de este usuario no coincide con el hash esperado. ';
          html += 'Última detección: ' + new Date(user.last_tampering_at).toLocaleString() + '.';
          html += '</div>';
        }

        html += '<div class="page-header"><h2>' + escapeHtml(user.name) + '</h2>';
        html += '<div class="page-header-actions">';
        html += '<button class="btn btn-sm btn-secondary" data-action="explain-credits">¿Cómo funcionan los créditos?</button>';
        html += '<button class="btn btn-sm" data-action="edit-limits" data-user-id="' + user.id + '">Editar Límites</button>';
        html += '<button class="btn btn-sm btn-danger" data-action="delete-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Eliminar Usuario</button>';
        html += '</div></div>';

        html += '<div class="detail-grid">';

        // Left sidebar card
        html += '<div class="card"><div class="card-body detail-sidebar-card">';
        html += '<div class="detail-avatar" style="background:' + color + '">' + initials(user.name) + '</div>';
        html += '<div class="detail-name">' + escapeHtml(user.name) + '</div>';
        html += '<div class="detail-meta">@' + escapeHtml(user.slug) + '</div>';
        html += statusBadge(user.status);
        html += '<div class="detail-meta">Última vez: ' + timeAgo(user.last_seen) + '</div>';
        html += '<div class="detail-meta">Creado: ' + (user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A') + '</div>';
        html += '<div class="detail-actions">';
        if (user.status === 'active') {
          html += '<button class="btn btn-sm btn-warning btn-block" data-action="pause-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Pausar Usuario</button>';
          html += '<button class="btn btn-sm btn-danger btn-block" data-action="kill-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Revocar Acceso</button>';
        } else if (user.status === 'paused') {
          html += '<button class="btn btn-sm btn-success btn-block" data-action="reinstate-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Reactivar</button>';
          html += '<button class="btn btn-sm btn-danger btn-block" data-action="kill-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Revocar Acceso</button>';
        } else {
          html += '<button class="btn btn-sm btn-success btn-block" data-action="reinstate-user" data-user-id="' + user.id + '" data-user-name="' + escapeHtml(user.name) + '">Reactivar</button>';
        }
        html += '</div>';

        // Self-uninstall toggle
        var canUninstall = !!user.allow_self_uninstall;
        html += '<div class="detail-toggle-row">';
        html += '<span class="detail-toggle-label">Permitir desinstalación propia</span>';
        html += '<button class="btn btn-sm ' + (canUninstall ? 'btn-success' : 'btn-ghost') + '" ' +
                'data-action="toggle-self-uninstall" data-user-id="' + user.id + '" ' +
                'data-user-name="' + escapeHtml(user.name) + '" ' +
                'data-current="' + (canUninstall ? '1' : '0') + '">' +
                (canUninstall ? 'Habilitado' : 'Deshabilitado') +
                '</button>';
        html += '</div>';

        // Agent View / Remote Control toggle
        var canAgents = !!user.allow_agents;
        html += '<div class="detail-toggle-row">';
        html += '<span class="detail-toggle-label">Permitir Agent View / Remote Control</span>';
        html += '<button class="btn btn-sm ' + (canAgents ? 'btn-success' : 'btn-ghost') + '" ' +
                'data-action="toggle-allow-agents" data-user-id="' + user.id + '" ' +
                'data-user-name="' + escapeHtml(user.name) + '" ' +
                'data-current="' + (canAgents ? '1' : '0') + '">' +
                (canAgents ? 'Habilitado' : 'Deshabilitado') +
                '</button>';
        html += '</div>';

        // Workflows / Subagents toggle
        var canWorkflows = !!user.allow_workflows;
        html += '<div class="detail-toggle-row">';
        html += '<span class="detail-toggle-label">Permitir Workflows / Subagentes</span>';
        html += '<button class="btn btn-sm ' + (canWorkflows ? 'btn-success' : 'btn-ghost') + '" ' +
                'data-action="toggle-allow-workflows" data-user-id="' + user.id + '" ' +
                'data-user-name="' + escapeHtml(user.name) + '" ' +
                'data-current="' + (canWorkflows ? '1' : '0') + '">' +
                (canWorkflows ? 'Habilitado' : 'Deshabilitado') +
                '</button>';
        html += '</div>';

        // Max effort level selector
        var maxEffort = user.max_effort_level || 'max';
        html += '<div class="detail-toggle-row">';
        html += '<span class="detail-toggle-label">Effort Máximo</span>';
        html += '<select class="btn btn-sm btn-ghost" data-action="change-max-effort" data-user-id="' + user.id + '" ' +
                'data-user-name="' + escapeHtml(user.name) + '">';
        var effortLevels = ['low', 'medium', 'high', 'xhigh', 'max'];
        for (var ei = 0; ei < effortLevels.length; ei++) {
          var lbl = effortLevels[ei] === 'max' ? 'Max (sin límite)' : effortLevels[ei].charAt(0).toUpperCase() + effortLevels[ei].slice(1);
          html += '<option value="' + effortLevels[ei] + '"' + (maxEffort === effortLevels[ei] ? ' selected' : '') + '>' + lbl + '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Credit gauge
        var creditRule = getCreditRule(limits);
        if (creditRule && user.credit_budget > 0) {
          html += '<div class="gauge-wrap"><canvas id="credit-gauge" width="180" height="180"></canvas></div>';
        }

        html += '</div></div>'; // card

        // Right content area
        html += '<div>';

        // Per-model usage bars
        html += '<div class="card mb-2"><div class="card-header"><h3>Uso por Modelo (Diario)</h3></div>';
        html += '<div class="card-body"><div class="chart-container"><canvas id="model-bars"></canvas></div></div>';
        html += '</div>';

        // Usage by version
        if (versionsData.length > 0) {
          html += '<div class="card mb-2"><div class="card-header"><h3>Uso por Versión</h3></div>';
          html += '<div class="card-body-flush"><div class="table-wrap"><table>';
          html += '<thead><tr><th>Versión</th><th>Turnos</th><th>Créditos</th></tr></thead><tbody>';
          for (var vi = 0; vi < versionsData.length; vi++) {
            var vr = versionsData[vi];
            html += '<tr>';
            html += '<td class="text-mono text-sm">' + escapeHtml(vr.model_version || vr.model) + '</td>';
            html += '<td class="text-mono">' + vr.count + '</td>';
            html += '<td class="text-mono">' + vr.total_credits + '</td>';
            html += '</tr>';
          }
          html += '</tbody></table></div></div></div>';
        }

        // Active limits
        html += '<div class="card mb-2"><div class="card-header"><h3>Límites Activos</h3>';
        html += '<button class="btn btn-sm" data-action="edit-limits" data-user-id="' + user.id + '">Editar</button>';
        html += '</div>';
        html += '<div class="card-body">';
        if (limits.length === 0) {
          html += '<div class="text-muted text-sm">Sin límites configurados. Este usuario tiene acceso ilimitado.</div>';
        } else {
          html += '<ul class="limits-list">';
          for (var li = 0; li < limits.length; li++) {
            html += renderLimitItem(limits[li]);
          }
          html += '</ul>';
        }
        html += '</div></div>';

        // 30-day trend
        html += '<div class="card mb-2"><div class="card-header"><h3>Tendencia de Uso (30 días)</h3></div>';
        html += '<div class="card-body"><div class="chart-container"><canvas id="trend-chart"></canvas></div></div>';
        html += '</div>';

        // Recent events
        html += '<div class="card"><div class="card-header"><h3>Actividad Reciente</h3></div>';
        html += '<div class="card-body-flush"><div class="table-wrap"><table>';
        html += '<thead><tr><th>Hora</th><th>Modelo</th><th>Créditos</th></tr></thead><tbody>';
        var events = eventsData.events || [];
        if (events.length === 0) {
          html += '<tr><td colspan="3" class="text-center text-muted">Sin actividad reciente</td></tr>';
        } else {
          for (var ei = 0; ei < events.length; ei++) {
            var ev = events[ei];
            html += '<tr>';
            html += '<td class="text-mono text-sm">' + timeAgo(ev.timestamp) + '</td>';
            html += '<td><span class="badge badge-model">' + escapeHtml(ev.model) + '</span></td>';
            html += '<td class="text-mono">' + ev.credit_cost + '</td>';
            html += '</tr>';
          }
        }
        html += '</tbody></table></div></div></div>';

        // Devices for this user
        var userDevices = user.devices || [];
        if (userDevices.length > 0) {
          html += '<div class="card mb-2"><div class="card-header"><h3>Dispositivos</h3></div>';
          html += '<div class="card-body-flush"><div class="table-wrap"><table>';
          html += '<thead><tr><th>Hostname</th><th>Plataforma</th><th>Versión Claude</th><th>Última Vez</th><th>IP</th></tr></thead><tbody>';
          for (var dvi = 0; dvi < userDevices.length; dvi++) {
            var dv = userDevices[dvi];
            html += '<tr>';
            html += '<td>' + escapeHtml(dv.hostname || 'unknown') + '</td>';
            html += '<td>' + escapeHtml((dv.platform || '') + (dv.arch ? ' (' + dv.arch + ')' : '')) + '</td>';
            html += '<td class="text-sm">' + escapeHtml(dv.claude_version || '') + '</td>';
            html += '<td class="text-sm">' + timeAgo(dv.last_seen) + '</td>';
            html += '<td class="text-mono text-sm">' + escapeHtml(dv.last_ip || '') + '</td>';
            html += '</tr>';
          }
          html += '</tbody></table></div></div></div>';
        }

        // Top Projects for this user
        var userProjects = userAnalytics.project_usage || [];
        if (userProjects.length > 0) {
          html += '<div class="card mb-2"><div class="card-header"><h3>Proyectos Principales (30d)</h3></div>';
          html += '<div class="card-body-flush"><div class="table-wrap"><table>';
          html += '<thead><tr><th>Proyecto</th><th>Prompts</th></tr></thead><tbody>';
          for (var upi = 0; upi < userProjects.length; upi++) {
            html += '<tr>';
            html += '<td>' + escapeHtml(userProjects[upi].project) + '</td>';
            html += '<td class="text-mono">' + userProjects[upi].count + '</td>';
            html += '</tr>';
          }
          html += '</tbody></table></div></div></div>';
        }

        // Peak Hours for this user
        var userPeakHours = userAnalytics.peak_hours || [];
        if (userPeakHours.length > 0) {
          html += '<div class="card mb-2"><div class="card-header"><h3>Horas Pico de Uso (30d)</h3></div>';
          html += '<div class="card-body"><div class="chart-container chart-container-tall"><canvas id="user-peak-hours"></canvas></div></div>';
          html += '</div>';
        }

        html += '</div>'; // right column
        html += '</div>'; // detail-grid

        container.innerHTML = html;

        // Render charts after DOM is ready
        requestAnimationFrame(function () {
          // Credit gauge
          if (creditRule && user.credit_budget > 0) {
            var gaugeCanvas = document.getElementById('credit-gauge');
            if (gaugeCanvas) {
              var creditUsed = user.credit_budget - (user.credit_balance || 0);
              Charts.creditGauge(gaugeCanvas, creditUsed, user.credit_budget);
            }
          }

          // Horizontal bars
          var barsCanvas = document.getElementById('model-bars');
          if (barsCanvas) {
            var barData = [];
            var models = ['fable', 'opus', 'sonnet', 'haiku'];
            for (var b = 0; b < models.length; b++) {
              var mdl = models[b];
              var used = dailyUsage[mdl] || 0;
              var lim = getModelLimit(limits, mdl);
              barData.push({ label: mdl.charAt(0).toUpperCase() + mdl.slice(1), value: used, limit: lim > 0 ? lim : 0 });
            }
            Charts.horizontalBar(barsCanvas, barData);
          }

          // Trend line
          var trendCanvas = document.getElementById('trend-chart');
          if (trendCanvas && usageData.daily) {
            var dayMap = {};
            for (var di = 0; di < usageData.daily.length; di++) {
              var row = usageData.daily[di];
              dayMap[row.day] = (dayMap[row.day] || 0) + row.count;
            }
            var trendPts = [];
            var today = new Date();
            for (var td = 29; td >= 0; td--) {
              var d = new Date(today);
              d.setDate(d.getDate() - td);
              var key = d.toISOString().split('T')[0];
              trendPts.push({ day: key, value: dayMap[key] || 0 });
            }
            Charts.trendLine(trendCanvas, trendPts);
          }

          // User peak hours chart
          var userPeakCanvas = document.getElementById('user-peak-hours');
          if (userPeakCanvas && userAnalytics.peak_hours) {
            Charts.peakHoursBar(userPeakCanvas, userAnalytics.peak_hours);
          }
        });

        startAutoRefresh();
      })
      .catch(function (err) {
        container.innerHTML = '<div class="empty-state"><p>Error al cargar usuario: ' + escapeHtml(err.message) + '</p><a href="#overview">Volver al resumen</a></div>';
      });
  }

  function renderLimitItem(rule) {
    var desc = '';
    if (rule.type === 'credits') {
      desc = 'Credit Budget (' + (rule.window || 'daily') + ')';
    } else if (rule.type === 'per_model') {
      desc = (rule.model || 'all models') + ' (' + (rule.window || 'daily') + ')';
    } else if (rule.type === 'time_of_day') {
      desc = (rule.model || 'all') + ' time restriction';
    }

    var valStr = '';
    if (rule.type === 'time_of_day') {
      valStr = (rule.schedule_start || '?') + ' - ' + (rule.schedule_end || '?') + ' ' + (rule.schedule_tz || '');
    } else {
      valStr = rule.value === -1 ? 'unlimited' : (rule.value === 0 ? 'blocked' : String(rule.value));
    }

    return (
      '<li class="limit-item">' +
        '<div class="limit-type">' +
          '<span class="badge badge-model">' + escapeHtml(rule.type) + '</span>' +
          '<span>' + escapeHtml(desc) + '</span>' +
        '</div>' +
        '<span class="limit-value">' + escapeHtml(valStr) + '</span>' +
      '</li>'
    );
  }

  /* ================================================================
     PAGE: SETTINGS
     ================================================================ */
  function renderSettings(container) {
    // We need team info. Fetch users to get the team context, or read from state.
    // The login response stores team info in state.team.
    if (!state.team) {
      container.innerHTML = '<div class="spinner"></div>';
      // Try getting users to refresh state
      API.getUsers().then(function () {
        renderSettingsInner(container);
      }).catch(function (err) {
        container.innerHTML = '<div class="empty-state"><p>Error al cargar configuración: ' + escapeHtml(err.message) + '</p></div>';
      });
    } else {
      renderSettingsInner(container);
    }
  }

  function renderSettingsInner(container) {
    var team = state.team || { name: 'Team', credit_weights: { fable: 15, opus: 10, sonnet: 3, haiku: 1 } };
    var cw = team.credit_weights || { fable: 15, opus: 10, sonnet: 3, haiku: 1 };

    var html = '';
    html += '<div class="page-header"><h2>Configuración</h2></div>';

    // Team name
    html += '<div class="card mb-2"><div class="card-body">';
    html += '<div class="settings-section">';
    html += '<h3>Nombre del Equipo</h3>';
    html += '<div class="form-group">';
    html += '<input type="text" id="settings-team-name" value="' + escapeHtml(team.name) + '" placeholder="Nombre del equipo">';
    html += '</div>';
    html += '<button class="btn btn-primary btn-sm" data-action="save-team-name">Guardar Nombre</button>';
    html += '</div>';
    html += '</div></div>';

    // Credit Weights
    html += '<div class="card mb-2"><div class="card-body">';
    html += '<div class="settings-section">';
    html += '<h3>Pesos de Créditos</h3>';
    html += '<p class="text-muted text-sm mb-2">Define cuántos créditos cuesta cada modelo por turno. Mayor peso = más caro.</p>';
    html += '<div class="weight-grid">';
    var models = ['fable', 'opus', 'sonnet', 'haiku'];
    for (var i = 0; i < models.length; i++) {
      var m = models[i];
      html += '<div class="weight-card">';
      html += '<div class="weight-model">' + m + '</div>';
      html += '<input type="number" id="weight-' + m + '" min="0" value="' + (cw[m] || 0) + '">';
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="mt-2"><button class="btn btn-primary btn-sm" data-action="save-weights">Guardar Pesos</button></div>';
    html += '</div>';
    html += '</div></div>';

    // Effort Multipliers
    var em = team.effort_multipliers || { low: 0.5, medium: 1, high: 2, xhigh: 4, max: 6 };
    html += '<div class="card mb-2"><div class="card-body">';
    html += '<div class="settings-section">';
    html += '<h3>Multiplicadores de Effort</h3>';
    html += '<p class="text-muted text-sm mb-2">Multiplica el costo de créditos según el nivel de effort. Ej: Opus (10 cr) × Max (6x) = 60 créditos por turno.</p>';
    html += '<div class="weight-grid">';
    var effortLevels = ['low', 'medium', 'high', 'xhigh', 'max'];
    for (var ei = 0; ei < effortLevels.length; ei++) {
      var lvl = effortLevels[ei];
      html += '<div class="weight-card">';
      html += '<div class="weight-model">' + lvl + '</div>';
      html += '<input type="number" id="effort-' + lvl + '" min="0" step="0.5" value="' + (em[lvl] || 1) + '">';
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="mt-2"><button class="btn btn-primary btn-sm" data-action="save-effort">Guardar Multiplicadores</button></div>';
    html += '</div>';
    html += '</div></div>';

    // Change Password
    html += '<div class="card mb-2"><div class="card-body">';
    html += '<div class="settings-section">';
    html += '<h3>Cambiar Contraseña de Admin</h3>';
    html += '<div class="form-row">';
    html += '<div class="form-group"><label for="settings-new-pw">Nueva Contraseña</label>';
    html += '<input type="password" id="settings-new-pw" placeholder="Nueva contraseña"></div>';
    html += '<div class="form-group"><label for="settings-confirm-pw">Confirmar Contraseña</label>';
    html += '<input type="password" id="settings-confirm-pw" placeholder="Confirmar contraseña"></div>';
    html += '</div>';
    html += '<button class="btn btn-danger btn-sm" data-action="change-password">Cambiar Contraseña</button>';
    html += '</div>';
    html += '</div></div>';

    container.innerHTML = html;
  }

  /* ================================================================
     PAGE: ANALYTICS
     ================================================================ */
  var _analyticsDays = 30;

  function renderAnalytics(container) {
    container.innerHTML = '<div class="spinner"></div>';

    API.getAnalytics({ days: _analyticsDays }).then(function (data) {
      var html = '';
      html += '<div class="page-header">';
      html += '  <h2>Analytics</h2>';
      html += '  <div class="page-header-actions">';
      html += '    <select id="analytics-days" class="select-sm">';
      html += '      <option value="7"' + (_analyticsDays === 7 ? ' selected' : '') + '>Últimos 7 días</option>';
      html += '      <option value="14"' + (_analyticsDays === 14 ? ' selected' : '') + '>Últimos 14 días</option>';
      html += '      <option value="30"' + (_analyticsDays === 30 ? ' selected' : '') + '>Últimos 30 días</option>';
      html += '      <option value="90"' + (_analyticsDays === 90 ? ' selected' : '') + '>Últimos 90 días</option>';
      html += '    </select>';
      html += '  </div>';
      html += '</div>';

      // Stats row
      html += '<div class="stats-row">';
      html += statCard('Prom. Long. Prompt', data.avg_prompt_length || 0, 'chars');
      html += statCard('Prom. Long. Respuesta', data.avg_response_length || 0, 'chars');
      html += statCard('Prom. Prompts/Sesión', data.avg_prompts_per_session || 0, '');
      html += statCard('Tasa de Bloqueo', data.block_rate ? (data.block_rate.rate * 100).toFixed(1) + '%' : '0%', data.block_rate ? data.block_rate.blocked + '/' + data.block_rate.total + ' bloqueados' : '');
      html += '</div>';

      // Two column layout: charts
      html += '<div class="two-col">';

      // Left column
      html += '<div>';

      // Model Distribution
      html += '<div class="card mb-2"><div class="card-header"><h3>Distribución por Modelo</h3></div>';
      html += '<div class="card-body" style="display:flex;justify-content:center"><canvas id="model-donut"></canvas></div>';
      html += '</div>';

      // Block Rate Gauge
      html += '<div class="card mb-2"><div class="card-header"><h3>Tasa de Bloqueo</h3></div>';
      html += '<div class="card-body" style="display:flex;justify-content:center"><canvas id="block-gauge"></canvas></div>';
      html += '</div>';

      // Top Projects
      html += '<div class="card mb-2"><div class="card-header"><h3>Proyectos Principales</h3></div>';
      html += '<div class="card-body-flush"><div class="table-wrap"><table>';
      html += '<thead><tr><th>Proyecto</th><th>Prompts</th></tr></thead><tbody>';
      var projects = data.project_usage || [];
      if (projects.length === 0) {
        html += '<tr><td colspan="2" class="text-center text-muted">Sin datos de proyectos aún</td></tr>';
      } else {
        for (var pi = 0; pi < projects.length; pi++) {
          html += '<tr>';
          html += '<td>' + escapeHtml(projects[pi].project) + '</td>';
          html += '<td class="text-mono">' + projects[pi].count + '</td>';
          html += '</tr>';
        }
      }
      html += '</tbody></table></div></div></div>';

      html += '</div>'; // left column

      // Right column
      html += '<div>';

      // Daily Active Users
      html += '<div class="card mb-2"><div class="card-header"><h3>Usuarios Activos por Día</h3></div>';
      html += '<div class="card-body"><div class="chart-container"><canvas id="dau-chart"></canvas></div></div>';
      html += '</div>';

      // Peak Hours
      html += '<div class="card mb-2"><div class="card-header"><h3>Horas Pico de Uso</h3></div>';
      html += '<div class="card-body"><div class="chart-container chart-container-tall"><canvas id="peak-hours-chart"></canvas></div></div>';
      html += '</div>';

      html += '</div>'; // right column
      html += '</div>'; // two-col

      // Devices table
      html += '<div class="card mb-2"><div class="card-header"><h3>Dispositivos</h3></div>';
      html += '<div class="card-body-flush"><div class="table-wrap"><table>';
      html += '<thead><tr><th>Hostname</th><th>Usuario</th><th>Plataforma</th><th>Versión SO</th><th>Versión Claude</th><th>Última Vez</th><th>IP</th></tr></thead><tbody>';
      var devices = data.devices || [];
      if (devices.length === 0) {
        html += '<tr><td colspan="7" class="text-center text-muted">Sin dispositivos registrados aún</td></tr>';
      } else {
        for (var di = 0; di < devices.length; di++) {
          var dev = devices[di];
          html += '<tr>';
          html += '<td>' + escapeHtml(dev.hostname || 'unknown') + '</td>';
          html += '<td>' + escapeHtml(dev.user_name || dev.user_slug || '') + '</td>';
          html += '<td>' + escapeHtml((dev.platform || '') + (dev.arch ? ' (' + dev.arch + ')' : '')) + '</td>';
          html += '<td class="text-sm">' + escapeHtml(dev.os_version || '') + '</td>';
          html += '<td class="text-sm">' + escapeHtml(dev.claude_version || '') + '</td>';
          html += '<td class="text-sm">' + timeAgo(dev.last_seen) + '</td>';
          html += '<td class="text-mono text-sm">' + escapeHtml(dev.last_ip || '') + '</td>';
          html += '</tr>';
        }
      }
      html += '</tbody></table></div></div></div>';

      container.innerHTML = html;

      // Render charts after DOM is ready
      requestAnimationFrame(function () {
        // Model distribution donut
        var donutCanvas = document.getElementById('model-donut');
        if (donutCanvas && data.model_distribution) {
          Charts.donutChart(donutCanvas, data.model_distribution);
        }

        // Block rate gauge
        var gaugeCanvas = document.getElementById('block-gauge');
        if (gaugeCanvas && data.block_rate) {
          Charts.blockRateGauge(gaugeCanvas, data.block_rate.total, data.block_rate.blocked);
        }

        // Daily active users trend
        var dauCanvas = document.getElementById('dau-chart');
        if (dauCanvas && data.daily_active) {
          var dauPts = [];
          // Fill in missing days
          var dayMap = {};
          for (var di2 = 0; di2 < data.daily_active.length; di2++) {
            dayMap[data.daily_active[di2].date] = data.daily_active[di2].users;
          }
          var today = new Date();
          for (var td = 29; td >= 0; td--) {
            var d = new Date(today);
            d.setDate(d.getDate() - td);
            var key = d.toISOString().split('T')[0];
            dauPts.push({ day: key, value: dayMap[key] || 0 });
          }
          Charts.trendLine(dauCanvas, dauPts);
        }

        // Peak hours
        var peakCanvas = document.getElementById('peak-hours-chart');
        if (peakCanvas && data.peak_hours) {
          Charts.peakHoursBar(peakCanvas, data.peak_hours);
        }
      });

      // Handle days selector change
      var daysSelect = document.getElementById('analytics-days');
      if (daysSelect) {
        daysSelect.addEventListener('change', function () {
          _analyticsDays = parseInt(daysSelect.value, 10) || 30;
          renderAnalytics(container);
        });
      }

    }).catch(function (err) {
      container.innerHTML = '<div class="empty-state"><p>Error al cargar analíticas: ' + escapeHtml(err.message) + '</p></div>';
    });
  }

  /* ================================================================
     MODAL: ADD USER
     ================================================================ */
  function openAddUserModal() {
    var html = '';
    html += '<div class="modal-header"><h3>Agregar Usuario</h3><button class="modal-close" data-action="close-modal">&times;</button></div>';
    html += '<div class="modal-body">';

    html += '<div class="form-group"><label for="new-user-name">Nombre</label>';
    html += '<input type="text" id="new-user-name" placeholder="Ej: Alice, Equipo Dev, Practicante"></div>';

    html += '<div class="form-group"><label for="new-user-slug">Slug (usuario)</label>';
    html += '<input type="text" id="new-user-slug" placeholder="Ej: alice, equipo-dev, practicante">';
    html += '<p class="form-hint">Minúsculas, sin espacios. Usado en comandos de instalación y logs.</p></div>';

    html += '<hr class="section-divider">';
    html += '<h4 class="mb-1">Preset de Límites</h4>';
    html += '<div class="presets-row">';
    html += '<button class="preset-btn selected" data-preset="light">Ligero</button>';
    html += '<button class="preset-btn" data-preset="medium">Medio</button>';
    html += '<button class="preset-btn" data-preset="heavy">Intensivo</button>';
    html += '<button class="preset-btn" data-preset="unlimited">Ilimitado</button>';
    html += '<button class="preset-btn" data-preset="custom">Personalizado</button>';
    html += '</div>';

    html += '<div id="preset-description" class="text-muted text-sm mb-2">50 créditos/día. Fable: 2, Opus: 3, Sonnet: 10, Haiku: 30.</div>';

    // Custom limits form (hidden by default)
    html += '<div id="custom-limits-form" class="hidden">';
    html += '<div class="form-group"><label>Presupuesto de Créditos (diario)</label>';
    html += '<input type="number" id="custom-credits" min="-1" value="100" placeholder="-1 para ilimitado"></div>';
    html += '<div class="form-row-4">';
    html += '<div class="form-group"><label>Fable (diario)</label>';
    html += '<input type="number" id="custom-fable" min="-1" value="3"></div>';
    html += '<div class="form-group"><label>Opus (diario)</label>';
    html += '<input type="number" id="custom-opus" min="-1" value="5"></div>';
    html += '<div class="form-group"><label>Sonnet (diario)</label>';
    html += '<input type="number" id="custom-sonnet" min="-1" value="20"></div>';
    html += '<div class="form-group"><label>Haiku (diario)</label>';
    html += '<input type="number" id="custom-haiku" min="-1" value="50"></div>';
    html += '</div>';
    html += '</div>';

    html += '</div>'; // modal-body
    html += '<div class="modal-footer">';
    html += '<button class="btn btn-ghost" data-action="close-modal">Cancelar</button>';
    html += '<button class="btn btn-primary" data-action="submit-add-user">Crear Usuario</button>';
    html += '</div>';

    openModal(html);

    // Auto-generate slug from name
    var nameInput = document.getElementById('new-user-name');
    var slugInput = document.getElementById('new-user-slug');
    if (nameInput && slugInput) {
      nameInput.addEventListener('input', function () {
        slugInput.value = nameInput.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      });
    }
  }

  var PRESETS = {
    light:     { credits: 50,  fable: 2, opus: 3,  sonnet: 10, haiku: 30, desc: '50 créditos/día. Fable: 2, Opus: 3, Sonnet: 10, Haiku: 30.' },
    medium:    { credits: 100, fable: 4, opus: 5,  sonnet: 20, haiku: 50, desc: '100 créditos/día. Fable: 4, Opus: 5, Sonnet: 20, Haiku: 50.' },
    heavy:     { credits: 200, fable: 8, opus: 10, sonnet: 40, haiku: 100, desc: '200 créditos/día. Fable: 8, Opus: 10, Sonnet: 40, Haiku: 100.' },
    unlimited: { credits: -1,  fable: -1, opus: -1, sonnet: -1, haiku: -1, desc: 'Sin límites. El usuario tiene acceso completo sin restricciones.' },
  };

  var selectedPreset = 'light';

  function selectPreset(preset) {
    selectedPreset = preset;

    // Update button states
    var btns = document.querySelectorAll('.preset-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('selected', btns[i].getAttribute('data-preset') === preset);
    }

    var descEl = document.getElementById('preset-description');
    var customForm = document.getElementById('custom-limits-form');

    if (preset === 'custom') {
      if (descEl) descEl.textContent = 'Configura tus propios límites abajo.';
      if (customForm) customForm.classList.remove('hidden');
    } else {
      var p = PRESETS[preset];
      if (descEl) descEl.textContent = p.desc;
      if (customForm) customForm.classList.add('hidden');
    }
  }

  function buildLimitsFromPreset() {
    var p;
    if (selectedPreset === 'custom') {
      p = {
        credits: parseInt(document.getElementById('custom-credits').value, 10),
        fable: parseInt(document.getElementById('custom-fable').value, 10),
        opus: parseInt(document.getElementById('custom-opus').value, 10),
        sonnet: parseInt(document.getElementById('custom-sonnet').value, 10),
        haiku: parseInt(document.getElementById('custom-haiku').value, 10),
      };
    } else {
      p = PRESETS[selectedPreset];
    }

    var limits = [];
    if (p.credits !== -1) {
      limits.push({ type: 'credits', window: 'daily', value: p.credits });
    }
    if (p.fable !== -1) {
      limits.push({ type: 'per_model', model: 'fable', window: 'daily', value: p.fable });
    }
    if (p.opus !== -1) {
      limits.push({ type: 'per_model', model: 'opus', window: 'daily', value: p.opus });
    }
    if (p.sonnet !== -1) {
      limits.push({ type: 'per_model', model: 'sonnet', window: 'daily', value: p.sonnet });
    }
    if (p.haiku !== -1) {
      limits.push({ type: 'per_model', model: 'haiku', window: 'daily', value: p.haiku });
    }
    return limits;
  }

  function openCreditsExplainerModal() {
    var team = state.team || {};
    var cw = team.credit_weights || { fable: 15, opus: 10, sonnet: 3, haiku: 1 };
    var fableCost = cw.fable || 15;
    var opusCost = cw.opus || 10;
    var sonnetCost = cw.sonnet || 3;
    var haikuCost = cw.haiku || 1;

    // Example budget for the math walkthrough
    var exampleBudget = 100;
    var fableOnly = Math.floor(exampleBudget / fableCost);
    var opusOnly = Math.floor(exampleBudget / opusCost);
    var sonnetOnly = Math.floor(exampleBudget / sonnetCost);
    var haikuOnly = Math.floor(exampleBudget / haikuCost);

    var html = '';
    html += '<div class="modal-header"><h3>¿Cómo funcionan los créditos?</h3><button class="modal-close" data-action="close-modal">&times;</button></div>';
    html += '<div class="modal-body credits-explainer">';

    // Section 1 — Why credits
    html += '<section class="explainer-section">';
    html += '<h4>1. ¿Por qué un presupuesto de créditos?</h4>';
    html += '<p>Los modelos de Claude no cuestan lo mismo. Opus consume mucha más capacidad de la suscripción que Haiku. ';
    html += 'Si cada usuario solo tuviera un cap de "X prompts al día", uno podría tirar 50 prompts de Opus y consumir lo equivalente a 500 de Haiku.</p>';
    html += '<p>El sistema de créditos resuelve eso: <strong>un único presupuesto que el usuario gasta como quiera</strong>, ';
    html += 'pero cada modelo cuesta distinta cantidad de créditos por prompt.</p>';
    html += '</section>';

    // Section 2 — Cost table
    html += '<section class="explainer-section">';
    html += '<h4>2. Costo por modelo (configuración actual)</h4>';
    html += '<table class="explainer-table">';
    html += '<thead><tr><th>Modelo</th><th>Créditos por prompt</th><th>Por qué</th></tr></thead>';
    html += '<tbody>';
    html += '<tr><td><strong>Fable</strong></td><td>' + fableCost + '</td><td>Modelo creativo, el más costoso en tokens</td></tr>';
    html += '<tr><td><strong>Opus</strong></td><td>' + opusCost + '</td><td>Modelo potente y caro</td></tr>';
    html += '<tr><td><strong>Sonnet</strong></td><td>' + sonnetCost + '</td><td>Balance costo / capacidad</td></tr>';
    html += '<tr><td><strong>Haiku</strong></td><td>' + haikuCost + '</td><td>Modelo más liviano y económico</td></tr>';
    html += '</tbody></table>';
    html += '<p class="form-hint">Los pesos son configurables. Cambialos en <strong>Configuración → Pesos de Créditos</strong> si tu suscripción tiene proporciones distintas.</p>';
    html += '</section>';

    // Section 3 — Math example
    html += '<section class="explainer-section">';
    html += '<h4>3. Ejemplo con presupuesto de ' + exampleBudget + ' créditos diarios</h4>';
    html += '<p>Con un usuario que tenga <strong>' + exampleBudget + ' créditos/día</strong>, puede elegir cómo gastarlos:</p>';
    html += '<div class="explainer-examples">';
    html += '<div class="explainer-example"><div class="explainer-example-num">' + fableOnly + '</div><div class="explainer-example-label">prompts solo Fable</div><div class="explainer-example-calc">' + fableOnly + ' × ' + fableCost + ' = ' + (fableOnly * fableCost) + ' créditos</div></div>';
    html += '<div class="explainer-example"><div class="explainer-example-num">' + opusOnly + '</div><div class="explainer-example-label">prompts solo Opus</div><div class="explainer-example-calc">' + opusOnly + ' × ' + opusCost + ' = ' + (opusOnly * opusCost) + ' créditos</div></div>';
    html += '<div class="explainer-example"><div class="explainer-example-num">' + sonnetOnly + '</div><div class="explainer-example-label">prompts solo Sonnet</div><div class="explainer-example-calc">' + sonnetOnly + ' × ' + sonnetCost + ' = ' + (sonnetOnly * sonnetCost) + ' créditos</div></div>';
    html += '<div class="explainer-example"><div class="explainer-example-num">' + haikuOnly + '</div><div class="explainer-example-label">prompts solo Haiku</div><div class="explainer-example-calc">' + haikuOnly + ' × ' + haikuCost + ' = ' + (haikuOnly * haikuCost) + ' créditos</div></div>';
    html += '</div>';
    html += '<p>O cualquier combinación. Por ejemplo: <code>2 Fable + 3 Opus + 5 Sonnet + 10 Haiku = ' + (2*fableCost + 3*opusCost + 5*sonnetCost + 10*haikuCost) + ' créditos</code>.</p>';
    html += '</section>';

    // Section 4 — When does it reset
    html += '<section class="explainer-section">';
    html += '<h4>4. ¿Cuándo se resetea el presupuesto?</h4>';
    html += '<p>Depende de la ventana configurada para cada usuario:</p>';
    html += '<ul class="explainer-list">';
    html += '<li><strong>Diaria (<code>daily</code>):</strong> a medianoche local del usuario.</li>';
    html += '<li><strong>Semanal (<code>weekly</code>):</strong> cuando reinicia la semana de Claude (Configuración → Reinicio Semanal).</li>';
    html += '<li><strong>Mensual (<code>monthly</code>):</strong> el 1 del mes.</li>';
    html += '<li><strong>Rodante (<code>sliding_24h</code>):</strong> ventana móvil de 24 horas — no hay "truco de medianoche".</li>';
    html += '</ul>';
    html += '</section>';

    // Section 5 — Interaction with per-model caps
    html += '<section class="explainer-section">';
    html += '<h4>5. ¿Y los límites por modelo?</h4>';
    html += '<p>Los créditos no reemplazan los caps por modelo — los <strong>complementan</strong>. ';
    html += 'Un usuario puede tener:</p>';
    html += '<ul class="explainer-list">';
    html += '<li>Cap duro: <code>Opus: 3/día</code> (no más que esto pase lo que pase)</li>';
    html += '<li>Y además: <code>100 créditos/día</code> compartidos entre los 3 modelos</li>';
    html += '</ul>';
    html += '<p>El primer límite que se viole, gana. Si quedan créditos pero ya usó 3 Opus → no puede tirar más Opus, pero sí Sonnet o Haiku.</p>';
    html += '</section>';

    // Section 6 — How it's enforced
    html += '<section class="explainer-section">';
    html += '<h4>6. ¿Cómo se cobra cada prompt?</h4>';
    html += '<p>Cada vez que un usuario manda un prompt en Claude Code:</p>';
    html += '<ol class="explainer-list">';
    html += '<li>El hook detecta qué modelo está activo (Fable, Opus, Sonnet o Haiku).</li>';
    html += '<li>Le pregunta al servidor: <em>¿queda presupuesto y cap suficiente?</em></li>';
    html += '<li>Si sí, Claude responde normal. Al terminar el turno, se descuenta el costo del modelo.</li>';
    html += '<li>Si no, el prompt se bloquea con un mensaje explicando qué límite se alcanzó.</li>';
    html += '</ol>';
    html += '<p class="form-hint">Se cuenta por <strong>turno</strong> (prompt del usuario), no por cada tool call interna. Un prompt que dispare 20 lecturas de archivo sigue costando lo del modelo, una sola vez.</p>';
    html += '</section>';

    html += '</div>';
    html += '<div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Entendido</button></div>';

    openModal(html);
  }

  function buildUnixInstallCmd(code, serverUrl) {
    return 'sudo node packages/cli/src/installer.js setup \\\n  --code ' + code + ' \\\n  --server ' + serverUrl;
  }

  function buildWindowsInstallCmd(code, serverUrl) {
    return 'node packages\\cli\\src\\installer.js setup `\n  --code ' + code + ' `\n  --server ' + serverUrl;
  }

  function openInstallCommandModal(userName, installCode, dashboardUrl, savedServerUrl) {
    var placeholder = 'TU-SERVIDOR-AQUI';
    var initialUrl = savedServerUrl || '';
    var effectiveUrl = initialUrl || placeholder;

    var unixCmd = buildUnixInstallCmd(installCode, effectiveUrl);
    var winCmd = buildWindowsInstallCmd(installCode, effectiveUrl);

    var html = '';
    html += '<div class="modal-header"><h3>Comando de Instalación — ' + escapeHtml(userName) + '</h3><button class="modal-close" data-action="close-modal">&times;</button></div>';
    html += '<div class="modal-body">';

    // Info panel
    html += '<div class="install-info-panel">';
    html += '<div class="install-info-title">¿Qué pongo en <code>TU-SERVIDOR-AQUI</code>?</div>';
    html += '<div class="install-info-body">';
    html += 'Reemplazá <code>TU-SERVIDOR-AQUI</code> por la URL que la máquina del usuario use para llegar a este servidor:';
    html += '<ul class="install-info-list">';
    html += '<li><strong>LAN local:</strong> <code>http://192.168.1.210:3000</code></li>';
    html += '<li><strong>VPS público:</strong> <code>https://limiter.tudominio.com</code></li>';
    html += '<li><strong>VirtualBox host-only:</strong> <code>http://192.168.56.1:3000</code></li>';
    html += '</ul>';
    html += '<div class="install-info-current">Dashboard actual: <code>' + escapeHtml(dashboardUrl) + '</code></div>';
    html += '</div></div>';

    // URL input
    html += '<div class="form-group install-url-group">';
    html += '<label for="invite-server-url">URL del servidor para esta invitación (opcional)</label>';
    html += '<input type="text" id="invite-server-url" placeholder="http://192.168.1.210:3000" value="' + escapeHtml(initialUrl) + '">';
    html += '<p class="form-hint">Si la dejás vacía, los comandos mostrarán <code>TU-SERVIDOR-AQUI</code>. Se recuerda para próximas invitaciones.</p>';
    html += '</div>';

    // Linux / macOS command
    html += '<div class="install-os-block">';
    html += '<div class="install-os-header"><span class="install-os-label">Linux / macOS</span>';
    html += '<button class="btn btn-sm btn-primary" data-action="copy-install" data-target="cmd-unix">Copiar</button>';
    html += '</div>';
    html += '<pre class="install-cmd" id="cmd-unix">' + escapeHtml(unixCmd) + '</pre>';
    html += '</div>';

    // Windows command
    html += '<div class="install-os-block">';
    html += '<div class="install-os-header"><span class="install-os-label">Windows (PowerShell como Administrador)</span>';
    html += '<button class="btn btn-sm btn-primary" data-action="copy-install" data-target="cmd-win">Copiar</button>';
    html += '</div>';
    html += '<pre class="install-cmd" id="cmd-win">' + escapeHtml(winCmd) + '</pre>';
    html += '</div>';

    // Code-only field
    html += '<div class="install-os-block">';
    html += '<div class="install-os-header"><span class="install-os-label">Código de instalación (por si falla copiar)</span>';
    html += '<button class="btn btn-sm btn-secondary" data-action="copy-install" data-target="cmd-code">Copiar</button>';
    html += '</div>';
    html += '<pre class="install-cmd install-cmd-code" id="cmd-code">' + escapeHtml(installCode) + '</pre>';
    html += '</div>';

    html += '<p class="form-hint mt-2">⚠️ Este código solo puede usarse una vez. Generá uno nuevo desde el detalle del usuario si es necesario.</p>';
    html += '</div>';
    html += '<div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Listo</button></div>';

    openModal(html);

    // Wire up live command rebuild + localStorage persistence
    var urlInput = document.getElementById('invite-server-url');
    if (urlInput) {
      urlInput.addEventListener('input', function () {
        var val = urlInput.value.trim();
        var url = val || placeholder;
        var unix = buildUnixInstallCmd(installCode, url);
        var win = buildWindowsInstallCmd(installCode, url);
        var unixEl = document.getElementById('cmd-unix');
        var winEl = document.getElementById('cmd-win');
        if (unixEl) unixEl.textContent = unix;
        if (winEl) winEl.textContent = win;
        try { localStorage.setItem('limiter_invite_server_url', val); } catch (e) {}
      });
    }
  }

  function submitAddUser() {
    var name = (document.getElementById('new-user-name').value || '').trim();
    var slug = (document.getElementById('new-user-slug').value || '').trim();

    if (!name) { showToast('Error', 'El nombre es requerido', 'error'); return; }
    if (!slug) { showToast('Error', 'El slug es requerido', 'error'); return; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) { showToast('Error', 'El slug debe ser minúsculas, números y guiones', 'error'); return; }

    var limits = buildLimitsFromPreset();

    API.createUser({ name: name, slug: slug, limits: limits })
      .then(function (result) {
        closeModal();
        showToast('Usuario Creado', name + ' ha sido agregado', 'success');

        // Show install command modal
        var installCode = result.install_code;
        var dashboardUrl = location.protocol + '//' + location.host;
        var savedServerUrl = '';
        try { savedServerUrl = localStorage.getItem('limiter_invite_server_url') || ''; } catch (e) {}

        openInstallCommandModal(name, installCode, dashboardUrl, savedServerUrl);

        // Refresh overview
        var route = getRoute();
        if (route.page === 'overview' || route.page === 'users') {
          renderPage(route);
        }
      })
      .catch(function (err) {
        showToast('Error', err.message, 'error');
      });
  }

  /* ================================================================
     MODAL: EDIT LIMITS
     ================================================================ */
  function openEditLimitsModal(userId) {
    API.getUser(userId).then(function (user) {
      var limits = user.limits || [];
      var creditRule = getCreditRule(limits);
      var creditVal = creditRule ? creditRule.value : '';
      var creditWindow = creditRule ? creditRule.window : 'daily';

      var html = '';
      html += '<div class="modal-header"><h3>Editar Límites: ' + escapeHtml(user.name) + '</h3><button class="modal-close" data-action="close-modal">&times;</button></div>';
      html += '<div class="modal-body">';

      // Credit budget
      html += '<div class="form-group"><label>Presupuesto de Créditos</label>';
      html += '<div class="form-row">';
      html += '<div class="form-group"><label class="text-sm">Valor (-1 = ilimitado, 0 = bloqueado)</label>';
      html += '<input type="number" id="edit-credits" min="-1" value="' + (creditVal !== '' ? creditVal : '-1') + '"></div>';
      html += '<div class="form-group"><label class="text-sm">Ventana</label>';
      html += '<select id="edit-credits-window">';
      var windows = ['daily', 'weekly', 'monthly', 'sliding_24h'];
      for (var wi = 0; wi < windows.length; wi++) {
        html += '<option value="' + windows[wi] + '"' + (creditWindow === windows[wi] ? ' selected' : '') + '>' + windows[wi] + '</option>';
      }
      html += '</select></div>';
      html += '</div></div>';

      html += '<hr class="section-divider">';

      // Per-model limits
      html += '<h4 class="mb-1">Límites por Modelo (Diario)</h4>';
      html += '<p class="form-hint mb-2">-1 = ilimitado, 0 = bloqueado</p>';
      var models = ['fable', 'opus', 'sonnet', 'haiku'];
      html += '<div class="form-row-3">';
      for (var mi = 0; mi < models.length; mi++) {
        var m = models[mi];
        var mVal = getModelLimit(limits, m, 'daily');
        html += '<div class="form-group"><label>' + m.charAt(0).toUpperCase() + m.slice(1) + '</label>';
        html += '<input type="number" id="edit-' + m + '" min="-1" value="' + mVal + '"></div>';
      }
      html += '</div>';

      // Time-of-day rules
      html += '<hr class="section-divider">';
      html += '<h4 class="mb-1">Restricciones Horarias</h4>';
      var timeRules = limits.filter(function (r) { return r.type === 'time_of_day'; });
      html += '<div id="time-rules-list">';
      if (timeRules.length > 0) {
        for (var ti = 0; ti < timeRules.length; ti++) {
          html += renderTimeRuleRow(ti, timeRules[ti]);
        }
      }
      html += '</div>';
      html += '<button class="btn btn-sm mt-1" data-action="add-time-rule">+ Agregar Restricción Horaria</button>';

      html += '</div>'; // modal-body
      html += '<div class="modal-footer">';
      html += '<button class="btn btn-ghost" data-action="close-modal">Cancelar</button>';
      html += '<button class="btn btn-primary" data-action="submit-edit-limits" data-user-id="' + userId + '">Guardar Límites</button>';
      html += '</div>';

      openModal(html);
    }).catch(function (err) {
      showToast('Error', err.message, 'error');
    });
  }

  var timeRuleIndex = 0;

  function renderTimeRuleRow(idx, rule) {
    rule = rule || {};
    return (
      '<div class="form-row-3 mb-1" id="time-rule-' + idx + '">' +
        '<div class="form-group"><label class="text-sm">Modelo</label>' +
        '<select class="time-rule-model">' +
          '<option value="fable"' + (rule.model === 'fable' ? ' selected' : '') + '>Fable</option>' +
          '<option value="opus"' + (rule.model === 'opus' ? ' selected' : '') + '>Opus</option>' +
          '<option value="sonnet"' + (rule.model === 'sonnet' ? ' selected' : '') + '>Sonnet</option>' +
          '<option value="haiku"' + (rule.model === 'haiku' ? ' selected' : '') + '>Haiku</option>' +
        '</select></div>' +
        '<div class="form-group"><label class="text-sm">Inicio - Fin</label>' +
        '<div style="display:flex;gap:0.3rem;align-items:center">' +
          '<input type="time" class="time-rule-start" value="' + (rule.schedule_start || '09:00') + '" style="flex:1">' +
          '<span class="text-muted">-</span>' +
          '<input type="time" class="time-rule-end" value="' + (rule.schedule_end || '18:00') + '" style="flex:1">' +
        '</div></div>' +
        '<div class="form-group"><label class="text-sm">Zona Horaria</label>' +
        '<input type="text" class="time-rule-tz" value="' + escapeHtml(rule.schedule_tz || Intl.DateTimeFormat().resolvedOptions().timeZone) + '" placeholder="America/New_York"></div>' +
      '</div>'
    );
  }

  function addTimeRuleRow() {
    var list = document.getElementById('time-rules-list');
    if (!list) return;
    timeRuleIndex++;
    var div = document.createElement('div');
    div.innerHTML = renderTimeRuleRow(timeRuleIndex, {});
    list.appendChild(div.firstElementChild);
  }

  function submitEditLimits(userId) {
    var limits = [];

    // Credits
    var creditsVal = parseInt(document.getElementById('edit-credits').value, 10);
    var creditsWindow = document.getElementById('edit-credits-window').value;
    if (!isNaN(creditsVal) && creditsVal !== -1) {
      limits.push({ type: 'credits', window: creditsWindow, value: creditsVal });
    }

    // Per-model
    var models = ['fable', 'opus', 'sonnet', 'haiku'];
    for (var i = 0; i < models.length; i++) {
      var val = parseInt(document.getElementById('edit-' + models[i]).value, 10);
      if (!isNaN(val) && val !== -1) {
        limits.push({ type: 'per_model', model: models[i], window: 'daily', value: val });
      }
    }

    // Time-of-day rules
    var modelEls = document.querySelectorAll('.time-rule-model');
    var startEls = document.querySelectorAll('.time-rule-start');
    var endEls = document.querySelectorAll('.time-rule-end');
    var tzEls = document.querySelectorAll('.time-rule-tz');
    for (var t = 0; t < modelEls.length; t++) {
      limits.push({
        type: 'time_of_day',
        model: modelEls[t].value,
        schedule_start: startEls[t].value,
        schedule_end: endEls[t].value,
        schedule_tz: tzEls[t].value,
      });
    }

    API.updateUser(userId, { limits: limits })
      .then(function () {
        closeModal();
        showToast('Límites Actualizados', 'Los límites han sido guardados', 'success');
        renderPage(getRoute());
      })
      .catch(function (err) {
        showToast('Error', err.message, 'error');
      });
  }

  /* ================================================================
     USER ACTIONS
     ================================================================ */
  function pauseUser(userId, userName) {
    confirmDialog('Pausar Usuario', 'Pausar a ' + userName + '? No podrá usar Claude Code hasta que sea reactivado.', 'Pausar')
      .then(function (ok) {
        if (!ok) return;
        return API.updateUser(userId, { status: 'paused' }).then(function () {
          showToast('Usuario Pausado', userName + ' ha sido pausado', 'warning');
          renderPage(getRoute());
        });
      })
      .catch(function (err) { if (err) showToast('Error', err.message, 'error'); });
  }

  function killUser(userId, userName) {
    confirmDialog('Revocar Acceso', '¿Revocar acceso a ' + userName + '? Se cerrará su sesión y necesitará reinstalación manual para recuperar el acceso.', 'Revocar')
      .then(function (ok) {
        if (!ok) return;
        return API.updateUser(userId, { status: 'killed' }).then(function () {
          showToast('Acceso Revocado', 'El acceso de ' + userName + ' ha sido revocado.', 'error');
          renderPage(getRoute());
        });
      })
      .catch(function (err) { if (err) showToast('Error', err.message, 'error'); });
  }

  function reinstateUser(userId, userName) {
    API.updateUser(userId, { status: 'active' })
      .then(function () {
        showToast('Usuario Reactivado', userName + ' ahora está activo', 'success');
        renderPage(getRoute());
      })
      .catch(function (err) { showToast('Error', err.message, 'error'); });
  }

  function deleteUser(userId, userName) {
    confirmDialog('Eliminar Usuario', '¿Eliminar permanentemente a ' + userName + '? Esto borrará todos sus datos de uso y no puede deshacerse.', 'Eliminar')
      .then(function (ok) {
        if (!ok) return;
        return API.deleteUser(userId).then(function () {
          showToast('Usuario Eliminado', userName + ' ha sido eliminado', 'success');
          navigate('overview');
        });
      })
      .catch(function (err) { if (err) showToast('Error', err.message, 'error'); });
  }

  /* ================================================================
     SETTINGS ACTIONS
     ================================================================ */
  function saveTeamName() {
    var name = (document.getElementById('settings-team-name').value || '').trim();
    if (!name) { showToast('Error', 'El nombre del equipo no puede estar vacío', 'error'); return; }
    API.updateSettings({ name: name })
      .then(function (data) {
        state.team = data.team;
        updateTeamNameDisplay();
        showToast('Guardado', 'Nombre del equipo actualizado', 'success');
      })
      .catch(function (err) { showToast('Error', err.message, 'error'); });
  }

  function saveWeights() {
    var cw = {};
    var models = ['fable', 'opus', 'sonnet', 'haiku'];
    for (var i = 0; i < models.length; i++) {
      var el = document.getElementById('weight-' + models[i]);
      cw[models[i]] = parseInt(el.value, 10) || 0;
    }
    API.updateSettings({ credit_weights: cw })
      .then(function (data) {
        state.team = data.team;
        showToast('Guardado', 'Pesos de créditos actualizados', 'success');
      })
      .catch(function (err) { showToast('Error', err.message, 'error'); });
  }

  function saveEffortMultipliers() {
    var em = {};
    var levels = ['low', 'medium', 'high', 'xhigh', 'max'];
    for (var i = 0; i < levels.length; i++) {
      var el = document.getElementById('effort-' + levels[i]);
      em[levels[i]] = parseFloat(el.value) || 1;
    }
    API.updateSettings({ effort_multipliers: em })
      .then(function (data) {
        state.team = data.team;
        showToast('Guardado', 'Multiplicadores de effort actualizados', 'success');
      })
      .catch(function (err) { showToast('Error', err.message, 'error'); });
  }

  function changePassword() {
    var newPw = (document.getElementById('settings-new-pw').value || '');
    var confirmPw = (document.getElementById('settings-confirm-pw').value || '');
    if (!newPw) { showToast('Error', 'La contraseña no puede estar vacía', 'error'); return; }
    if (newPw !== confirmPw) { showToast('Error', 'Las contraseñas no coinciden', 'error'); return; }
    if (newPw.length < 6) { showToast('Error', 'La contraseña debe tener al menos 6 caracteres', 'error'); return; }

    API.updateSettings({ admin_password: newPw })
      .then(function () {
        showToast('Guardado', 'Contraseña de admin cambiada. Deberás iniciar sesión nuevamente.', 'success');
        document.getElementById('settings-new-pw').value = '';
        document.getElementById('settings-confirm-pw').value = '';
      })
      .catch(function (err) { showToast('Error', err.message, 'error'); });
  }

  /* ================================================================
     AUTO-REFRESH
     ================================================================ */
  function startAutoRefresh() {
    stopAutoRefresh();
    state.refreshTimer = setInterval(function () {
      var route = getRoute();
      if (route.page === 'overview' || route.page === 'users') {
        silentRefreshOverview();
      }
    }, 30000);
  }

  function stopAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  /** Refresh overview data without full re-render (avoids flicker). */
  function silentRefreshOverview() {
    API.getUsers().then(function (data) {
      state.users = data.users;
      // Only re-render user cards if we are on overview
      var route = getRoute();
      if (route.page === 'overview' || route.page === 'users') {
        var grid = document.querySelector('.user-grid');
        if (grid) {
          var html = '';
          for (var i = 0; i < data.users.length; i++) {
            html += renderUserCard(data.users[i]);
          }
          grid.innerHTML = html;
        }
        // Update stats
        updateOverviewStats(data.users);
      }
    }).catch(function () {
      // Silently ignore refresh errors
    });
  }

  function updateOverviewStats(users) {
    var statCards = document.querySelectorAll('.stat-card');
    if (statCards.length < 4) return;
    var totalUsers = users.length;
    var activeUsers = users.filter(function (u) { return u.status === 'active'; }).length;
    var pausedUsers = users.filter(function (u) { return u.status === 'paused'; }).length;
    var killedUsers = users.filter(function (u) { return u.status === 'killed'; }).length;

    var vals = statCards[0].querySelector('.stat-value');
    if (vals) vals.textContent = totalUsers;
    vals = statCards[1].querySelector('.stat-value');
    if (vals) vals.textContent = activeUsers;
    vals = statCards[2].querySelector('.stat-value');
    if (vals) vals.textContent = pausedUsers;
    vals = statCards[3].querySelector('.stat-value');
    if (vals) vals.textContent = killedUsers;
  }

  function updateTeamNameDisplay() {
    var el = document.getElementById('sidebar-team-name');
    if (el && state.team) el.textContent = state.team.name;
  }

  /* ================================================================
     LOGIN
     ================================================================ */
  function handleLogin(e) {
    e.preventDefault();
    var pw = document.getElementById('login-password').value;
    var errEl = document.getElementById('login-error');
    var btn = document.getElementById('login-btn');

    if (!pw) { errEl.textContent = 'La contraseña es requerida'; errEl.classList.remove('hidden'); return; }

    btn.disabled = true;
    btn.textContent = 'Iniciando sesión...';
    errEl.classList.add('hidden');

    API.login(pw)
      .then(function (data) {
        state.token = data.token;
        state.team = data.team;
        localStorage.setItem('clm_token', data.token);
        updateTeamNameDisplay();
        navigate('overview');
      })
      .catch(function (err) {
        errEl.textContent = err.message || 'Login failed';
        errEl.classList.remove('hidden');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Iniciar Sesión';
      });
  }

  function handleLogout() {
    state.token = null;
    state.team = null;
    localStorage.removeItem('clm_token');
    stopAutoRefresh();
    WS.disconnect();
    navigate('login');
  }

  /* ================================================================
     MOBILE SIDEBAR
     ================================================================ */
  function openMobileSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.remove('hidden');
  }

  function closeMobileSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.add('hidden');
  }

  /* ================================================================
     EVENT DELEGATION
     ================================================================ */
  function setupEventDelegation() {
    document.addEventListener('click', function (e) {
      var target = e.target.closest('[data-action]');
      if (!target) return;

      var action = target.getAttribute('data-action');
      var userId = target.getAttribute('data-user-id');
      var userName = target.getAttribute('data-user-name');

      switch (action) {
        case 'view-user':
          e.preventDefault();
          if (userId) navigate('user', { id: userId });
          break;

        case 'add-user':
          openAddUserModal();
          break;

        case 'explain-credits':
          openCreditsExplainerModal();
          break;

        case 'submit-add-user':
          submitAddUser();
          break;

        case 'pause-user':
          e.stopPropagation();
          if (userId) pauseUser(userId, userName);
          break;

        case 'kill-user':
          e.stopPropagation();
          if (userId) killUser(userId, userName);
          break;

        case 'reinstate-user':
          e.stopPropagation();
          if (userId) reinstateUser(userId, userName);
          break;

        case 'delete-user':
          if (userId) deleteUser(userId, userName);
          break;

        case 'edit-limits':
          if (userId) openEditLimitsModal(userId);
          break;

        case 'submit-edit-limits':
          submitEditLimits(userId);
          break;

        case 'add-time-rule':
          addTimeRuleRow();
          break;

        case 'close-modal':
          closeModal();
          break;

        case 'copy-install':
          var directCmd = target.getAttribute('data-command');
          if (directCmd) { copyToClipboard(directCmd); break; }
          var targetId = target.getAttribute('data-target');
          if (targetId) {
            var el = document.getElementById(targetId);
            if (el) copyToClipboard(el.textContent);
          }
          break;

        case 'save-team-name':
          saveTeamName();
          break;

        case 'save-weights':
          saveWeights();
          break;

        case 'save-effort':
          saveEffortMultipliers();
          break;

        case 'change-password':
          changePassword();
          break;

        case 'toggle-self-uninstall':
          if (userId) {
            var current = target.getAttribute('data-current') === '1';
            var next = !current;
            API.updateUser(userId, { allow_self_uninstall: next })
              .then(function () {
                showToast(
                  'Updated',
                  (userName || 'Usuario') + ': desinstalación propia ' + (next ? 'habilitada' : 'deshabilitada'),
                  next ? 'success' : 'warning'
                );
                renderPage(getRoute());
              })
              .catch(function (err) { showToast('Error', err.message, 'error'); });
          }
          break;

        case 'toggle-allow-agents':
          if (userId) {
            var currentAg = target.getAttribute('data-current') === '1';
            var nextAg = !currentAg;
            API.updateUser(userId, { allow_agents: nextAg })
              .then(function () {
                showToast(
                  'Updated',
                  (userName || 'Usuario') + ': Agent View / Remote Control ' + (nextAg ? 'habilitado' : 'deshabilitado'),
                  nextAg ? 'success' : 'warning'
                );
                renderPage(getRoute());
              })
              .catch(function (err) { showToast('Error', err.message, 'error'); });
          }
          break;

        case 'toggle-allow-workflows':
          if (userId) {
            var currentWf = target.getAttribute('data-current') === '1';
            var nextWf = !currentWf;
            API.updateUser(userId, { allow_workflows: nextWf })
              .then(function () {
                showToast(
                  'Updated',
                  (userName || 'Usuario') + ': Workflows ' + (nextWf ? 'habilitados' : 'deshabilitados'),
                  nextWf ? 'success' : 'warning'
                );
                renderPage(getRoute());
              })
              .catch(function (err) { showToast('Error', err.message, 'error'); });
          }
          break;
      }
    });

    // Max effort level selector (change event on <select>)
    document.addEventListener('change', function (e) {
      var sel = e.target.closest('[data-action="change-max-effort"]');
      if (!sel) return;
      var uid = sel.getAttribute('data-user-id');
      var uname = sel.getAttribute('data-user-name');
      var newLevel = sel.value;
      API.updateUser(uid, { max_effort_level: newLevel })
        .then(function () {
          showToast('Updated', (uname || 'Usuario') + ': effort máximo = ' + newLevel, 'success');
          renderPage(getRoute());
        })
        .catch(function (err) { showToast('Error', err.message, 'error'); });
    });

    // Preset buttons (inside modal)
    document.addEventListener('click', function (e) {
      var presetBtn = e.target.closest('.preset-btn');
      if (!presetBtn) return;
      var preset = presetBtn.getAttribute('data-preset');
      if (preset) selectPreset(preset);
    });

    // Modal overlay click-outside to close
    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });

    document.getElementById('confirm-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        document.getElementById('confirm-cancel').click();
      }
    });

    // Login form
    document.getElementById('login-form').addEventListener('submit', handleLogin);

    // Logout
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Hamburger
    document.getElementById('hamburger-btn').addEventListener('click', function () {
      var sidebar = document.getElementById('sidebar');
      if (sidebar.classList.contains('open')) {
        closeMobileSidebar();
      } else {
        openMobileSidebar();
      }
    });

    // Sidebar overlay
    document.getElementById('sidebar-overlay').addEventListener('click', closeMobileSidebar);

    // Hash change
    window.addEventListener('hashchange', handleRoute);

    // Keyboard: Escape closes modals
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var modalOverlay = document.getElementById('modal-overlay');
        if (!modalOverlay.classList.contains('hidden')) {
          closeModal();
          return;
        }
        var confirmOverlay = document.getElementById('confirm-overlay');
        if (!confirmOverlay.classList.contains('hidden')) {
          document.getElementById('confirm-cancel').click();
        }
      }
    });
  }

  /* ================================================================
     WEBSOCKET EVENT HANDLING
     ================================================================ */
  function setupWSListeners() {
    WS.onEvent(function (event) {
      if (!event || !event.type) return;

      // Handle live feed events
      var feed = wsEventToFeed(event);
      if (feed) {
        addLiveFeedItem(feed);
      }

      // Show toast for blocked events
      if (event.type === 'user_blocked') {
        showToast(
          'Usuario Bloqueado',
          (event.userName || 'Desconocido') + ' fue bloqueado en ' + (event.model || 'desconocido'),
          'warning',
          8000
        );
      }

      // Show toast for kill events
      if (event.type === 'user_killed' || (event.type === 'user_status_change' && event.newStatus === 'killed')) {
        showToast(
          'Acceso Revocado',
          'El acceso de ' + (event.userName || 'Desconocido') + ' ha sido revocado',
          'error',
          8000
        );
      }

      // Refresh user cards on status changes
      if (event.type === 'user_status_change' || event.type === 'user_killed' || event.type === 'user_counted') {
        silentRefreshOverview();
      }
    });
  }

  /* ================================================================
     INIT
     ================================================================ */
  function init() {
    setupEventDelegation();
    setupWSListeners();

    // If we have a token, try to load team info
    if (state.token) {
      API.getUsers().then(function (data) {
        state.users = data.users;
        // Try to get team info from login endpoint's stored state
        // We do not have a dedicated /team endpoint, so we store it on login
        var storedTeam = localStorage.getItem('clm_team');
        if (storedTeam) {
          try { state.team = JSON.parse(storedTeam); } catch (e) { /* ignore */ }
        }
        updateTeamNameDisplay();
      }).catch(function () {
        // Token might be expired
      });
    }

    // Route
    handleRoute();
  }

  // Patch login to also store team info
  var originalLogin = API.login;
  API.login = function (password) {
    return originalLogin(password).then(function (data) {
      if (data.team) {
        localStorage.setItem('clm_team', JSON.stringify(data.team));
      }
      return data;
    });
  };

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
