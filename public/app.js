const REPORT_ROUTES = {
  salesOrders: id => `/reports/sales-order/${encodeURIComponent(id)}`,
  purchaseOrders: id => `/reports/purchase-order/${encodeURIComponent(id)}`,
  quotations: id => `/reports/quotation/${encodeURIComponent(id)}`,
  stockRequisitions: id => `/reports/packing-list/${encodeURIComponent(id)}`,
  purchaseRequisitions: id => `/reports/packing-list/${encodeURIComponent(id)}`,
};

const STANDALONE_REPORTS = [
  { label: 'Reports Directory (all reports)', url: '/reports' },
  { label: 'Item Catalog', url: '/reports/item-catalog' },
  { label: 'Company Directory', url: '/reports/directory' },
  { label: 'Forecast vs Actual', url: '/reports/forecast-variance' },
];

let SCHEMA = null;
let CURRENT_ENTITY = null;
let CURRENT_ROWS = [];
let EDITING_ID = null;
let FK_OPTIONS_CACHE = {};

const $ = sel => document.querySelector(sel);
const nav = $('#nav');
const content = $('#content');
const entityTitle = $('#entity-title');
const addBtn = $('#add-btn');

// ---------------------------------------------------------------------
// Real, server-verified login. The server enforces this too (every /api
// route requires a valid session, and department restrictions are checked
// server-side, not just here) — this client-side logic just drives the UI
// to match what the server will actually allow.
// ---------------------------------------------------------------------
let CURRENT_USER = null;

const FULL_ACCESS_DEPARTMENTS = ['CSR', 'Customer Service'];

// Mirrors the server's DEPARTMENT_ENTITY_ACCESS map, purely so the sidebar
// doesn't show items that would just 403 if clicked. The real enforcement
// lives on the server — this is only for UI tidiness.
const DEPARTMENT_ENTITY_ACCESS = {
  'Logistics': ['salesOrders', 'purchaseOrders', 'stockRequisitions', 'purchaseRequisitions'],
  'Procurement': ['purchaseOrders', 'poDetails', 'stockRequisitions', 'purchaseRequisitions', 'items', 'categories', 'companies', 'contacts'],
};

function hasFullAccess(user) {
  return !user || FULL_ACCESS_DEPARTMENTS.includes(user.department);
}

function canSeeEntity(entityKey) {
  if (hasFullAccess(CURRENT_USER)) return true;
  const allowed = (CURRENT_USER.allowedEntities && CURRENT_USER.allowedEntities.length) ? CURRENT_USER.allowedEntities : DEPARTMENT_ENTITY_ACCESS[CURRENT_USER.department];
  if (!allowed) return true;
  return allowed.includes(entityKey);
}

async function showLoginScreen(errorMsg, mode) {
  const users = await fetch('/api/auth/login-users').then(r => r.json()).catch(() => []);
  const noUsersYet = users.length === 0;
  const showSignup = noUsersYet || mode === 'signup';

  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-brand"><div class="brand-mark">NX</div><div><div class="brand-title">Nexora</div></div></div>
        ${showSignup ? `
          <h2>${noUsersYet ? 'Create the first account' : 'Sign up'}</h2>
          <p class="login-hint" style="margin-top:0">${noUsersYet
            ? "No users exist yet. Set up the first account here — it'll have full access and you can add more people afterward."
            : 'Your account will be created but needs approval from an admin before you can sign in.'}</p>
          ${errorMsg ? `<div class="login-error">${escapeHtml(errorMsg)}</div>` : ''}
          <div class="field"><label>Full Name</label><input type="text" id="setup_name" /></div>
          <div class="field"><label>Username</label><input type="text" id="setup_username" autocomplete="username" /></div>
          <div class="field"><label>Password</label><input type="password" id="setup_password" autocomplete="new-password" /></div>
          ${!noUsersYet ? `<div class="field"><label>Requested Department</label>
            <select id="setup_department">
              <option value="CSR">CSR (Customer Service)</option>
              <option value="Procurement">Procurement</option>
              <option value="Logistics">Logistics</option>
              <option value="Unassigned">Other / Not sure</option>
            </select>
          </div>` : ''}
          <button type="button" class="btn btn-primary" style="margin-top:8px;width:100%" onclick="createFirstAccount(${noUsersYet})">${noUsersYet ? 'Create Account & Sign In' : 'Sign Up'}</button>
          ${!noUsersYet ? `<div class="login-hint" style="text-align:center;margin-top:14px"><a href="#" onclick="showLoginScreen(); return false;">Already have an account? Sign in</a></div>` : ''}
        ` : `
          <h2>Sign in</h2>
          ${errorMsg ? `<div class="login-error">${escapeHtml(errorMsg)}</div>` : ''}
          <form id="login-form" onsubmit="return false;">
            <div class="field"><label>Username</label><input type="text" id="login_username" autocomplete="username" /></div>
            <div class="field"><label>Password</label><input type="password" id="login_password" autocomplete="current-password" /></div>
            <button type="submit" class="btn btn-primary" style="margin-top:8px;width:100%" onclick="doLogin()">Sign in</button>
          </form>
          <div class="login-hint" style="text-align:center;margin-top:14px"><a href="#" onclick="showLoginScreen(null, 'signup'); return false;">Need an account? Sign up</a></div>
        `}
      </div>
    </div>
  `;
  $('#login_password')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#setup_password')?.addEventListener('keydown', e => { if (e.key === 'Enter') createFirstAccount(noUsersYet); });
}

async function createFirstAccount(isFirstUser) {
  const name = $('#setup_name').value.trim();
  const username = $('#setup_username').value.trim();
  const password = $('#setup_password').value;
  const requestedDepartment = $('#setup_department')?.value;
  if (!name || !username || !password) { showLoginScreen('Please fill in all fields.', isFirstUser ? undefined : 'signup'); return; }
  if (password.length < 6) { showLoginScreen('Password should be at least 6 characters.', isFirstUser ? undefined : 'signup'); return; }

  const res = await fetch('/api/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, username, password, requestedDepartment }),
  });
  const data = await res.json();
  if (!res.ok) { showLoginScreen(data.error || 'Could not create account.', isFirstUser ? undefined : 'signup'); return; }

  if (data.autoLoggedIn) {
    location.reload();
  } else {
    document.body.innerHTML = `
      <div class="login-screen"><div class="login-card">
        <div class="login-brand"><div class="brand-mark">NX</div><div><div class="brand-title">Nexora</div></div></div>
        <h2>Request submitted</h2>
        <p class="login-hint" style="margin-top:0">Your account request has been sent to an admin for approval. You'll be able to sign in once it's approved.</p>
        <button class="btn btn-ghost" style="width:100%" onclick="showLoginScreen()">Back to Sign In</button>
      </div></div>
    `;
  }
}

async function doLogin() {
  const username = $('#login_username').value.trim();
  const password = $('#login_password').value;
  if (!username || !password) { showLoginScreen('Please enter both a username and password.'); return; }
  const res = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) { showLoginScreen(data.error || 'Login failed.'); return; }
  location.reload();
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
}

async function init() {
  const sessionUser = await fetch('/api/auth/session').then(r => r.json()).catch(() => null);
  if (!sessionUser) {
    await showLoginScreen();
    return;
  }
  CURRENT_USER = sessionUser;

  const res = await fetch('/api/schema');
  SCHEMA = await res.json();
  renderNav();
  renderReportsNav();
  renderUserBadge();
  connectLiveUpdates();
}

// ---------------------------------------------------------------------
// Live updates over WebSocket. When anyone (on this machine or another one
// connected to the same host) saves or deletes something, we get pushed a
// lightweight notification and refresh the current screen if it's a plain
// list view. This is intentionally conservative — screens with an in-progress
// edit (Sales Order forms, RMA creation, etc.) are NOT auto-refreshed out
// from under someone mid-edit; only read-only list views refresh live.
// ---------------------------------------------------------------------
let ws = null;
function connectLiveUpdates() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'data-changed' && CURRENT_ENTITY && !SPECIAL_SCREEN_ACTIVE) {
        loadRows();
      }
    } catch (e) { /* ignore malformed messages */ }
  };
  ws.onclose = () => {
    // Reconnect after a short delay if the connection drops (e.g. host
    // machine briefly unreachable over the network).
    setTimeout(connectLiveUpdates, 3000);
  };
}
let SPECIAL_SCREEN_ACTIVE = false;

async function renderUserBadge() {
  const brandEl = document.querySelector('.brand');
  if (!brandEl || document.querySelector('.user-badge')) return;
  const badge = document.createElement('div');
  badge.className = 'user-badge';
  badge.innerHTML = `<span>${escapeHtml(CURRENT_USER.name)} · ${escapeHtml(CURRENT_USER.department)}</span><button onclick="logout()">Sign out</button>`;
  brandEl.after(badge);

  // If other machines could reach this one over the network (i.e. this is
  // acting as the shared Host), show that address so it's easy to hand out.
  try {
    const info = await fetch('/api/network-info').then(r => r.json());
    if (info.addresses && info.addresses.length) {
      const hostBadge = document.createElement('div');
      hostBadge.className = 'host-address-badge';
      hostBadge.innerHTML = `Others on your network connect to: <strong>${escapeHtml(info.addresses[0])}</strong>`;
      badge.after(hostBadge);
    }
  } catch (e) { /* non-critical, skip silently */ }
}


function renderReportsNav() {
  const groupEl = document.createElement('div');
  groupEl.className = 'nav-group';
  const label = document.createElement('div');
  label.className = 'nav-group-label';
  label.textContent = 'Reports';
  groupEl.appendChild(label);
  STANDALONE_REPORTS.forEach(r => {
    const item = document.createElement('div');
    item.className = 'nav-item';
    item.innerHTML = `<span>🖨 ${r.label}</span>`;
    item.addEventListener('click', () => window.open(r.url, '_blank'));
    groupEl.appendChild(item);
  });
  nav.appendChild(groupEl);
}

function renderNav() {
  nav.innerHTML = '';
  SCHEMA.navGroups.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'nav-group';
    const label = document.createElement('div');
    label.className = 'nav-group-label';
    label.textContent = group.label;
    groupEl.appendChild(label);

    group.entities.forEach(key => {
      if (!canSeeEntity(key)) return;
      const ent = SCHEMA.entities[key];
      const item = document.createElement('div');
      item.className = 'nav-item';
      item.dataset.entity = key;
      item.innerHTML = `<span>${ent.label}</span>`;
      item.addEventListener('click', () => selectEntity(key));
      groupEl.appendChild(item);
    });

    if (group.label === 'Documents & Reference' && hasFullAccess(CURRENT_USER)) {
      const dnItem = document.createElement('div');
      dnItem.className = 'nav-item';
      dnItem.dataset.special = 'deliveryNotes';
      dnItem.innerHTML = `<span>Delivery Notes</span>`;
      dnItem.addEventListener('click', () => openDeliveryNotePicker());
      groupEl.appendChild(dnItem);

      const rmaItem = document.createElement('div');
      rmaItem.className = 'nav-item';
      rmaItem.dataset.special = 'rma';
      rmaItem.innerHTML = `<span>RMA (Returns)</span>`;
      rmaItem.addEventListener('click', () => openRmaScreen());
      groupEl.appendChild(rmaItem);

      const approvalsItem = document.createElement('div');
      approvalsItem.className = 'nav-item';
      approvalsItem.dataset.special = 'approvals';
      approvalsItem.innerHTML = `<span>Pending User Approvals</span>`;
      approvalsItem.addEventListener('click', () => openApprovalsScreen());
      groupEl.appendChild(approvalsItem);
    }

    if (groupEl.children.length > 1) nav.appendChild(groupEl);
  });
}

async function openApprovalsScreen() {
  SPECIAL_SCREEN_ACTIVE = true;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector('[data-special="approvals"]')?.classList.add('active');
  entityTitle.textContent = 'Pending User Approvals';
  addBtn.style.display = 'none';
  content.innerHTML = '<div class="empty-state">Loading…</div>';

  const pending = await fetch('/api/auth/pending-users').then(r => r.json()).catch(() => []);

  if (!pending.length) {
    content.innerHTML = '<div class="empty-state">No pending sign-up requests right now.</div>';
    return;
  }

  // Build the "what can they see" checklist from the real sidebar structure,
  // so approving someone shows exactly the same sections they'd get in the nav.
  const allSections = SCHEMA.navGroups.flatMap(g => g.entities.map(key => ({ key, label: SCHEMA.entities[key].label, group: g.label })));

  let html = '<div class="record-cards">';
  pending.forEach(u => {
    html += `<div class="record-card" id="pending_${u.T28_User_PK}">
      <div class="record-card-header">
        <div class="record-card-title">${escapeHtml(u.T28_01_Name)} (@${escapeHtml(u.T28_02_Username)}) — requested: ${escapeHtml(u.T28_04_Department)}</div>
        <div class="record-card-actions">
          <button class="btn-danger" onclick="rejectUser('${u.T28_User_PK}')">Reject</button>
        </div>
      </div>
      <div class="approval-form">
        <div class="field"><label>Assign Department</label>
          <select id="approve_dept_${u.T28_User_PK}">
            <option value="CSR" ${u.T28_04_Department === 'CSR' ? 'selected' : ''}>CSR (Customer Service) — full access</option>
            <option value="Procurement" ${u.T28_04_Department === 'Procurement' ? 'selected' : ''}>Procurement</option>
            <option value="Logistics" ${u.T28_04_Department === 'Logistics' ? 'selected' : ''}>Logistics</option>
            <option value="Unassigned">Custom (choose sections below)</option>
          </select>
        </div>
        <label class="field-checkbox" style="margin:8px 0"><input type="checkbox" id="approve_full_${u.T28_User_PK}" onchange="toggleApprovalChecklist('${u.T28_User_PK}')" /> Grant full access (see everything)</label>
        <div id="approve_checklist_${u.T28_User_PK}" class="approval-checklist">
          ${allSections.map(s => `<label class="field-checkbox"><input type="checkbox" class="approve_entity_${u.T28_User_PK}" value="${s.key}" /> ${escapeHtml(s.label)} <span class="approval-group-tag">${escapeHtml(s.group)}</span></label>`).join('')}
        </div>
        <button class="btn btn-primary" style="margin-top:10px" onclick="approveUser('${u.T28_User_PK}')">Approve</button>
      </div>
    </div>`;
  });
  html += '</div>';
  content.innerHTML = html;
}

function toggleApprovalChecklist(pk) {
  const full = $(`#approve_full_${pk}`).checked;
  $(`#approve_checklist_${pk}`).style.display = full ? 'none' : 'grid';
}

async function approveUser(pk) {
  const department = $(`#approve_dept_${pk}`).value;
  const fullAccess = $(`#approve_full_${pk}`).checked;
  const allowedEntities = fullAccess ? [] : Array.from(document.querySelectorAll(`.approve_entity_${pk}:checked`)).map(el => el.value);
  const res = await fetch(`/api/auth/approve-user/${encodeURIComponent(pk)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ department, allowedEntities }),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); alert('Error: ' + (err.error || res.statusText)); return; }
  openApprovalsScreen();
}

async function rejectUser(pk) {
  if (!confirm('Reject this account request?')) return;
  await fetch(`/api/auth/reject-user/${encodeURIComponent(pk)}`, { method: 'POST' });
  openApprovalsScreen();
}

// ---------------------------------------------------------------------
// Stock/Purchase Requisition screen — Requester creates it against a
// Sales Order (which auto-lists all of that order's line items, matching
// the real paper SRF form), then it moves through Reviewer -> Manager
// approval before Logistics can generate Commercial Invoice / Packing
// List / Delivery Note against it.
// ---------------------------------------------------------------------
let REQ_STATE = null;

function currentUserCanAct(role) {
  if (hasFullAccess(CURRENT_USER)) return true;
  return CURRENT_USER && CURRENT_USER.role === role;
}

async function openRequisitionScreen(entityKey, id) {
  SPECIAL_SCREEN_ACTIVE = true;
  CURRENT_ENTITY = entityKey;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-entity="${entityKey}"]`)?.classList.add('active');
  entityTitle.textContent = entityKey === 'stockRequisitions' ? 'Stock Requisition' : 'Purchase Requisition';
  addBtn.style.display = 'none';
  content.innerHTML = '<div class="empty-state">Loading…</div>';

  const typeValue = entityKey === 'stockRequisitions' ? 'Stock Requisition' : 'Purchase Requisition';

  if (id === 'new') {
    const salesOrders = await fetch('/api/salesOrders').then(r => r.json());
    salesOrders.sort((a, b) => (b.T14_01_SO_Number || 0) - (a.T14_01_SO_Number || 0));
    REQ_STATE = { id: null, entityKey, typeValue, requisition: {}, so: null, soLines: [], salesOrders };
  } else {
    const data = await fetch(`/api/requisitions/${id}/full`).then(r => r.json());
    REQ_STATE = { id, entityKey, typeValue, requisition: data.requisition, so: data.so, soLines: data.soLines || [], salesOrders: [] };
  }
  renderRequisitionScreen();
}

function renderRequisitionScreen() {
  const s = REQ_STATE;
  const r = s.requisition;
  const status = r.T27_06_Status || 'Requested';

  const statusBadgeClass = { Requested: 'status-pending', Reviewed: 'status-pending', Approved: 'status-good', Rejected: 'status-bad' }[status] || 'status-pending';

  let html = `<div class="order-screen">
    <div class="order-toolbar">
      <span class="req-status-badge ${statusBadgeClass}">${escapeHtml(status)}</span>
      <span class="spacer"></span>
      <button class="btn btn-ghost" onclick="selectEntity('${s.entityKey}')">Close</button>
    </div>

    <div class="two-col">
      <div class="field"><label>SRF Number</label><div class="readout">${escapeHtml(r.T27_09_SRF_Number || '(assigned on save)')}</div></div>
      <div class="field"><label>Type</label><div class="readout">${escapeHtml(s.typeValue)}</div></div>
    </div>`;

  if (s.id === null) {
    // New requisition — pick the Sales Order
    html += `
    <div class="field"><label>Sales Order</label>
      <select id="req_so" onchange="onRequisitionSoChange(this.value)">
        <option value="">— select —</option>
        ${s.salesOrders.map(so => `<option value="${so.T14_SO_PK}">SO #${so.T14_01_SO_Number}</option>`).join('')}
      </select>
    </div>
    <div id="req_so_lines_preview"></div>
    <div class="two-col">
      <div class="field"><label>Requesting Office / Branch</label><input id="req_office" /></div>
      <div class="field"><label>Requested By</label><input id="req_by" value="${escapeHtml(CURRENT_USER?.name || '')}" /></div>
    </div>
    <div class="field"><label>Date Requested</label>${dateInput('req_date', new Date().toISOString().slice(0,10))}</div>
    <div class="field"><label>Notes</label><textarea id="req_notes"></textarea></div>
    <div class="order-save-bar"><button class="btn btn-primary" onclick="createRequisition()">Submit Requisition</button></div>
    `;
  } else {
    // Existing requisition — read-only summary + workflow actions
    html += `
    <div class="two-col">
      <div class="field"><label>Sales Order</label><div class="readout">${s.so ? 'SO #' + escapeHtml(String(s.so.T14_01_SO_Number)) : '—'}</div></div>
      <div class="field"><label>Requesting Office</label><div class="readout">${escapeHtml(r.T27_04_Requesting_Office || '—')}</div></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Requested By</label><div class="readout">${escapeHtml(r.T27_03_Requested_By || '—')}</div></div>
      <div class="field"><label>Date Requested</label><div class="readout">${fmtDate(r.T27_05_Date_Requested) || '—'}</div></div>
    </div>

    <h4 style="margin-top:20px">Items (from ${s.so ? 'SO #' + escapeHtml(String(s.so.T14_01_SO_Number)) : 'linked Sales Order'})</h4>
    ${gridOrEmpty(s.soLines, ['Item Code', 'Item Name', 'Quantity'], l => [l.partNumber, l.itemName, l.T15_01_Quantity])}

    <div class="approval-trail">
      <h4>Approval Trail</h4>
      <div class="meta-row"><span>Reviewed By</span><span>${escapeHtml(r.T27_10_Reviewed_By || '—')} ${r.T27_11_Reviewed_Date ? '(' + fmtDate(r.T27_11_Reviewed_Date) + ')' : ''}</span></div>
      <div class="meta-row"><span>Approved By</span><span>${escapeHtml(r.T27_12_Approved_By || '—')} ${r.T27_13_Approved_Date ? '(' + fmtDate(r.T27_13_Approved_Date) + ')' : ''}</span></div>
      ${r.T27_08_Notes ? `<div class="meta-row"><span>Notes</span><span>${escapeHtml(r.T27_08_Notes)}</span></div>` : ''}
    </div>

    <div class="req-actions">
      ${status === 'Requested' && currentUserCanAct('Reviewer') ? `
        <button class="btn btn-primary" onclick="reviewRequisition('Reviewed')">Mark Reviewed</button>
        <button class="btn-danger" onclick="reviewRequisition('Rejected')">Reject</button>
      ` : ''}
      ${status === 'Reviewed' && currentUserCanAct('Manager') ? `
        <button class="btn btn-primary" onclick="approveRequisition('Approved')">Approve</button>
        <button class="btn-danger" onclick="approveRequisition('Rejected')">Reject</button>
      ` : ''}
      ${status === 'Approved' && s.so ? `
        <div class="doc-print-links" style="margin-top:12px">
          <h4>Generate Logistics Documents (SRF ${escapeHtml(r.T27_09_SRF_Number || '')})</h4>
          <div class="doc-print-links-row">
            <button class="btn btn-ghost" onclick="window.open('/reports/commercial-invoice/${s.so.T14_SO_PK}','_blank')">Commercial Invoice</button>
            <button class="btn btn-ghost" onclick="window.open('/reports/packing-list-so/${s.so.T14_SO_PK}','_blank')">Packing List</button>
            <button class="btn btn-ghost" onclick="window.open('/reports/delivery-note/${s.so.T14_SO_PK}','_blank')">Delivery Note</button>
          </div>
        </div>
      ` : ''}
      ${status === 'Requested' && !currentUserCanAct('Reviewer') ? `<p class="empty-notice-inline">Waiting on a Reviewer to act on this request.</p>` : ''}
      ${status === 'Reviewed' && !currentUserCanAct('Manager') ? `<p class="empty-notice-inline">Waiting on a Manager to approve this request.</p>` : ''}
      ${status === 'Rejected' ? `<p class="empty-notice-inline">This request was rejected.</p>` : ''}
    </div>
    `;
  }

  html += `</div>`;
  content.innerHTML = html;
}

async function onRequisitionSoChange(soPk) {
  const previewEl = $('#req_so_lines_preview');
  if (!soPk) { previewEl.innerHTML = ''; return; }
  const soFull = await fetch(`/api/sales-orders/${encodeURIComponent(soPk)}/full`).then(r => r.json());
  REQ_STATE.selectedSoPk = soPk;
  previewEl.innerHTML = `<h4 style="margin-top:12px">Items on this Sales Order</h4>` +
    gridOrEmpty(soFull.lines, ['Item Code', 'Description', 'Quantity'], l => [l.partNumber, l.description, l.T15_01_Quantity]);
}

async function createRequisition() {
  const soPk = REQ_STATE.selectedSoPk;
  if (!soPk) { alert('Please select a Sales Order.'); return; }
  const body = {
    T14_SO_PK: soPk,
    T27_04_Requesting_Office: $('#req_office').value,
    T27_03_Requested_By: $('#req_by').value,
    T27_05_Date_Requested: $('#req_date').value,
    T27_08_Notes: $('#req_notes').value,
    T27_06_Status: 'Requested',
  };
  if (!body.T27_04_Requesting_Office) { alert('Please enter a Requesting Office / Branch.'); return; }
  const res = await fetch(`/api/${REQ_STATE.entityKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
  openRequisitionScreen(REQ_STATE.entityKey, data.T27_Requisition_ID);
}

async function reviewRequisition(decision) {
  const notes = decision === 'Rejected' ? prompt('Reason for rejection (optional):') : null;
  const res = await fetch(`/api/requisitions/${REQ_STATE.id}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, notes }),
  });
  const data = await res.json();
  if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
  openRequisitionScreen(REQ_STATE.entityKey, REQ_STATE.id);
}

async function approveRequisition(decision) {
  const notes = decision === 'Rejected' ? prompt('Reason for rejection (optional):') : null;
  const res = await fetch(`/api/requisitions/${REQ_STATE.id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, notes }),
  });
  const data = await res.json();
  if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
  openRequisitionScreen(REQ_STATE.entityKey, REQ_STATE.id);
}

async function openRmaScreen() {
  SPECIAL_SCREEN_ACTIVE = true;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector('[data-special="rma"]')?.classList.add('active');
  entityTitle.textContent = 'RMA (Returns)';
  addBtn.style.display = 'none';
  content.innerHTML = '<div class="empty-state">Loading…</div>';

  const [rmas, salesOrders] = await Promise.all([
    fetch('/api/rma').then(r => r.json()),
    fetch('/api/salesOrders').then(r => r.json()),
  ]);
  salesOrders.sort((a, b) => (b.T14_01_SO_Number || 0) - (a.T14_01_SO_Number || 0));

  let html = `
    <div class="rma-new-block">
      <h4>Create New RMA</h4>
      <div class="two-col">
        <div class="field"><label>Sales Order</label>
          <select id="rma_so" onchange="onRmaSoChange(this.value)">
            <option value="">— select —</option>
            ${salesOrders.map(so => `<option value="${so.T14_SO_PK}">SO #${so.T14_01_SO_Number}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Item / Serial Number</label>
          <select id="rma_serial"><option value="">— select a Sales Order first —</option></select>
        </div>
      </div>
      <div class="field"><label>Reason for Return</label><textarea id="rma_reason" placeholder="e.g. Unit not powering on"></textarea></div>
      <div class="field"><label>Date Requested</label>${dateInput('rma_date', new Date().toISOString().slice(0,10))}</div>
      <button class="btn btn-primary" onclick="createRma()">Create RMA</button>
      <div id="rma_create_result"></div>
    </div>
    <h4 style="margin-top:24px">Existing RMAs</h4>
    ${gridOrEmpty(rmas, ['RMA #', 'SO #', 'Item Code', 'Item', 'Serial #', 'Warranty', 'Status', 'Print'],
      r => [r.T30_01_RMA_Number, r.soNumber, r.partNumber, r.itemDesc, r.serialNumber || '—',
        r.T30_04_Under_Warranty === 1 ? 'Under Warranty' : r.T30_04_Under_Warranty === 0 ? 'Expired' : '—',
        r.T30_05_Status, `<a href="/reports/rma/${r.T30_RMA_PK}" target="_blank">Print</a>`])}
  `;
  content.innerHTML = html;
}

let RMA_SO_ITEMS = [];
async function onRmaSoChange(soPk) {
  const serialSelect = $('#rma_serial');
  if (!soPk) { serialSelect.innerHTML = '<option value="">— select a Sales Order first —</option>'; return; }
  const [soFull, serials] = await Promise.all([
    fetch(`/api/sales-orders/${encodeURIComponent(soPk)}/full`).then(r => r.json()),
    fetch(`/api/sales-orders/${encodeURIComponent(soPk)}/serials`).then(r => r.json()),
  ]);
  RMA_SO_ITEMS = soFull.lines || [];
  if (serials.length) {
    serialSelect.innerHTML = serials.map(s => `<option value="serial:${s.T24_Serial_PK}:${s.T11_Item_Master_PK}">${escapeHtml(s.partNumber ?? '')} — S/N ${escapeHtml(s.T24_03_Serial_Number || '')}</option>`).join('');
  } else if (RMA_SO_ITEMS.length) {
    serialSelect.innerHTML = RMA_SO_ITEMS.map(l => `<option value="item:${l.T11_Item_Master_PK}">${escapeHtml(l.partNumber ?? '')} — ${escapeHtml(l.description || '')} (no serial on file)</option>`).join('');
  } else {
    serialSelect.innerHTML = '<option value="">No items found on this order</option>';
  }
}

async function createRma() {
  const soPk = $('#rma_so').value;
  const serialVal = $('#rma_serial').value;
  const reason = $('#rma_reason').value;
  const date = $('#rma_date').value;
  if (!soPk || !serialVal) { alert('Please select a Sales Order and Item/Serial.'); return; }
  const parts = serialVal.split(':');
  const body = {
    T14_SO_PK: soPk,
    T24_Serial_PK: parts[0] === 'serial' ? parts[1] : null,
    T11_Item_Master_PK: parts[0] === 'serial' ? parts[2] : parts[1],
    T30_02_Reason: reason,
    T30_03_Date_Requested: date,
  };
  const res = await fetch('/api/rma', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { alert('Error: ' + (data.error || res.statusText)); return; }
  $('#rma_create_result').innerHTML = `<p style="margin-top:10px">Created <strong>${escapeHtml(data.T30_01_RMA_Number)}</strong> — <a href="/reports/rma/${data.T30_RMA_PK}" target="_blank">Print RMA</a></p>`;
  openRmaScreen();
}

async function openDeliveryNotePicker() {
  SPECIAL_SCREEN_ACTIVE = true;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector('[data-special="deliveryNotes"]')?.classList.add('active');
  entityTitle.textContent = 'Delivery Notes';
  addBtn.style.display = 'none';
  content.innerHTML = '<div class="empty-state">Loading sales orders…</div>';

  const [rows, contacts, companies] = await Promise.all([
    fetch('/api/salesOrders').then(r => r.json()),
    fetch('/api/contacts').then(r => r.json()),
    fetch('/api/companies').then(r => r.json()),
  ]);
  const contactById = Object.fromEntries(contacts.map(c => [c.T07_PK, c]));
  const companyById = Object.fromEntries(companies.map(c => [c.T01_PK, c]));

  if (!rows.length) {
    content.innerHTML = '<div class="empty-state">No sales orders yet. Create one under Sales Orders first.</div>';
    return;
  }

  rows.sort((a, b) => (b.T14_01_SO_Number || 0) - (a.T14_01_SO_Number || 0));

  let html = '<div class="record-cards">';
  rows.forEach(so => {
    const contact = contactById[so.T07_PK];
    const company = contact ? companyById[contact.T01_PK] : null;
    const customerLabel = company ? company.T01_01_Company_Name : (contact ? [contact.T07_01_Forename, contact.T07_02_Surname].filter(Boolean).join(' ') : '—');
    html += `<div class="record-card">
      <div class="record-card-header">
        <div class="record-card-title">SO #${escapeHtml(String(so.T14_01_SO_Number ?? ''))} — ${escapeHtml(customerLabel)}</div>
        <div class="record-card-actions">
          <button class="btn-edit" onclick="window.open('/reports/delivery-note/${so.T14_SO_PK}', '_blank')">Print Delivery Note</button>
          <button class="btn-edit" onclick="window.open('/reports/commercial-invoice/${so.T14_SO_PK}', '_blank')">Commercial Invoice</button>
          <button class="btn-edit" onclick="window.open('/reports/packing-list-so/${so.T14_SO_PK}', '_blank')">Packing List</button>
          <button class="btn-edit" onclick="openSalesOrderScreen('${so.T14_SO_PK}')">Open Order</button>
        </div>
      </div>
      <div class="record-card-grid">
        <div class="record-field"><div class="record-field-label">Despatch Date</div><div class="record-field-value">${fmtDate(so.T14_05_Despatch_Date) || '—'}</div></div>
        <div class="record-field"><div class="record-field-label">Sale Date</div><div class="record-field-value">${fmtDate(so.T14_04_Sale_Date) || '—'}</div></div>
      </div>
    </div>`;
  });
  html += '</div>';
  content.innerHTML = html;
}

async function selectEntity(key) {
  SPECIAL_SCREEN_ACTIVE = false;
  CURRENT_ENTITY = key;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.entity === key);
  });
  const ent = SCHEMA.entities[key];
  entityTitle.textContent = ent.label;
  addBtn.style.display = 'inline-block';
  if (key === 'salesOrders') addBtn.onclick = () => openSalesOrderScreen('new');
  else if (key === 'purchaseOrders') addBtn.onclick = () => openPurchaseOrderScreen('new');
  else if (key === 'companies') addBtn.onclick = () => openCompanyScreen('new');
  else if (key === 'stockRequisitions' || key === 'purchaseRequisitions') addBtn.onclick = () => openRequisitionScreen(key, 'new');
  else addBtn.onclick = () => openModal(null);
  await loadRows();
}

async function loadRows() {
  const ent = SCHEMA.entities[CURRENT_ENTITY];
  content.innerHTML = '<div class="empty-state">Loading…</div>';
  const res = await fetch(`/api/${CURRENT_ENTITY}`);
  CURRENT_ROWS = await res.json();
  renderTable();
}

function renderTable() {
  const ent = SCHEMA.entities[CURRENT_ENTITY];
  if (CURRENT_ROWS.length === 0) {
    content.innerHTML = `<div class="empty-state">No ${ent.label.toLowerCase()} yet. Click "+ New" to add the first one.</div>`;
    return;
  }
  const cols = ent.fields;
  const specialOpen = ['salesOrders', 'purchaseOrders', 'companies', 'stockRequisitions', 'purchaseRequisitions'].includes(CURRENT_ENTITY);

  let html = '<div class="record-cards">';
  CURRENT_ROWS.forEach(row => {
    const pkVal = ent.pk ? row[ent.pk] : row._rowid;
    const titleField = cols.find(f => f.name === ent.displayField) || cols[0];
    let titleVal = row[ent.displayField] ?? row[titleField?.name] ?? '';
    if (titleField?.fk) titleVal = row[`__${titleField.name}_label`] ?? titleVal;
    titleVal = (titleVal === null || titleVal === undefined || titleVal === '') ? '(untitled)' : escapeHtml(String(titleVal));

    html += `<div class="record-card">
      <div class="record-card-header">
        <div class="record-card-title">${titleVal}</div>
        <div class="record-card-actions">
          ${CURRENT_ENTITY === 'items' ? `<button class="btn-edit" onclick="openItemDetail('${pkVal}')">View</button>` : ''}
          ${CURRENT_ENTITY === 'salesOrders' ? `<button class="btn-edit" onclick="openSalesOrderScreen('${pkVal}')">Open</button>` : ''}
          ${CURRENT_ENTITY === 'purchaseOrders' ? `<button class="btn-edit" onclick="openPurchaseOrderScreen('${pkVal}')">Open</button>` : ''}
          ${CURRENT_ENTITY === 'companies' ? `<button class="btn-edit" onclick="openCompanyScreen('${pkVal}')">Open</button>` : ''}
          ${(CURRENT_ENTITY === 'stockRequisitions' || CURRENT_ENTITY === 'purchaseRequisitions') ? `<button class="btn-edit" onclick="openRequisitionScreen('${CURRENT_ENTITY}', '${pkVal}')">Open</button>` : ''}
          ${REPORT_ROUTES[CURRENT_ENTITY] && !specialOpen ? `<button class="btn-edit" onclick="window.open('${REPORT_ROUTES[CURRENT_ENTITY](pkVal)}', '_blank')">Print</button>` : ''}
          ${!specialOpen ? `<button class="btn-edit" onclick="openModal('${pkVal}')">Edit</button>` : ''}
          <button class="btn-danger" onclick="deleteRow('${pkVal}')">Delete</button>
        </div>
      </div>
      <div class="record-card-grid">`;

    cols.forEach(f => {
      if (f === titleField) return; // already shown in the header
      let val = row[f.name];
      if (f.fk) {
        val = row[`__${f.name}_label`] ?? val ?? '';
      } else if (f.type === 'bool') {
        val = val ? '<span class="bool-yes">Yes</span>' : '<span class="bool-no">No</span>';
      } else if (f.type === 'image') {
        val = val ? `<img class="record-field-thumb" src="/uploads/${escapeHtml(String(val))}" />` : '—';
      } else {
        val = (val === null || val === undefined || val === '') ? '—' : escapeHtml(String(val));
      }
      html += `<div class="record-field"><div class="record-field-label">${f.label}</div><div class="record-field-value">${val}</div></div>`;
    });

    html += `</div></div>`;
  });
  html += '</div>';
  content.innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function getFkOptions(table, filterFlag) {
  const cacheKey = filterFlag ? `${table}:${filterFlag}` : table;
  if (FK_OPTIONS_CACHE[cacheKey]) return FK_OPTIONS_CACHE[cacheKey];
  const url = filterFlag ? `/api/${table}/options?flag=${filterFlag}` : `/api/${table}/options`;
  const res = await fetch(url);
  const opts = await res.json();
  FK_OPTIONS_CACHE[cacheKey] = opts;
  return opts;
}

async function openModal(id) {
  EDITING_ID = id;
  const ent = SCHEMA.entities[CURRENT_ENTITY];
  $('#modal-title').textContent = id ? `Edit ${ent.label.replace(/s$/, '')}` : `New ${ent.label.replace(/s$/, '')}`;
  const form = $('#modal-form');
  form.innerHTML = '';

  let existing = {};
  if (id) {
    existing = CURRENT_ROWS.find(r => String(ent.pk ? r[ent.pk] : r._rowid) === String(id)) || {};
  }

  for (const f of ent.fields) {
    const fieldDiv = document.createElement('div');
    if (f.type === 'bool') {
      fieldDiv.className = 'field field-checkbox';
      fieldDiv.innerHTML = `
        <input type="checkbox" id="f_${f.name}" ${existing[f.name] ? 'checked' : ''} />
        <label for="f_${f.name}">${f.label}</label>`;
    } else {
      fieldDiv.className = 'field';
      const reqStar = f.required ? ' <span class="required-star">*</span>' : '';
      let inputHtml = '';
      if (f.fk) {
        const opts = await getFkOptions(f.fk.table, f.fk.filterFlag);
        inputHtml = `<select id="f_${f.name}"><option value="">— none —</option>` +
          opts.map(o => `<option value="${o.id}" ${String(existing[f.name]) === String(o.id) ? 'selected' : ''}>${escapeHtml(String(o.label))}</option>`).join('') +
          `</select>`;
      } else if (f.type === 'date') {
        inputHtml = `<input type="date" id="f_${f.name}" class="big-date-input" value="${existing[f.name] ? escapeHtml(String(existing[f.name])) : ''}" />`;
      } else if (f.name === 'T28_03_Password') {
        // Never show the existing bcrypt hash in the form — leave blank
        // (meaning "keep current password") unless the admin types a new one.
        inputHtml = `<input type="password" id="f_${f.name}" placeholder="${existing[f.name] ? 'Leave blank to keep current password' : 'Set a password'}" autocomplete="new-password" />`;
      } else if (f.type === 'number') {
        inputHtml = `<input type="number" step="1" id="f_${f.name}" value="${existing[f.name] ?? ''}" />`;
      } else if (f.type === 'float') {
        inputHtml = `<input type="number" step="any" id="f_${f.name}" value="${existing[f.name] ?? ''}" />`;
      } else if (f.type === 'image') {
        const currentUrl = existing[f.name] ? `/uploads/${existing[f.name]}` : '';
        inputHtml = `
          <input type="hidden" id="f_${f.name}" value="${existing[f.name] ? escapeHtml(String(existing[f.name])) : ''}" />
          <div class="image-field">
            <div class="image-preview" id="preview_${f.name}">${currentUrl ? `<img src="${currentUrl}" />` : '<span class="image-preview-empty">No image</span>'}</div>
            <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" id="file_${f.name}" onchange="handleImageSelect('${f.name}', this)" />
            ${currentUrl ? `<button type="button" class="btn-danger" style="margin-top:6px" onclick="clearImageField('${f.name}')">Remove</button>` : ''}
          </div>`;
      } else {
        inputHtml = `<textarea id="f_${f.name}">${existing[f.name] ? escapeHtml(String(existing[f.name])) : ''}</textarea>`;
      }
      fieldDiv.innerHTML = `<label for="f_${f.name}">${f.label}${reqStar}</label>${inputHtml}`;
    }
    form.appendChild(fieldDiv);
  }

  $('#modal-backdrop').classList.remove('hidden');
}

async function handleImageSelect(fieldName, inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  const preview = document.getElementById(`preview_${fieldName}`);
  preview.innerHTML = '<span class="image-preview-empty">Uploading…</span>';
  const formData = new FormData();
  formData.append('image', file);
  try {
    const res = await fetch('/api/upload-image', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    document.getElementById(`f_${fieldName}`).value = data.filename;
    preview.innerHTML = `<img src="${data.url}" />`;
  } catch (err) {
    preview.innerHTML = `<span class="image-preview-empty">Upload failed: ${escapeHtml(err.message)}</span>`;
  }
}

function clearImageField(fieldName) {
  document.getElementById(`f_${fieldName}`).value = '';
  document.getElementById(`preview_${fieldName}`).innerHTML = '<span class="image-preview-empty">No image</span>';
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  EDITING_ID = null;
}

async function saveRow() {
  const ent = SCHEMA.entities[CURRENT_ENTITY];
  const body = {};
  for (const f of ent.fields) {
    const el = document.getElementById(`f_${f.name}`);
    if (!el) continue;
    if (f.type === 'bool') body[f.name] = el.checked;
    else body[f.name] = el.value;
  }

  // Leaving the Password field blank while editing an existing user means
  // "keep the current password" — don't send it at all, or the server
  // would wipe it out to null and lock them out entirely.
  if (ent.table === 'T28_Users' && EDITING_ID && !body.T28_03_Password) {
    delete body.T28_03_Password;
  }

  const missing = ent.fields.filter(f => f.required && !body[f.name]);
  if (missing.length) {
    alert(`Please fill in: ${missing.map(f => f.label).join(', ')}`);
    return;
  }

  const saveBtn = $('#modal-save');
  const originalLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  // Safety net: never let the button stay stuck on "Saving…" even if
  // something unexpected hangs — re-enable after 15s regardless.
  const safetyTimer = setTimeout(() => {
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
    alert('This is taking longer than expected. Please check your connection and try again.');
  }, 15000);

  try {
    const url = EDITING_ID ? `/api/${CURRENT_ENTITY}/${EDITING_ID}` : `/api/${CURRENT_ENTITY}`;
    const method = EDITING_ID ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    clearTimeout(safetyTimer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Error saving: ' + (err.error || res.statusText));
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
      return;
    }
    closeModal();
    if (CURRENT_ENTITY === 'items') ITEMS_CACHE = null; // invalidate so Order screens pick up the change
    FK_OPTIONS_CACHE = {}; // any save could change a name/label shown in some dropdown elsewhere — just refetch all of them
    await loadRows();
  } catch (err) {
    clearTimeout(safetyTimer);
    alert('Could not save — network or app error: ' + (err && err.message ? err.message : err));
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
  }
}

async function deleteRow(id) {
  if (!confirm('Delete this record? This cannot be undone.')) return;
  await fetch(`/api/${CURRENT_ENTITY}/${id}`, { method: 'DELETE' });
  if (CURRENT_ENTITY === 'items') ITEMS_CACHE = null;
  FK_OPTIONS_CACHE = {};
  await loadRows();
}

// ---------------------------------------------------------------------
// Item Master detail screen — Costing / Specifications / Activity /
// Stock Levels / Stocktake / All Sales-Quotes-Purchases / Documents
// ---------------------------------------------------------------------
let ITEM_DETAIL = null;
let ITEM_DETAIL_TAB = 'costing';

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) { return d ? String(d) : ''; }

async function openItemDetail(id) {
  SPECIAL_SCREEN_ACTIVE = true;
  content.innerHTML = '<div class="empty-state">Loading item…</div>';
  entityTitle.textContent = 'Item Master';
  addBtn.style.display = 'none';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const res = await fetch(`/api/items/${encodeURIComponent(id)}/full`);
  if (!res.ok) {
    content.innerHTML = '<div class="empty-state">Item not found.</div>';
    return;
  }
  ITEM_DETAIL = await res.json();
  ITEM_DETAIL_TAB = 'costing';
  renderItemDetail();
}

const ITEM_TABS = [
  { key: 'costing', label: 'Costing' },
  { key: 'specifications', label: 'Specifications' },
  { key: 'activity', label: 'Activity' },
  { key: 'stockLevels', label: 'Stock Levels' },
  { key: 'stocktake', label: 'Stocktake' },
  { key: 'allSalesPurchases', label: 'All Sales / Quotes / Purchases' },
  { key: 'documents', label: 'Documents' },
];

function renderItemDetail() {
  const d = ITEM_DETAIL;
  const item = d.item;

  let html = `<div class="item-detail">
    <div class="item-detail-header">
      <button class="btn btn-ghost" onclick="selectEntity('items')">&larr; Back to Item Master list</button>
      <div class="item-detail-header-row">
        ${item.T11_55_Photo ? `<img class="item-detail-photo" src="/uploads/${escapeHtml(item.T11_55_Photo)}" />` : ''}
        <div>
          <h2>${escapeHtml(item.T11_03_Short_Description || '(no description)')}</h2>
          <div class="item-detail-sub">Item Code${escapeHtml(item.T11_01_Part_Number ?? '')} ${d.category ? '· ' + escapeHtml(d.category.T12_01_Category) : ''}</div>
        </div>
      </div>
    </div>
    <div class="tabs">`;
  ITEM_TABS.forEach(t => {
    html += `<button class="tab-btn ${ITEM_DETAIL_TAB === t.key ? 'active' : ''}" onclick="switchItemTab('${t.key}')">${t.label}</button>`;
  });
  html += `</div><div class="tab-panel">${renderItemTabContent()}</div></div>`;
  content.innerHTML = html;
}

function switchItemTab(key) {
  ITEM_DETAIL_TAB = key;
  renderItemDetail();
}

function renderItemTabContent() {
  const d = ITEM_DETAIL;
  const item = d.item;
  switch (ITEM_DETAIL_TAB) {
    case 'costing': {
      const purchases = d.allPurchases || [];
      const avgCost = purchases.length
        ? purchases.reduce((sum, p) => sum + (Number(p.price) || 0), 0) / purchases.length
        : 0;
      const costPrice = Number(item.T11_53_COST) || 0;
      const marginPct = (price) => {
        const p = Number(price) || 0;
        if (!p) return '—';
        return (((p - costPrice) / p) * 100).toFixed(2) + '%';
      };
      return `
        <div class="costing-layout">
          <div>
            <h4>Recent POs for Item Code ${escapeHtml(String(item.T11_01_Part_Number ?? ''))}: '${escapeHtml(item.T11_03_Short_Description || '')}'</h4>
            ${gridOrEmpty(purchases, ['PO Date', 'PO Number', 'Vendor', 'Qty', 'Unit Buy Price', 'Extd Buy Price'],
              r => [fmtDate(r.poDate), r.poNumber, r.supplierName, r.qty, fmtMoney(r.price), fmtMoney((Number(r.qty)||0) * (Number(r.price)||0))])}
            <div class="field" style="margin-top:16px; max-width:220px">
              <label>Calculated Average Cost Price</label>
              <div class="readout">${fmtMoney(avgCost)}</div>
            </div>
          </div>
          <div class="costing-margins">
            <table class="kv-table">
              <tr><th></th><th>Current Price</th><th>Gross Margin</th></tr>
              <tr><td>List / Retail</td><td>${fmtMoney(item.T11_09_List_Price)}</td><td>${marginPct(item.T11_09_List_Price)}</td></tr>
              <tr><td>Trade</td><td>${fmtMoney(item.T11_10_Trade_Price)}</td><td>${marginPct(item.T11_10_Trade_Price)}</td></tr>
              <tr><td>OEM</td><td>${fmtMoney(item.T11_11_OEM_Price)}</td><td>${marginPct(item.T11_11_OEM_Price)}</td></tr>
            </table>
            <div class="field" style="margin-top:16px; max-width:180px">
              <label>COST Price</label>
              <div class="readout">${fmtMoney(costPrice)}</div>
            </div>
            <div class="field" style="margin-top:10px; max-width:180px">
              <label>Re-order Qty</label>
              <div class="readout">${escapeHtml(String(item.T11_54_ReOrderQty ?? ''))}</div>
            </div>
            <div class="field" style="margin-top:10px; max-width:180px">
              <label>Qty On Hand</label>
              <div class="readout">${escapeHtml(String(item.T11_06_Qty_OH ?? ''))}</div>
            </div>
          </div>
        </div>
        <button class="btn btn-primary" style="margin-top:16px" onclick="selectEntity('items'); setTimeout(()=>openModal('${item.T11_Item_Master_PK}'),50)">Edit Item</button>`;
    }

    case 'specifications':
      if (!d.specs.length) return '<div class="empty-state">No specifications recorded.</div>';
      return `<table><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>${
        d.specs.map(s => `<tr><td>${escapeHtml(s.param)}</td><td>${escapeHtml(s.value)}</td></tr>`).join('')
      }</tbody></table>`;

    case 'activity': {
      const a = d.activity;
      return `
        <h4>Open Sales Orders (not yet despatched)</h4>
        ${gridOrEmpty(a.salesActivity, ['SO #', 'Quote Date', 'Sale Date', 'Customer', 'Qty', 'Price'],
          r => [r.soNumber, fmtDate(r.quoteDate), fmtDate(r.saleDate), r.customerName, r.qty, fmtMoney(r.price)])}
        <h4 style="margin-top:24px">Purchase Orders Due</h4>
        ${gridOrEmpty(a.poDue, ['PO #', 'PO Date', 'Due Date', 'Supplier', 'Qty', 'Price'],
          r => [r.poNumber, fmtDate(r.poDate), fmtDate(r.dueDate), r.supplierName, r.qty, fmtMoney(r.price)])}
        <h4 style="margin-top:24px">Purchase Orders Overdue</h4>
        ${gridOrEmpty(a.poOverdue, ['PO #', 'PO Date', 'Due Date', 'Supplier', 'Qty', 'Price'],
          r => [r.poNumber, fmtDate(r.poDate), fmtDate(r.dueDate), r.supplierName, r.qty, fmtMoney(r.price)], 'row-overdue')}
      `;
    }

    case 'stockLevels': {
      const s = d.stockLevels;
      return `<table class="kv-table">
        <tr><th>Qty On Hand</th><td>${escapeHtml(String(s.qtyOnHand ?? ''))}</td></tr>
        <tr><th>Qty On Order (outstanding POs)</th><td>${s.qtyOnOrder}</td></tr>
        <tr><th>Qty Allocated (outstanding SOs)</th><td>${s.qtyAllocated}</td></tr>
        <tr><th>Re-order Qty</th><td>${escapeHtml(String(s.reorderQty ?? ''))}</td></tr>
        <tr><th>Projected On Hand</th><td>${(Number(s.qtyOnHand)||0) + (Number(s.qtyOnOrder)||0) - (Number(s.qtyAllocated)||0)}</td></tr>
      </table>`;
    }

    case 'stocktake': {
      const s = d.stocktake;
      return `
        ${s.latest ? `<div class="callout">Latest stocktake: <strong>${s.latest.qty}</strong> on ${fmtDate(s.latest.date)}</div>` : ''}
        <h4 style="margin-top:16px">Stock Movement History</h4>
        ${gridOrEmpty(s.history, ['Date', 'Quantity'], r => [fmtDate(r.date), r.qty])}
        <h4 style="margin-top:24px">Serial Numbers</h4>
        ${gridOrEmpty(d.serialNumbers, ['Date', 'Notes'], r => [fmtDate(r.date), r.notes])}
      `;
    }

    case 'allSalesPurchases':
      return `<div class="split-grids">
        <div>
          <h4>ALL Sales Orders</h4>
          ${gridOrEmpty(d.allSales, ['SO #', 'Quote Date', 'Sale Date', 'Customer', 'Qty', 'Price'],
            r => [r.soNumber, fmtDate(r.quoteDate), fmtDate(r.saleDate), r.customerName, r.qty, fmtMoney(r.price)])}
        </div>
        <div>
          <h4>ALL Purchase Orders</h4>
          ${gridOrEmpty(d.allPurchases, ['PO #', 'PO Date', 'Received Date', 'Supplier', 'Qty', 'Price'],
            r => [r.poNumber, fmtDate(r.poDate), fmtDate(r.receivedDate), r.supplierName, r.qty, fmtMoney(r.price)])}
        </div>
      </div>`;

    case 'documents':
      if (!d.documents.length) return '<div class="empty-state">No documents linked to this item.</div>';
      return `<table><thead><tr><th>Doc #</th><th>Alt Ref</th><th>Description</th><th>Directory</th><th>Obsolete</th></tr></thead><tbody>${
        d.documents.map(doc => `<tr>
          <td>${escapeHtml(String(doc.docNumber ?? ''))}</td>
          <td>${escapeHtml(doc.altRef ?? '')}</td>
          <td>${escapeHtml(doc.shortDesc ?? '')}</td>
          <td>${escapeHtml(doc.directory ?? '')}</td>
          <td>${doc.obsolete ? '<span class="bool-yes">Yes</span>' : '<span class="bool-no">No</span>'}</td>
        </tr>`).join('')
      }</tbody></table>`;

    default:
      return '';
  }
}

function gridOrEmpty(rows, headers, rowFn, rowClass) {
  if (!rows || !rows.length) return '<div class="empty-state">None.</div>';
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r => `<tr class="${rowClass || ''}">${rowFn(r).map(v => `<td>${escapeHtml(v === null || v === undefined ? '' : String(v))}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;
}

$('#modal-close').addEventListener('click', closeModal);
$('#modal-cancel').addEventListener('click', closeModal);
$('#modal-save').addEventListener('click', e => { e.preventDefault(); saveRow(); });
$('#modal-backdrop').addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });

// ---------------------------------------------------------------------
// Shared helpers for the Sales/Purchase Order full-screen editors
// ---------------------------------------------------------------------
let ITEMS_CACHE = null;
async function getItemsCache() {
  if (ITEMS_CACHE) return ITEMS_CACHE;
  const res = await fetch('/api/items');
  ITEMS_CACHE = await res.json();
  return ITEMS_CACHE;
}
function findItemByPartNumber(items, partNumberStr) {
  return items.find(i => String(i.T11_01_Part_Number) === String(partNumberStr).trim());
}

async function getContactOptions(flag) {
  return getFkOptions('contacts', flag);
}
async function getOptionsFor(table) {
  return getFkOptions(table);
}

function dateInput(id, value) {
  return `<input type="date" id="${id}" class="big-date-input" value="${value ? escapeHtml(String(value)) : ''}" />`;
}

// ---------------------------------------------------------------------
// SALES ORDER full screen
// ---------------------------------------------------------------------
let SO_STATE = null; // { so, billTo, shipTo, lines, id }
let SO_NAV_IDS = null;

async function getSalesOrderNavIds() {
  if (SO_NAV_IDS) return SO_NAV_IDS;
  const res = await fetch('/api/salesOrders');
  const rows = await res.json();
  rows.sort((a, b) => (a.T14_01_SO_Number || 0) - (b.T14_01_SO_Number || 0));
  SO_NAV_IDS = rows.map(r => r.T14_SO_PK);
  return SO_NAV_IDS;
}

async function openSalesOrderScreen(id) {
  SPECIAL_SCREEN_ACTIVE = true;
  content.innerHTML = '<div class="empty-state">Loading…</div>';
  entityTitle.textContent = 'Sales Order';
  addBtn.style.display = 'none';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const res = await fetch(`/api/sales-orders/${encodeURIComponent(id)}/full`);
  const data = await res.json();
  SO_STATE = { id: id === 'new' ? null : id, so: data.so || {}, billTo: data.billTo, shipTo: data.shipTo, lines: data.lines || [], fulfillment: data.fulfillment || {}, tab: 'bill', fulTab: 'stock' };
  await getItemsCache();
  await getSalesOrderNavIds();
  renderSalesOrderScreen();
}

function renderSalesOrderScreen() {
  const s = SO_STATE;
  const so = s.so;
  content.innerHTML = `
    <div class="order-screen">
      <div class="order-toolbar">
        ${s.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/quote-simple/${s.id}','_blank')">Print Quote (Simple)</button>` : ''}
        ${s.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/quote-extended/${s.id}','_blank')">Print Quote (Extended)</button>` : ''}
        ${s.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/sales-order/${s.id}','_blank')">Print Invoice</button>` : ''}
        ${s.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/commercial-invoice/${s.id}','_blank')">Commercial Invoice</button>` : ''}
        ${s.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/delivery-note/${s.id}','_blank')">Delivery Note</button>` : ''}
        <span class="spacer"></span>
        ${s.id ? `<button class="btn btn-ghost" onclick="navSalesOrder(-1)">&larr; Previous</button>` : ''}
        ${s.id ? `<button class="btn btn-ghost" onclick="navSalesOrder(1)">Next &rarr;</button>` : ''}
        <button class="btn btn-ghost" onclick="openSalesOrderScreen('new')">+ New Record</button>
        <button class="btn btn-ghost" onclick="selectEntity('salesOrders')">Close</button>
      </div>

      <div class="order-grid">
        <div class="order-left">
          <div class="field"><label>SO Number</label><input disabled value="${so.T14_01_SO_Number ?? '(New)'}" /></div>
          <div class="field"><label>Salesperson</label><select id="so_employee"></select></div>
          <div class="field"><label>Customer PO Number</label><input id="so_custpo" value="${escapeHtml(so.T14_11_Cust_PO_Number ?? '')}" /></div>
          <div class="field"><label>Currency</label><select id="so_currency"></select></div>
          <div class="field"><label>Currency Conversion Rate</label><input id="so_convrate" type="number" step="any" value="${so.T14_15_Conversion_Rate || 1}" /></div>

          <div class="tabs" style="margin-top:10px">
            <button class="tab-btn ${s.tab === 'bill' ? 'active' : ''}" onclick="switchSoTab('bill')">Bill To Details</button>
            <button class="tab-btn ${s.tab === 'ship' ? 'active' : ''}" onclick="switchSoTab('ship')">Ship To Details</button>
          </div>
          <div class="tab-panel">
            ${s.tab === 'bill' ? renderSoContactPanel('bill') : renderSoContactPanel('ship')}
          </div>
        </div>

        <div class="order-right">
          <div class="two-col">
            <div class="field"><label>Enquiry Date</label>${dateInput('so_enquiry', so.T14_02_Enquiry_Date)}</div>
            <div class="field"><label>Despatch Due Date</label>${dateInput('so_despduedate', so.T14_14_Despatch_Due_Date)}</div>
            <div class="field"><label>Quote Date</label>${dateInput('so_quotedate', so.T14_03_Quote_Date)}</div>
            <div class="field"><label>Actual Despatch Date</label>${dateInput('so_despdate', so.T14_05_Despatch_Date)}</div>
            <div class="field"><label>Forecast Date</label>${dateInput('so_forecast', so.T14_09_Forecast_Date)}</div>
            <div class="field"><label>Invoice Date</label>${dateInput('so_invoicedate', so.T14_06_Invoice_Date)}</div>
            <div class="field"><label>Date Quote Lost</label>${dateInput('so_quotelost', so.T14_08_Quote_Lost_Date)}</div>
            <div class="field"><label>Payment Due Date</label>${dateInput('so_paymentdue', so.T14_07_Payment_Due_Date)}</div>
            <div class="field"><label>Sale Date</label>${dateInput('so_saledate', so.T14_04_Sale_Date)}</div>
            <div class="field"><label>Date Paid</label>${dateInput('so_datepaid', so['T14_13_Payment Received'])}</div>
          </div>
          <div class="field"><label>Courier</label><select id="so_courier"></select></div>
          <div class="field"><label>Conn Note</label><input id="so_connnote" value="${escapeHtml(so.T14_12_Conn_Note ?? '')}" /></div>
          <div class="field"><label>Project Notes</label><textarea id="so_notes">${escapeHtml(so.T14_10_SO_Notes ?? '')}</textarea></div>
        </div>
      </div>

      <div class="line-items">
        <table>
          <thead><tr><th>Item Code</th><th>Description</th><th>Quantity</th><th>Unit Price</th><th>Total Price</th><th></th></tr></thead>
          <tbody id="so_lines_body"></tbody>
        </table>
        <div class="line-items-footer">
          <button class="btn btn-ghost" onclick="addSoLine()">+ Add Line</button>
          <div class="order-total-display">Order Total: <span id="so_order_total">0.00</span></div>
        </div>
      </div>

      ${renderFulfillmentSection()}

      <div class="order-save-bar">
        <button class="btn btn-primary" onclick="saveSalesOrder()">Save Sales Order</button>
      </div>
    </div>
  `;
  populateSoDropdowns();
  renderSoLines();
}

const SO_STATUS_OPTIONS = ['Quote', 'PO Received', 'SO Confirmed', 'Proforma Sent', 'Payment Received', 'Stock Check', 'Allocated', 'Packed', 'Shipped', 'Delivered', 'Closed'];
const FUL_TABS = [
  { key: 'stock', label: 'Stock & Proforma' },
  { key: 'documents', label: 'Documents' },
];

function renderFulfillmentSection() {
  const f = SO_STATE.fulfillment || {};
  return `
    <div class="fulfillment-section">
      <div class="fulfillment-header">
        <h3>Order Fulfillment</h3>
        <div class="field" style="max-width:220px">
          <label>Status</label>
          <select id="ful_status">${SO_STATUS_OPTIONS.map(s => `<option value="${s}" ${f.T25_01_Status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
      </div>
      <div class="tabs">
        ${FUL_TABS.map(t => `<button class="tab-btn ${SO_STATE.fulTab === t.key ? 'active' : ''}" onclick="switchFulTab('${t.key}')">${t.label}</button>`).join('')}
      </div>
      <div class="tab-panel">${renderFulTabContent()}</div>
    </div>
  `;
}

function switchFulTab(key) {
  // preserve unsaved field values before switching
  SO_STATE.fulfillment = collectFulfillmentValues();
  SO_STATE.fulTab = key;
  renderSalesOrderScreen();
}

function renderFulTabContent() {
  const f = SO_STATE.fulfillment || {};
  const chk = (id, checked) => `<input type="checkbox" id="${id}" ${checked ? 'checked' : ''} />`;
  switch (SO_STATE.fulTab) {
    case 'stock':
      return `
        <div class="two-col">
          <div class="field"><label>Stock Check Status</label>
            <select id="ful_stockstatus">
              <option value="">— not checked —</option>
              <option value="In Stock - Allocated" ${f.T25_02_StockCheckStatus === 'In Stock - Allocated' ? 'selected' : ''}>In Stock - Allocated</option>
              <option value="Insufficient - Factory PO Raised" ${f.T25_02_StockCheckStatus === 'Insufficient - Factory PO Raised' ? 'selected' : ''}>Insufficient - Factory PO Raised</option>
            </select>
          </div>
          <div class="field"><label>Allocated Date</label>${dateInput('ful_allocateddate', f.T25_04_AllocatedDate)}</div>
          <div class="field"><label>Factory PO Reference</label><input id="ful_factorypo" value="${escapeHtml(f.T25_03_FactoryPO_Ref ?? '')}" /></div>
        </div>
        <div class="two-col" style="margin-top:8px">
          <div class="field field-checkbox">${chk('ful_proformaissued', f.T25_05_ProformaIssued)}<label for="ful_proformaissued">Proforma Issued</label></div>
          <div class="field"><label>Proforma Date</label>${dateInput('ful_proformadate', f.T25_06_ProformaDate)}</div>
          <div class="field field-checkbox">${chk('ful_advancerequired', f.T25_07_AdvancePaymentRequired)}<label for="ful_advancerequired">Advance Payment Required</label></div>
          <div class="field"><label>Advance Payment Amount</label><input type="number" step="any" id="ful_advanceamount" value="${f.T25_08_AdvancePaymentAmount ?? ''}" /></div>
          <div class="field"><label>Advance Payment Date</label>${dateInput('ful_advancedate', f.T25_09_AdvancePaymentDate)}</div>
          <div class="field field-checkbox">${chk('ful_receiptissued', f.T25_10_PaymentReceiptIssued)}<label for="ful_receiptissued">Payment Receipt Issued</label></div>
        </div>
      `;
    case 'documents':
      return `
        <div class="doc-print-links">
          <h4>Documents for this Sales Order</h4>
          <div class="doc-print-links-row">
            ${SO_STATE.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/commercial-invoice/${SO_STATE.id}','_blank')">Commercial Invoice</button>` : '<span class="empty-notice-inline">Save the order first to enable printing</span>'}
            ${SO_STATE.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/packing-list-so/${SO_STATE.id}','_blank')">Packing List</button>` : ''}
            ${SO_STATE.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/delivery-note/${SO_STATE.id}','_blank')">Delivery Note</button>` : ''}
            ${SO_STATE.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/sales-order/${SO_STATE.id}','_blank')">Invoice</button>` : ''}
          </div>
        </div>
        <h4 style="margin-top:20px">Warranty</h4>
        <div class="two-col">
          <div class="field"><label>Warranty Duration</label><input id="ful_warrantyduration" placeholder="e.g. 12 months" value="${escapeHtml(f.T25_27_Warranty_Duration ?? '')}" /></div>
          <div class="field"><label>Warranty Start Date</label>${dateInput('ful_warrantystart', f.T25_28_Warranty_Start)}</div>
          <div class="field"><label>Warranty End Date</label>${dateInput('ful_warrantyend', f.T25_29_Warranty_End)}</div>
        </div>
        <h4 style="margin-top:20px">Packing & Shipping</h4>
        <div class="two-col">
          <div class="field"><label>HS Code</label><input id="ful_hscode" value="${escapeHtml(f.T25_11_HSCode ?? '')}" /></div>
          <div class="field"><label>Dimensions</label><input id="ful_dimensions" placeholder="e.g. 40x30x20 cm" value="${escapeHtml(f.T25_12_Dimensions ?? '')}" /></div>
          <div class="field"><label>Weight (kg)</label><input type="number" step="any" id="ful_weight" value="${f.T25_13_WeightKg ?? ''}" /></div>
          <div class="field"><label>Packed Date</label>${dateInput('ful_packeddate', f.T25_14_PackedDate)}</div>
        </div>
        <div class="two-col" style="margin-top:8px">
          <div class="field field-checkbox">${chk('ful_civoice', f.T25_15_CommercialInvoiceIssued)}<label for="ful_civoice">Commercial Invoice Issued</label></div>
          <div class="field field-checkbox">${chk('ful_packinglist', f.T25_16_PackingListIssued)}<label for="ful_packinglist">Packing List Issued</label></div>
          <div class="field field-checkbox">${chk('ful_deliverynote', f.T25_17_DeliveryNoteIssued)}<label for="ful_deliverynote">Delivery Note Issued</label></div>
        </div>
        <div class="two-col" style="margin-top:8px">
          <div class="field"><label>Shipping Arranged By</label>
            <select id="ful_arrangedby">
              <option value="">— not set —</option>
              <option value="Customer" ${f.T25_18_ShippingArrangedBy === 'Customer' ? 'selected' : ''}>Customer</option>
              <option value="Supplier" ${f.T25_18_ShippingArrangedBy === 'Supplier' ? 'selected' : ''}>Supplier</option>
            </select>
          </div>
          <div class="field"><label>Forwarder / Courier Name</label><input id="ful_forwarder" value="${escapeHtml(f.T25_19_ForwarderName ?? '')}" /></div>
          <div class="field"><label>Shipping Charges</label>
            <select id="ful_chargesto">
              <option value="">— not set —</option>
              <option value="Included in Invoice" ${f.T25_20_ShippingChargesTo === 'Included in Invoice' ? 'selected' : ''}>Included in Invoice</option>
              <option value="Charged Separately" ${f.T25_20_ShippingChargesTo === 'Charged Separately' ? 'selected' : ''}>Charged Separately</option>
            </select>
          </div>
        </div>
        <h4 style="margin-top:20px">Tracking & Delivery</h4>
        <div class="two-col">
          <div class="field"><label>Tracking Type</label>
            <select id="ful_trackingtype">
              <option value="">— not set —</option>
              <option value="Airway Bill" ${f.T25_21_TrackingType === 'Airway Bill' ? 'selected' : ''}>Airway Bill</option>
              <option value="Bill of Lading" ${f.T25_21_TrackingType === 'Bill of Lading' ? 'selected' : ''}>Bill of Lading</option>
              <option value="Courier Tracking" ${f.T25_21_TrackingType === 'Courier Tracking' ? 'selected' : ''}>Courier Tracking</option>
            </select>
          </div>
          <div class="field"><label>Tracking Number</label><input id="ful_trackingnumber" value="${escapeHtml(f.T25_22_TrackingNumber ?? '')}" /></div>
          <div class="field"><label>Shipped Date</label>${dateInput('ful_shippeddate', f.T25_23_ShippedDate)}</div>
        </div>
        <div class="two-col" style="margin-top:8px">
          <div class="field field-checkbox">${chk('ful_notesigned', f.T25_24_DeliveryNoteSigned)}<label for="ful_notesigned">Delivery Note Signed</label></div>
          <div class="field"><label>Delivery Confirmed Date</label>${dateInput('ful_deliveredconfirmed', f.T25_25_DeliveryConfirmedDate)}</div>
        </div>
        <div class="field" style="margin-top:8px"><label>Discrepancies / Notes</label><textarea id="ful_discrepancies">${escapeHtml(f.T25_26_Discrepancies ?? '')}</textarea></div>
      `;
    default: return '';
  }
}

function collectFulfillmentValues() {
  const cur = SO_STATE.fulfillment || {};
  const val = (id) => document.getElementById(id)?.value;
  const chk = (id) => document.getElementById(id)?.checked;
  const merged = { ...cur };
  if (document.getElementById('ful_status')) merged.T25_01_Status = val('ful_status');
  if (SO_STATE.fulTab === 'stock') {
    merged.T25_02_StockCheckStatus = val('ful_stockstatus');
    merged.T25_04_AllocatedDate = val('ful_allocateddate');
    merged.T25_03_FactoryPO_Ref = val('ful_factorypo');
    merged.T25_05_ProformaIssued = chk('ful_proformaissued');
    merged.T25_06_ProformaDate = val('ful_proformadate');
    merged.T25_07_AdvancePaymentRequired = chk('ful_advancerequired');
    merged.T25_08_AdvancePaymentAmount = val('ful_advanceamount');
    merged.T25_09_AdvancePaymentDate = val('ful_advancedate');
    merged.T25_10_PaymentReceiptIssued = chk('ful_receiptissued');
  } else if (SO_STATE.fulTab === 'documents') {
    merged.T25_11_HSCode = val('ful_hscode');
    merged.T25_12_Dimensions = val('ful_dimensions');
    merged.T25_13_WeightKg = val('ful_weight');
    merged.T25_14_PackedDate = val('ful_packeddate');
    merged.T25_15_CommercialInvoiceIssued = chk('ful_civoice');
    merged.T25_16_PackingListIssued = chk('ful_packinglist');
    merged.T25_17_DeliveryNoteIssued = chk('ful_deliverynote');
    merged.T25_18_ShippingArrangedBy = val('ful_arrangedby');
    merged.T25_19_ForwarderName = val('ful_forwarder');
    merged.T25_20_ShippingChargesTo = val('ful_chargesto');
    merged.T25_21_TrackingType = val('ful_trackingtype');
    merged.T25_22_TrackingNumber = val('ful_trackingnumber');
    merged.T25_23_ShippedDate = val('ful_shippeddate');
    merged.T25_24_DeliveryNoteSigned = chk('ful_notesigned');
    merged.T25_25_DeliveryConfirmedDate = val('ful_deliveredconfirmed');
    merged.T25_26_Discrepancies = val('ful_discrepancies');
    merged.T25_27_Warranty_Duration = val('ful_warrantyduration');
    merged.T25_28_Warranty_Start = val('ful_warrantystart');
    merged.T25_29_Warranty_End = val('ful_warrantyend');
  }
  return merged;
}

async function populateSoDropdowns() {
  const so = SO_STATE.so;
  const employees = await getOptionsFor('employees');
  const currencies = await getOptionsFor('currency');
  const couriers = await getOptionsFor('couriers');
  fillSelect('so_employee', employees, so.T05_Employee_PK);
  fillSelect('so_currency', currencies, so.T22_Currency_ID);
  fillSelect('so_courier', couriers, so.T13_PK, true);
}
function fillSelect(id, opts, selected, allowNone) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (allowNone ? '<option value="">— none —</option>' : '') +
    opts.map(o => `<option value="${o.id}" ${String(selected) === String(o.id) ? 'selected' : ''}>${escapeHtml(String(o.label))}</option>`).join('');
}

function switchSoTab(tab) {
  SO_STATE.tab = tab;
  renderSalesOrderScreen();
}

function renderSoContactPanel(which) {
  const c = which === 'bill' ? SO_STATE.billTo : SO_STATE.shipTo;
  const selectId = which === 'bill' ? 'so_customer' : 'so_shipto';
  return `
    <div class="field"><label>Customer</label><select id="${selectId}"></select></div>
    <div class="contact-meta">
      <div><strong>Phone</strong> ${escapeHtml(c?.phone || '—')}</div>
      <div><strong>Fax</strong> ${escapeHtml(c?.fax || '—')}</div>
      <div><strong>Company</strong> ${escapeHtml(c?.companyName || '—')}</div>
    </div>
    ${c ? `<button class="btn btn-ghost" style="margin-top:10px" onclick="alert('Open Contact Record: ${escapeHtml(c.name)} (wire this to a contact detail view when built)')">Open Contact Record</button>` : ''}
  `;
}

// populate the customer/ship-to selects once panel is in the DOM
const _soContactObserver = new MutationObserver(async () => {
  const so = SO_STATE?.so;
  if (!so) return;
  if (document.getElementById('so_customer') && !document.getElementById('so_customer').dataset.filled) {
    const opts = await getContactOptions('customer');
    fillSelect('so_customer', opts, so.T07_PK);
    document.getElementById('so_customer').dataset.filled = '1';
  }
  if (document.getElementById('so_shipto') && !document.getElementById('so_shipto').dataset.filled) {
    const opts = await getContactOptions();
    fillSelect('so_shipto', opts, so.T07_PK_SHIPTO, true);
    document.getElementById('so_shipto').dataset.filled = '1';
  }
});
_soContactObserver.observe(document.body, { childList: true, subtree: true });

function renderSoLines() {
  const body = $('#so_lines_body');
  if (!body) return;
  body.innerHTML = SO_STATE.lines.map((l, idx) => `
    <tr>
      <td><input list="items-datalist" value="${escapeHtml(String(l.partNumber ?? ''))}" onchange="onSoLinePartChange(${idx}, this.value)" style="width:90px" /></td>
      <td><input value="${escapeHtml(l.description || '')}" style="width:140px" onchange="onSoLineField(${idx}, 'description', this.value)" /></td>
      <td><input type="number" step="any" value="${l.T15_01_Quantity || ''}" style="width:70px" onchange="onSoLineField(${idx}, 'T15_01_Quantity', this.value)" /></td>
      <td><input type="number" step="any" value="${l.T15_02_Price || ''}" style="width:90px" onchange="onSoLineField(${idx}, 'T15_02_Price', this.value)" /></td>
      <td class="num">${fmtMoney((Number(l.T15_01_Quantity)||0) * (Number(l.T15_02_Price)||0))}</td>
      <td><button class="btn-danger" onclick="removeSoLine(${idx})">&times;</button></td>
    </tr>
  `).join('') + `<datalist id="items-datalist">${ITEMS_CACHE.map(i => `<option value="${escapeHtml(String(i.T11_01_Part_Number ?? ''))}">${escapeHtml(i.T11_03_Short_Description || '')}</option>`).join('')}</datalist>`;
  const orderTotalEl = $('#so_order_total');
  if (orderTotalEl) {
    const total = SO_STATE.lines.reduce((s, l) => s + (Number(l.T15_01_Quantity)||0) * (Number(l.T15_02_Price)||0), 0);
    orderTotalEl.textContent = fmtMoney(total);
  }
}

function onSoLinePartChange(idx, partNumberStr) {
  const item = findItemByPartNumber(ITEMS_CACHE, partNumberStr);
  if (!item) return;
  SO_STATE.lines[idx] = {
    ...SO_STATE.lines[idx],
    T11_Item_Master_PK: item.T11_Item_Master_PK,
    partNumber: item.T11_01_Part_Number,
    description: item.T11_03_Short_Description,
    retail: item.T11_09_List_Price, trade: item.T11_10_Trade_Price, oem: item.T11_11_OEM_Price,
    T15_02_Price: SO_STATE.lines[idx].T15_02_Price || item.T11_09_List_Price || 0,
  };
  renderSoLines();
}
function onSoLineField(idx, field, value) {
  SO_STATE.lines[idx][field] = value;
  renderSoLines();
}
function addSoLine() {
  SO_STATE.lines.push({ T11_Item_Master_PK: null, T15_01_Quantity: 1, T15_02_Price: 0 });
  renderSoLines();
}
function removeSoLine(idx) {
  SO_STATE.lines.splice(idx, 1);
  renderSoLines();
}

async function navSalesOrder(dir) {
  const ids = await getSalesOrderNavIds();
  const pos = ids.indexOf(SO_STATE.id);
  const next = ids[pos + dir];
  if (next) openSalesOrderScreen(next);
}

async function saveSalesOrder() {
  const so = {
    T05_Employee_PK: $('#so_employee').value || null,
    T07_PK: $('#so_customer') ? $('#so_customer').value || null : SO_STATE.so.T07_PK,
    T13_PK: $('#so_courier').value || null,
    T14_11_Cust_PO_Number: $('#so_custpo').value,
    T22_Currency_ID: $('#so_currency').value || null,
    T14_15_Conversion_Rate: $('#so_convrate').value,
    T14_02_Enquiry_Date: $('#so_enquiry').value,
    T14_03_Quote_Date: $('#so_quotedate').value,
    T14_04_Sale_Date: $('#so_saledate').value,
    T14_05_Despatch_Date: $('#so_despdate').value,
    T14_06_Invoice_Date: $('#so_invoicedate').value,
    T14_07_Payment_Due_Date: $('#so_paymentdue').value,
    T14_08_Quote_Lost_Date: $('#so_quotelost').value,
    T14_09_Forecast_Date: $('#so_forecast').value,
    T14_10_SO_Notes: $('#so_notes').value,
    T14_12_Conn_Note: $('#so_connnote').value,
    'T14_13_Payment Received': $('#so_datepaid').value,
    T14_14_Despatch_Due_Date: $('#so_despduedate').value,
    T07_PK_SHIPTO: $('#so_shipto') ? $('#so_shipto').value || null : SO_STATE.so.T07_PK_SHIPTO,
    T21_Project_ID: SO_STATE.so.T21_Project_ID || null,
  };
  const url = SO_STATE.id ? `/api/sales-orders/${SO_STATE.id}/full` : '/api/sales-orders/full';
  const method = SO_STATE.id ? 'PUT' : 'POST';
  const fulfillment = collectFulfillmentValues();
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ so, lines: SO_STATE.lines, fulfillment }) });
  if (!res.ok) { const err = await res.json().catch(() => ({})); alert('Error saving: ' + (err.error || res.statusText)); return; }
  const data = await res.json();
  SO_NAV_IDS = null;
  openSalesOrderScreen(data.so.T14_SO_PK);
}

// ---------------------------------------------------------------------
// PURCHASE ORDER full screen (mirrors Sales Order)
// ---------------------------------------------------------------------
let PO_STATE = null;
let PO_NAV_IDS = null;

async function getPurchaseOrderNavIds() {
  if (PO_NAV_IDS) return PO_NAV_IDS;
  const res = await fetch('/api/purchaseOrders');
  const rows = await res.json();
  rows.sort((a, b) => (a.T17_01_PO_Number || 0) - (b.T17_01_PO_Number || 0));
  PO_NAV_IDS = rows.map(r => r.T17_PO_PK);
  return PO_NAV_IDS;
}

async function openPurchaseOrderScreen(id) {
  SPECIAL_SCREEN_ACTIVE = true;
  content.innerHTML = '<div class="empty-state">Loading…</div>';
  entityTitle.textContent = 'Purchase Order';
  addBtn.style.display = 'none';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const res = await fetch(`/api/purchase-orders/${encodeURIComponent(id)}/full`);
  const data = await res.json();
  PO_STATE = { id: id === 'new' ? null : id, po: data.po || {}, supplier: data.supplier, lines: data.lines || [] };
  await getItemsCache();
  await getPurchaseOrderNavIds();
  renderPurchaseOrderScreen();
}

function renderPurchaseOrderScreen() {
  const s = PO_STATE;
  const po = s.po;
  content.innerHTML = `
    <div class="order-screen">
      <div class="order-toolbar">
        ${s.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/purchase-order/${s.id}','_blank')">Print Purchase Order</button>` : ''}
        <span class="spacer"></span>
        ${s.id ? `<button class="btn btn-ghost" onclick="navPurchaseOrder(-1)">&larr; Previous</button>` : ''}
        ${s.id ? `<button class="btn btn-ghost" onclick="navPurchaseOrder(1)">Next &rarr;</button>` : ''}
        <button class="btn btn-ghost" onclick="openPurchaseOrderScreen('new')">+ New Record</button>
        <button class="btn btn-ghost" onclick="selectEntity('purchaseOrders')">Close</button>
      </div>

      <div class="order-grid">
        <div class="order-left">
          <div class="field"><label>PO Number</label><input disabled value="${po.T17_01_PO_Number ?? '(New)'}" /></div>
          <div class="field"><label>Raised By</label><select id="po_employee"></select></div>
          <div class="field"><label>Supplier</label><select id="po_supplier"></select></div>
          <div class="contact-meta">
            <div><strong>Phone</strong> ${escapeHtml(s.supplier?.phone || '—')}</div>
            <div><strong>Fax</strong> ${escapeHtml(s.supplier?.fax || '—')}</div>
            <div><strong>Company</strong> ${escapeHtml(s.supplier?.companyName || '—')}</div>
          </div>
          <div class="field"><label>Courier</label><select id="po_courier"></select></div>
        </div>
        <div class="order-right">
          <div class="two-col">
            <div class="field"><label>PO Date</label>${dateInput('po_date', po.T17_02_PO_Date)}</div>
            <div class="field"><label>Due Date</label>${dateInput('po_due', po.T17_04_Due_Date)}</div>
            <div class="field"><label>Received Date</label>${dateInput('po_received', po.T17_03_Received_Date)}</div>
            <div class="field"><label>Date Paid</label>${dateInput('po_paid', po.T17_06_Date_Paid)}</div>
          </div>
          <div class="field"><label>Notes</label><textarea id="po_notes">${escapeHtml(po.T17_05_Notes ?? '')}</textarea></div>
        </div>
      </div>

      <div class="line-items">
        <table>
          <thead><tr><th>Item Code</th><th>Description</th><th>Quantity</th><th>Cost</th><th>Unit Price</th><th>Total Price</th><th></th></tr></thead>
          <tbody id="po_lines_body"></tbody>
        </table>
        <div class="line-items-footer">
          <button class="btn btn-ghost" onclick="addPoLine()">+ Add Line</button>
          <div class="order-total-display">Order Total: <span id="po_order_total">0.00</span></div>
        </div>
      </div>

      <div class="order-save-bar">
        <button class="btn btn-primary" onclick="savePurchaseOrder()">Save Purchase Order</button>
      </div>
    </div>
  `;
  populatePoDropdowns();
  renderPoLines();
}

async function populatePoDropdowns() {
  const po = PO_STATE.po;
  const employees = await getOptionsFor('employees');
  const suppliers = await getContactOptions('supplier');
  const couriers = await getOptionsFor('couriers');
  fillSelect('po_employee', employees, po.T05_Employee_PK);
  fillSelect('po_supplier', suppliers, po.T07_PK);
  fillSelect('po_courier', couriers, po.T13_PK, true);
}

function renderPoLines() {
  const body = $('#po_lines_body');
  if (!body) return;
  body.innerHTML = PO_STATE.lines.map((l, idx) => `
    <tr>
      <td><input list="items-datalist" value="${escapeHtml(String(l.partNumber ?? ''))}" onchange="onPoLinePartChange(${idx}, this.value)" style="width:90px" /></td>
      <td><input value="${escapeHtml(l.description || '')}" style="width:140px" onchange="onPoLineField(${idx}, 'description', this.value)" /></td>
      <td><input type="number" step="any" value="${l.T18_01_Quantity || ''}" style="width:70px" onchange="onPoLineField(${idx}, 'T18_01_Quantity', this.value)" /></td>
      <td><input type="number" step="any" value="${l.cost ?? ''}" style="width:80px" onchange="onPoLineField(${idx}, 'cost', this.value)" /></td>
      <td><input type="number" step="any" value="${l.T18_02_Price || ''}" style="width:90px" onchange="onPoLineField(${idx}, 'T18_02_Price', this.value)" /></td>
      <td class="num">${fmtMoney((Number(l.T18_01_Quantity)||0) * (Number(l.T18_02_Price)||0))}</td>
      <td><button class="btn-danger" onclick="removePoLine(${idx})">&times;</button></td>
    </tr>
  `).join('') + `<datalist id="items-datalist">${ITEMS_CACHE.map(i => `<option value="${escapeHtml(String(i.T11_01_Part_Number ?? ''))}">${escapeHtml(i.T11_03_Short_Description || '')}</option>`).join('')}</datalist>`;
  const orderTotalEl = $('#po_order_total');
  if (orderTotalEl) {
    const total = PO_STATE.lines.reduce((s, l) => s + (Number(l.T18_01_Quantity)||0) * (Number(l.T18_02_Price)||0), 0);
    orderTotalEl.textContent = fmtMoney(total);
  }
}

function onPoLinePartChange(idx, partNumberStr) {
  const item = findItemByPartNumber(ITEMS_CACHE, partNumberStr);
  if (!item) return;
  PO_STATE.lines[idx] = {
    ...PO_STATE.lines[idx],
    T11_Item_Master_PK: item.T11_Item_Master_PK,
    partNumber: item.T11_01_Part_Number,
    description: item.T11_03_Short_Description,
    cost: item.T11_53_COST,
    T18_02_Price: PO_STATE.lines[idx].T18_02_Price || item.T11_53_COST || 0,
  };
  renderPoLines();
}
function onPoLineField(idx, field, value) {
  PO_STATE.lines[idx][field] = value;
  renderPoLines();
}
function addPoLine() {
  PO_STATE.lines.push({ T11_Item_Master_PK: null, T18_01_Quantity: 1, T18_02_Price: 0 });
  renderPoLines();
}
function removePoLine(idx) {
  PO_STATE.lines.splice(idx, 1);
  renderPoLines();
}

async function navPurchaseOrder(dir) {
  const ids = await getPurchaseOrderNavIds();
  const pos = ids.indexOf(PO_STATE.id);
  const next = ids[pos + dir];
  if (next) openPurchaseOrderScreen(next);
}

async function savePurchaseOrder() {
  const po = {
    T05_Employee_PK: $('#po_employee').value || null,
    T07_PK: $('#po_supplier').value || null,
    T13_PK: $('#po_courier').value || null,
    T17_02_PO_Date: $('#po_date').value,
    T17_04_Due_Date: $('#po_due').value,
    T17_03_Received_Date: $('#po_received').value,
    T17_06_Date_Paid: $('#po_paid').value,
    T17_05_Notes: $('#po_notes').value,
    T21_Project_ID: PO_STATE.po.T21_Project_ID || null,
  };
  const url = PO_STATE.id ? `/api/purchase-orders/${PO_STATE.id}/full` : '/api/purchase-orders/full';
  const method = PO_STATE.id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ po, lines: PO_STATE.lines }) });
  if (!res.ok) { const err = await res.json().catch(() => ({})); alert('Error saving: ' + (err.error || res.statusText)); return; }
  const data = await res.json();
  PO_NAV_IDS = null;
  openPurchaseOrderScreen(data.po.T17_PO_PK);
}

init();

// ---------------------------------------------------------------------
// COMPANY full screen — header + City lookup + Contacts / Sales Activity
// / All Purchases tabs
// ---------------------------------------------------------------------
let COMPANY_STATE = null;
let COMPANY_NAV_IDS = null;

async function getCompanyNavIds() {
  if (COMPANY_NAV_IDS) return COMPANY_NAV_IDS;
  const res = await fetch('/api/companies');
  const rows = await res.json();
  rows.sort((a, b) => (a.T01_01_Company_Name || '').localeCompare(b.T01_01_Company_Name || ''));
  COMPANY_NAV_IDS = rows.map(r => r.T01_PK);
  return COMPANY_NAV_IDS;
}

async function openCompanyScreen(id) {
  SPECIAL_SCREEN_ACTIVE = true;
  content.innerHTML = '<div class="empty-state">Loading…</div>';
  entityTitle.textContent = 'Company';
  addBtn.style.display = 'none';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const res = await fetch(`/api/companies/${encodeURIComponent(id)}/full`);
  const data = await res.json();
  COMPANY_STATE = { id: id === 'new' ? null : id, company: data.company || {}, city: data.city, contacts: data.contacts || [], salesActivity: data.salesActivity || [], allPurchases: data.allPurchases || [], projects: data.projects || [], tab: 'contacts' };
  await getCompanyNavIds();
  renderCompanyScreen();
}

const COMPANY_TABS = [
  { key: 'contacts', label: 'Contacts' },
  { key: 'salesActivity', label: 'Sales Activity' },
  { key: 'allPurchases', label: 'All Purchases' },
  { key: 'projects', label: 'Projects' },
];

function renderCompanyScreen() {
  const s = COMPANY_STATE;
  const c = s.company;
  content.innerHTML = `
    <div class="order-screen">
      <div class="order-toolbar">
        ${s.id ? `<button class="btn btn-ghost" onclick="window.open('/reports/R27/${s.id}','_blank')">Print Phone List</button>` : ''}
        <span class="spacer"></span>
        ${s.id ? `<button class="btn btn-ghost" onclick="navCompany(-1)">&larr; Previous</button>` : ''}
        ${s.id ? `<button class="btn btn-ghost" onclick="navCompany(1)">Next &rarr;</button>` : ''}
        <button class="btn btn-ghost" onclick="openCompanyScreen('new')">+ New Record</button>
        <button class="btn btn-ghost" onclick="selectEntity('companies')">Close</button>
      </div>

      <div class="order-grid">
        <div class="order-left">
          <div class="field"><label>Company Name</label><input id="co_name" value="${escapeHtml(c.T01_01_Company_Name ?? '')}" /></div>
          <div class="field"><label>Street Address</label><textarea id="co_address">${escapeHtml(c.T01_02_Street_Address ?? '')}</textarea></div>
          <div class="field"><label>City</label><select id="co_city"></select></div>
          <div class="contact-meta">
            <div><strong>State</strong> ${escapeHtml(s.city?.T02_2_State ?? '—')}</div>
            <div><strong>Postcode</strong> ${escapeHtml(s.city?.T02_3_PCode ?? '—')}</div>
          </div>
        </div>
        <div class="order-right">
          <div class="field"><label>Switch Phone</label><input id="co_phone" value="${escapeHtml(c.T01_07_Switch_Phone ?? '')}" /></div>
          <div class="field"><label>Main Fax</label><input id="co_fax" value="${escapeHtml(c.T01_08_Main_Fax ?? '')}" /></div>
          <div class="field"><label>Web Site</label><input id="co_web" value="${escapeHtml(c.T01_06_Web_Site ?? '')}" /></div>
          <div class="field field-checkbox"><input type="checkbox" id="co_customer" ${c.T01_15_Customer ? 'checked' : ''} /><label for="co_customer">Customer?</label></div>
          <div class="field field-checkbox"><input type="checkbox" id="co_supplier" ${c.T01_16_Supplier ? 'checked' : ''} /><label for="co_supplier">Supplier?</label></div>
          <div class="field field-checkbox"><input type="checkbox" id="co_obsolete" ${c.T01_14_Obsolete ? 'checked' : ''} /><label for="co_obsolete">Obsolete?</label></div>
          <div class="field"><label>Company Notes</label><textarea id="co_notes" style="min-height:100px">${escapeHtml(c.T01_12_Notes ?? '')}</textarea></div>
        </div>
      </div>

      <div class="tabs">
        ${COMPANY_TABS.map(t => `<button class="tab-btn ${s.tab === t.key ? 'active' : ''}" onclick="switchCompanyTab('${t.key}')">${t.label}</button>`).join('')}
      </div>
      <div class="tab-panel">${renderCompanyTabContent()}</div>

      <div class="order-save-bar">
        <button class="btn btn-primary" onclick="saveCompany()">Save Company</button>
      </div>
    </div>
  `;
  getOptionsFor('cities').then(opts => fillSelect('co_city', opts, c.T02_City_PK, true));
}

function collectCompanyDraft() {
  const c = COMPANY_STATE.company;
  const val = (id) => document.getElementById(id)?.value;
  const chk = (id) => document.getElementById(id)?.checked;
  return {
    ...c,
    T01_01_Company_Name: val('co_name') ?? c.T01_01_Company_Name,
    T01_02_Street_Address: val('co_address') ?? c.T01_02_Street_Address,
    T02_City_PK: val('co_city') ?? c.T02_City_PK,
    T01_07_Switch_Phone: val('co_phone') ?? c.T01_07_Switch_Phone,
    T01_08_Main_Fax: val('co_fax') ?? c.T01_08_Main_Fax,
    T01_06_Web_Site: val('co_web') ?? c.T01_06_Web_Site,
    T01_15_Customer: document.getElementById('co_customer') ? chk('co_customer') : c.T01_15_Customer,
    T01_16_Supplier: document.getElementById('co_supplier') ? chk('co_supplier') : c.T01_16_Supplier,
    T01_14_Obsolete: document.getElementById('co_obsolete') ? chk('co_obsolete') : c.T01_14_Obsolete,
    T01_12_Notes: val('co_notes') ?? c.T01_12_Notes,
  };
}

function switchCompanyTab(key) {
  // Preserve whatever's currently typed in the header fields before
  // switching tabs, so it doesn't get wiped out by the re-render.
  COMPANY_STATE.company = collectCompanyDraft();
  COMPANY_STATE.tab = key;
  renderCompanyScreen();
}

function renderCompanyTabContent() {
  const s = COMPANY_STATE;
  switch (s.tab) {
    case 'contacts':
      if (!s.contacts.length) return '<div class="empty-state">No contacts on file.</div>';
      return `<table><thead><tr><th>Name</th><th>Title</th><th>Phone</th><th>Email</th></tr></thead><tbody>${
        s.contacts.map(c => `<tr><td>${escapeHtml([c.T07_01_Forename, c.T07_02_Surname].filter(Boolean).join(' '))}</td><td>${escapeHtml(c.T07_12_Title || '')}</td><td>${escapeHtml(c.T07_03_Phone || '')}</td><td>${escapeHtml(c.T07_05_Email || '')}</td></tr>`).join('')
      }</tbody></table>`;
    case 'salesActivity':
      return gridOrEmpty(s.salesActivity, ['SO No', 'Quote Date', 'Sale Date', 'Quantity', 'Description'],
        r => [r.soNo, fmtDate(r.quoteDate), fmtDate(r.saleDate), r.qty, r.description]);
    case 'allPurchases':
      return gridOrEmpty(s.allPurchases, ['PO No', 'PO Date', 'Received Date', 'Quantity', 'Description'],
        r => [r.poNo, fmtDate(r.poDate), fmtDate(r.receivedDate), r.qty, r.description]);
    case 'projects':
      return gridOrEmpty(s.projects, ['Project Code', 'Project Name', 'Notes'],
        r => [r.code, r.name, r.notes]);
    default: return '';
  }
}

async function navCompany(dir) {
  const ids = await getCompanyNavIds();
  const pos = ids.indexOf(COMPANY_STATE.id);
  const next = ids[pos + dir];
  if (next) openCompanyScreen(next);
}

async function saveCompany() {
  const body = {
    T01_01_Company_Name: $('#co_name').value,
    T01_02_Street_Address: $('#co_address').value,
    T02_City_PK: $('#co_city').value || null,
    T01_07_Switch_Phone: $('#co_phone').value,
    T01_08_Main_Fax: $('#co_fax').value,
    T01_06_Web_Site: $('#co_web').value,
    T01_15_Customer: $('#co_customer').checked,
    T01_16_Supplier: $('#co_supplier').checked,
    T01_14_Obsolete: $('#co_obsolete').checked,
    T01_12_Notes: $('#co_notes').value,
  };
  if (!body.T01_01_Company_Name) { alert('Please enter a Company Name'); return; }
  const url = COMPANY_STATE.id ? `/api/companies/${COMPANY_STATE.id}` : '/api/companies';
  const method = COMPANY_STATE.id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const err = await res.json().catch(() => ({})); alert('Error saving: ' + (err.error || res.statusText)); return; }
  const saved = await res.json();
  COMPANY_NAV_IDS = null;
  FK_OPTIONS_CACHE = {}; // company name may have changed — refresh any cached Customer/Supplier dropdowns
  openCompanyScreen(saved.T01_PK);
}
