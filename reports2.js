const { BASE_STYLE, page, escapeHtml, fmtDate, fmtMoney } = require('./reports');

function registerReports2(app, db) {

  function getYourCompany() {
    const yc = db.prepare(`SELECT * FROM "T04_Your_Company" LIMIT 1`).get();
    return yc || { T04_01_Your_Company_Name: 'Your Company' };
  }

  function letterhead() {
    const yc = getYourCompany();
    return `<div class="letterhead"><div><div class="company-name">${escapeHtml(yc.T04_01_Your_Company_Name || 'Your Company')}</div></div>`;
  }

  function reportHeader(title, subtitle) {
    return `${letterhead()}<div class="doc-title"><h1>${escapeHtml(title)}</h1>${subtitle ? `<div class="doc-number">${escapeHtml(subtitle)}</div>` : ''}</div></div>`;
  }

  function footer(count, label) {
    return `<div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()}${count !== undefined ? ` &middot; ${count} ${label || 'records'}` : ''}</div>`;
  }

  // ---------- shared fact builders ----------
  function getSalesFacts(dateField) {
    const rows = db.prepare(`SELECT * FROM "T14_Sales_Orders" WHERE "${dateField}" IS NOT NULL`).all();
    return rows.map(so => {
      const lines = db.prepare(`SELECT * FROM "T15_SO_Details" WHERE "T14_SO_PK" = ?`).all(so.T14_SO_PK);
      const amount = lines.reduce((s, l) => s + (Number(l.T15_01_Quantity) || 0) * (Number(l.T15_02_Price) || 0), 0);
      const contact = so.T07_PK ? db.prepare(`SELECT * FROM "T07_Contacts" WHERE "T07_PK" = ?`).get(so.T07_PK) : null;
      const company = contact && contact.T01_PK ? db.prepare(`SELECT * FROM "T01_Company" WHERE "T01_PK" = ?`).get(contact.T01_PK) : null;
      const employee = so.T05_Employee_PK ? db.prepare(`SELECT * FROM "T05_Employees" WHERE "T05_Employee_PK" = ?`).get(so.T05_Employee_PK) : null;
      return {
        soNumber: so.T14_01_SO_Number,
        date: so[dateField],
        companyName: company ? company.T01_01_Company_Name : 'Unknown',
        employeeName: employee ? [employee.T05_01_Forename, employee.T05_02_Surname].filter(Boolean).join(' ') : 'Unknown',
        amount,
        raw: so,
      };
    });
  }

  function getPurchaseFacts(dateField) {
    const rows = db.prepare(`SELECT * FROM "T17_Purchase_Orders" WHERE "${dateField}" IS NOT NULL`).all();
    return rows.map(po => {
      const lines = db.prepare(`SELECT * FROM "T18_PO_Details" WHERE "T17_PO_PK" = ?`).all(po.T17_PO_PK);
      const amount = lines.reduce((s, l) => s + (Number(l.T18_01_Quantity) || 0) * (Number(l.T18_02_Price) || 0), 0);
      const supplier = po.T07_PK ? db.prepare(`SELECT * FROM "T07_Contacts" WHERE "T07_PK" = ?`).get(po.T07_PK) : null;
      const company = supplier && supplier.T01_PK ? db.prepare(`SELECT * FROM "T01_Company" WHERE "T01_PK" = ?`).get(supplier.T01_PK) : null;
      const employee = po.T05_Employee_PK ? db.prepare(`SELECT * FROM "T05_Employees" WHERE "T05_Employee_PK" = ?`).get(po.T05_Employee_PK) : null;
      return {
        poNumber: po.T17_01_PO_Number,
        date: po[dateField],
        companyName: company ? company.T01_01_Company_Name : 'Unknown',
        employeeName: employee ? [employee.T05_01_Forename, employee.T05_02_Surname].filter(Boolean).join(' ') : 'Unknown',
        amount,
        raw: po,
      };
    });
  }

  function groupKey(fact, groupBy) {
    if (groupBy === 'company') return fact.companyName;
    if (groupBy === 'employee') return fact.employeeName;
    if (groupBy === 'month') return fact.date ? String(fact.date).slice(0, 7) : 'Unknown';
    return 'All';
  }

  // detail / summary / chart renderer shared by many rpt1xx/2xx reports
  function renderAggregate(facts, groupBy, mode, title, docLabel) {
    if (!facts.length) {
      return page(title, `${reportHeader(title)}<p class="empty-notice">No matching records found.</p>`);
    }
    if (mode === 'detail') {
      const sorted = [...facts].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      let rowsHtml = sorted.map(f => `<tr>
        <td>${escapeHtml(fmtDate(f.date))}</td>
        <td>${escapeHtml(f.companyName)}</td>
        <td>${escapeHtml(f.employeeName)}</td>
        <td>${escapeHtml(String(f.soNumber ?? f.poNumber ?? ''))}</td>
        <td class="num">${fmtMoney(f.amount)}</td>
      </tr>`).join('');
      const total = sorted.reduce((s, f) => s + f.amount, 0);
      return page(title, `${reportHeader(title)}
        <table class="items">
          <thead><tr><th>Date</th><th>Company</th><th>Employee</th><th>${docLabel} #</th><th class="num">Amount</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="totals"><table><tr class="grand"><td>Total</td><td>${fmtMoney(total)}</td></tr></table></div>
        ${footer(sorted.length, 'records')}
      `);
    }
    // summary or chart: group and total
    const groups = {};
    facts.forEach(f => {
      const k = groupKey(f, groupBy);
      groups[k] = (groups[k] || 0) + f.amount;
    });
    const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    const grandTotal = entries.reduce((s, [, v]) => s + v, 0);
    const maxVal = Math.max(...entries.map(([, v]) => v), 1);

    if (mode === 'chart') {
      let barsHtml = entries.map(([k, v]) => `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
            <span>${escapeHtml(k)}</span><span>${fmtMoney(v)}</span>
          </div>
          <div style="background:#eee;height:14px;border-radius:2px;overflow:hidden;">
            <div style="background:#1a1a1a;height:100%;width:${(v / maxVal * 100).toFixed(1)}%;"></div>
          </div>
        </div>`).join('');
      return page(title, `${reportHeader(title)}
        <div style="margin-top:20px;">${barsHtml}</div>
        <div class="totals"><table><tr class="grand"><td>Total</td><td>${fmtMoney(grandTotal)}</td></tr></table></div>
        ${footer(entries.length, 'groups')}
      `);
    }
    // summary table
    let rowsHtml = entries.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="num">${fmtMoney(v)}</td><td class="num">${grandTotal ? (v / grandTotal * 100).toFixed(1) : '0.0'}%</td></tr>`).join('');
    return page(title, `${reportHeader(title)}
      <table class="items">
        <thead><tr><th>${groupBy[0].toUpperCase() + groupBy.slice(1)}</th><th class="num">Total</th><th class="num">% of Total</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="totals"><table><tr class="grand"><td>Grand Total</td><td>${fmtMoney(grandTotal)}</td></tr></table></div>
      ${footer(entries.length, 'groups')}
    `);
  }

  function salesPurchaseRoute(path, kind, dateField, groupBy, mode, title, docLabel) {
    app.get(path, (req, res) => {
      const facts = kind === 'sales' ? getSalesFacts(dateField) : getPurchaseFacts(dateField);
      res.send(renderAggregate(facts, groupBy, mode, title, docLabel));
    });
  }

  // ===== Quote analytics (rpt101-109, rpt121) =====
  salesPurchaseRoute('/reports/rpt101', 'sales', 'T14_03_Quote_Date', 'company', 'detail', 'Quote Detail by Company', 'SO');
  salesPurchaseRoute('/reports/rpt102', 'sales', 'T14_03_Quote_Date', 'company', 'summary', 'Quote Summary by Company', 'SO');
  salesPurchaseRoute('/reports/rpt103', 'sales', 'T14_03_Quote_Date', 'company', 'chart', 'Quotes by Company', 'SO');
  salesPurchaseRoute('/reports/rpt104', 'sales', 'T14_03_Quote_Date', 'employee', 'detail', 'Quote Detail by Employee', 'SO');
  salesPurchaseRoute('/reports/rpt105', 'sales', 'T14_03_Quote_Date', 'employee', 'summary', 'Quote Summary by Employee', 'SO');
  salesPurchaseRoute('/reports/rpt106', 'sales', 'T14_03_Quote_Date', 'employee', 'chart', 'Quotes by Employee', 'SO');
  salesPurchaseRoute('/reports/rpt107', 'sales', 'T14_03_Quote_Date', 'month', 'detail', 'Quote Detail by Month', 'SO');
  salesPurchaseRoute('/reports/rpt108', 'sales', 'T14_03_Quote_Date', 'month', 'summary', 'Quote Summary by Month', 'SO');
  salesPurchaseRoute('/reports/rpt109', 'sales', 'T14_03_Quote_Date', 'month', 'chart', 'Quotes by Month', 'SO');

  app.get('/reports/rpt121', (req, res) => {
    const facts = getSalesFacts('T14_03_Quote_Date').filter(f => !f.raw.T14_04_Sale_Date && !f.raw.T14_08_Quote_Lost_Date);
    res.send(renderAggregate(facts, 'company', 'detail', 'Open Quotes', 'SO'));
  });

  // ===== Sales analytics (rpt201-209) =====
  salesPurchaseRoute('/reports/rpt201', 'sales', 'T14_04_Sale_Date', 'company', 'detail', 'Sales Detail by Company', 'SO');
  salesPurchaseRoute('/reports/rpt202', 'sales', 'T14_04_Sale_Date', 'company', 'summary', 'Sales Summary by Company', 'SO');
  salesPurchaseRoute('/reports/rpt203', 'sales', 'T14_04_Sale_Date', 'company', 'chart', 'Sales by Company', 'SO');
  salesPurchaseRoute('/reports/rpt204', 'sales', 'T14_04_Sale_Date', 'employee', 'detail', 'Sales Detail by Employee', 'SO');
  salesPurchaseRoute('/reports/rpt205', 'sales', 'T14_04_Sale_Date', 'employee', 'summary', 'Sales Summary by Employee', 'SO');
  salesPurchaseRoute('/reports/rpt206', 'sales', 'T14_04_Sale_Date', 'employee', 'chart', 'Sales by Employee', 'SO');
  salesPurchaseRoute('/reports/rpt207', 'sales', 'T14_04_Sale_Date', 'month', 'detail', 'Sales Detail by Month', 'SO');
  salesPurchaseRoute('/reports/rpt208', 'sales', 'T14_04_Sale_Date', 'month', 'summary', 'Sales Summary by Month', 'SO');
  salesPurchaseRoute('/reports/rpt209', 'sales', 'T14_04_Sale_Date', 'month', 'chart', 'Sales by Month', 'SO');

  // ===== Forecast (rpt131-132) =====
  // Matches Q18_SO_Report_Forecast: quoted but not yet sold, with a forecast date set
  function getForecastFacts() {
    const rows = db.prepare(`
      SELECT * FROM "T14_Sales_Orders"
      WHERE "T14_03_Quote_Date" IS NOT NULL
        AND "T14_04_Sale_Date" IS NULL
        AND "T14_09_Forecast_Date" IS NOT NULL
    `).all();
    const facts = [];
    rows.forEach(so => {
      const lines = db.prepare(`
        SELECT d.*, i."T11_03_Short_Description" as item_desc
        FROM "T15_SO_Details" d LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
        WHERE d."T14_SO_PK" = ?`).all(so.T14_SO_PK);
      lines.forEach(l => {
        facts.push({
          date: so.T14_09_Forecast_Date,
          companyName: l.item_desc || 'Unknown Product',
          employeeName: '',
          amount: (Number(l.T15_01_Quantity) || 0) * (Number(l.T15_02_Price) || 0),
          soNumber: so.T14_01_SO_Number,
        });
      });
    });
    return facts;
  }
  app.get('/reports/rpt131', (req, res) => res.send(renderAggregate(getForecastFacts(), 'company', 'detail', 'Forecast Detail by Product', 'SO')));
  app.get('/reports/rpt132', (req, res) => res.send(renderAggregate(getForecastFacts(), 'company', 'summary', 'Forecast Summary by Product', 'SO')));

  // ===== Purchase due-date reports (rpt301-302) =====
  // Matches Q21_PO_Report_Dates: not yet received, with a due date set (covers due-soon and overdue)
  app.get('/reports/rpt301', (req, res) => {
    const facts = getPurchaseFacts('T17_04_Due_Date').filter(f => !f.raw.T17_03_Received_Date);
    res.send(renderAggregate(facts, 'company', 'detail', 'Purchase Detail Due by Company', 'PO'));
  });
  app.get('/reports/rpt302', (req, res) => {
    const facts = getPurchaseFacts('T17_04_Due_Date').filter(f => !f.raw.T17_03_Received_Date);
    res.send(renderAggregate(facts, 'company', 'detail', 'Purchase Detail by Due Date', 'PO'));
  });
  // Matches Q22_SO_Due_Date: not yet despatched, with a despatch-due date set
  app.get('/reports/rpt303', (req, res) => {
    const facts = getSalesFacts('T14_14_Despatch_Due_Date').filter(f => !f.raw.T14_05_Despatch_Date);
    res.send(renderAggregate(facts, 'company', 'detail', 'Sales Detail Due for Despatch', 'SO'));
  });
  // Matches Q23_PO_Report_Received_Date: received-date based
  app.get('/reports/rpt304', (req, res) => {
    const facts = getPurchaseFacts('T17_03_Received_Date');
    res.send(renderAggregate(facts, 'company', 'detail', 'Purchase Details by Received Date', 'PO'));
  });

  // ===== Overdue / outstanding / paid (rpt305-308) =====
  // rpt305 matches Q29_Overdue_Paid_Accounts: accounts that WERE paid, but paid after the due date
  app.get('/reports/rpt305', (req, res) => {
    const facts = getSalesFacts('T14_13_Payment Received').filter(f => {
      const paid = f.raw['T14_13_Payment Received'];
      const due = f.raw.T14_07_Payment_Due_Date;
      return paid && due && String(paid) > String(due);
    });
    res.send(renderAggregate(facts, 'company', 'detail', 'Overdue Paid Accounts', 'SO'));
  });
  // rpt306 matches Q30_Outstanding_Accounts: unpaid AND past due date (not yet paid at all)
  app.get('/reports/rpt306', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const facts = getSalesFacts('T14_07_Payment_Due_Date').filter(f =>
      !f.raw['T14_13_Payment Received'] && f.date && String(f.date) < today);
    res.send(renderAggregate(facts, 'company', 'detail', 'Outstanding Accounts', 'SO'));
  });
  app.get('/reports/rpt307', (req, res) => {
    const facts = getSalesFacts('T14_06_Invoice_Date');
    res.send(renderAggregate(facts, 'month', 'summary', 'Invoice Summary by Month', 'SO'));
  });
  app.get('/reports/rpt308', (req, res) => {
    const facts = getSalesFacts('T14_13_Payment Received');
    res.send(renderAggregate(facts, 'month', 'summary', 'Paid Account Summary', 'SO'));
  });

  // ===== Balance sheet (rpt309) =====
  // Matches Q63/Q64: cash-basis - sales counted when PAID (Payment_Received), purchases when PAID (Date_Paid)
  app.get('/reports/rpt309', (req, res) => {
    const sales = getSalesFacts('T14_13_Payment Received');
    const purchases = getPurchaseFacts('T17_06_Date_Paid');
    const months = new Set([...sales.map(f => String(f.date).slice(0, 7)), ...purchases.map(f => String(f.date).slice(0, 7))]);
    const salesByMonth = {}, purchByMonth = {};
    sales.forEach(f => { const m = String(f.date).slice(0, 7); salesByMonth[m] = (salesByMonth[m] || 0) + f.amount; });
    purchases.forEach(f => { const m = String(f.date).slice(0, 7); purchByMonth[m] = (purchByMonth[m] || 0) + f.amount; });
    const sortedMonths = [...months].sort();
    if (!sortedMonths.length) {
      return res.send(page('Balance Sheet', `${reportHeader('Balance Sheet')}<p class="empty-notice">No sales or purchase data yet.</p>`));
    }
    let rowsHtml = sortedMonths.map(m => {
      const s = salesByMonth[m] || 0, p = purchByMonth[m] || 0;
      return `<tr><td>${escapeHtml(m)}</td><td class="num">${fmtMoney(s)}</td><td class="num">${fmtMoney(p)}</td><td class="num">${fmtMoney(s - p)}</td></tr>`;
    }).join('');
    const totalS = sortedMonths.reduce((s, m) => s + (salesByMonth[m] || 0), 0);
    const totalP = sortedMonths.reduce((s, m) => s + (purchByMonth[m] || 0), 0);
    res.send(page('Balance Sheet', `${reportHeader('Balance Sheet')}
      <table class="items">
        <thead><tr><th>Month</th><th class="num">Sales</th><th class="num">Purchases</th><th class="num">Net</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="totals"><table><tr class="grand"><td>Net Total</td><td>${fmtMoney(totalS - totalP)}</td></tr></table></div>
      ${footer(sortedMonths.length, 'months')}
    `));
  });

  // ===== Price lists (rpt012-015) =====
  // Matches Q34_Price_List: non-obsolete items with at least one non-zero price
  function itemsSorted(orderCol) {
    return db.prepare(`
      SELECT i.*, c."T12_01_Category" as category_name
      FROM "T11_Item_Master" i LEFT JOIN "T12_Category" c ON c."T12_Category_PK" = i."T12_Category_PK"
      WHERE i."T11_12_Obsolete" = 0
        AND (COALESCE(i."T11_09_List_Price",0) <> 0 OR COALESCE(i."T11_10_Trade_Price",0) <> 0 OR COALESCE(i."T11_11_OEM_Price",0) <> 0)
      ORDER BY ${orderCol}
    `).all();
  }
  app.get('/reports/rpt012', (req, res) => res.redirect('/reports/item-catalog'));
  app.get('/reports/rpt013', (req, res) => res.redirect('/reports/item-catalog'));
  app.get('/reports/rpt014', (req, res) => {
    const items = itemsSorted('i."T11_03_Short_Description"');
    if (!items.length) return res.send(page('3-Tier Price List', `${reportHeader('3-Tier Price List')}<p class="empty-notice">No items yet.</p>`));
    let rowsHtml = items.map(it => `<tr>
      <td>${escapeHtml(it.T11_01_Part_Number ?? '')}</td>
      <td>${escapeHtml(it.T11_03_Short_Description || '')}</td>
      <td class="num">${fmtMoney(it.T11_09_List_Price)}</td>
      <td class="num">${fmtMoney(it.T11_10_Trade_Price)}</td>
      <td class="num">${fmtMoney(it.T11_11_OEM_Price)}</td>
    </tr>`).join('');
    res.send(page('3-Tier Price List', `${reportHeader('3-Tier Price List')}
      <table class="items"><thead><tr><th>Item Code</th><th>Description</th><th class="num">List</th><th class="num">Trade</th><th class="num">OEM</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>${footer(items.length, 'items')}`));
  });
  app.get('/reports/rpt015', (req, res) => {
    // Matches Q27_Items_for_Report: all non-obsolete items (no price filter)
    const items = db.prepare(`
      SELECT i.*, c."T12_01_Category" as category_name
      FROM "T11_Item_Master" i LEFT JOIN "T12_Category" c ON c."T12_Category_PK" = i."T12_Category_PK"
      WHERE i."T11_12_Obsolete" = 0
      ORDER BY i."T11_01_Part_Number"
    `).all();
    if (!items.length) return res.send(page('All Parts by Item Code', `${reportHeader('All Parts by Item Code')}<p class="empty-notice">No items yet.</p>`));
    let rowsHtml = items.map(it => `<tr>
      <td>${escapeHtml(it.T11_01_Part_Number ?? '')}</td>
      <td>${escapeHtml(it.T11_03_Short_Description || '')}</td>
      <td>${escapeHtml(it.category_name || '')}</td>
      <td class="num">${it.T11_06_Qty_OH ?? 0}</td>
    </tr>`).join('');
    res.send(page('All Parts by Item Code', `${reportHeader('All Parts by Item Code')}
      <table class="items"><thead><tr><th>Item Code</th><th>Description</th><th>Category</th><th class="num">Qty OH</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>${footer(items.length, 'items')}`));
  });

  // ===== Phone / contact lists (rpt011, R27, R40) =====
  // ===== Forecast vs Actual variance (Forecast Monitoring) =====
  app.get('/reports/forecast-variance', (req, res) => {
    const forecasts = db.prepare(`
      SELECT f.*, i."T11_01_Part_Number" as partNumber, i."T11_03_Short_Description" as itemDesc,
             c."T01_01_Company_Name" as customerName
      FROM "T26_Forecast" f
      LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = f."T11_Item_Master_PK"
      LEFT JOIN "T01_Company" c ON c."T01_PK" = f."T01_PK"
      ORDER BY f."T26_04_Quarter" DESC, i."T11_01_Part_Number"
    `).all();

    const quarterBounds = (q) => {
      const m = /^(\d{4})-Q([1-4])$/i.exec(String(q || '').trim());
      if (!m) return [null, null];
      const year = m[1];
      const qn = Number(m[2]);
      const startMonth = String((qn - 1) * 3 + 1).padStart(2, '0');
      const endMonth = String(qn * 3).padStart(2, '0');
      const lastDay = new Date(Number(year), qn * 3, 0).getDate();
      return [`${year}-${startMonth}-01`, `${year}-${endMonth}-${String(lastDay).padStart(2, '0')}`];
    };

    if (!forecasts.length) {
      return res.send(page('Forecast vs Actual', `${reportHeader('Forecast vs Actual', 'Forecast Monitoring')}<p class="empty-notice">No forecasts recorded yet. Add forecasts under Planning → Sales Forecasts.</p>`));
    }

    const rowsHtml = forecasts.map((f) => {
      const [start, end] = quarterBounds(f.T26_04_Quarter);
      let actualQty = 0;
      if (start && end) {
        const actual = db.prepare(`
          SELECT COALESCE(SUM(sd."T15_01_Quantity"), 0) as qty
          FROM "T15_SO_Details" sd
          JOIN "T14_Sales_Orders" so ON so."T14_SO_PK" = sd."T14_SO_PK"
          WHERE sd."T11_Item_Master_PK" = ?
            AND so."T14_04_Sale_Date" >= ? AND so."T14_04_Sale_Date" <= ?
        `).get(f.T11_Item_Master_PK, start, end);
        actualQty = actual.qty || 0;
      }
      const forecastQty = Number(f.T26_01_Forecast_Quantity) || 0;
      const variance = actualQty - forecastQty;
      const variancePct = forecastQty ? ((variance / forecastQty) * 100).toFixed(1) + '%' : '—';
      const varClass = variance < 0 ? 'style="color:#b91c1c"' : variance > 0 ? 'style="color:#15803d"' : '';
      return `<tr>
        <td>${escapeHtml(f.T26_04_Quarter || '—')}</td>
        <td>${escapeHtml(f.partNumber ?? '')}</td>
        <td>${escapeHtml(f.itemDesc || '')}</td>
        <td>${escapeHtml(f.customerName || 'All / Branch')}</td>
        <td class="num">${forecastQty}</td>
        <td class="num">${actualQty}</td>
        <td class="num" ${varClass}>${variance > 0 ? '+' : ''}${variance}</td>
        <td class="num" ${varClass}>${variancePct}</td>
      </tr>`;
    }).join('');

    res.send(page('Forecast vs Actual', `${reportHeader('Forecast vs Actual', 'Forecast Monitoring — actual sales vs. quarterly forecast, by item')}
      <table class="items">
        <thead><tr><th>Quarter</th><th>Item Code</th><th>Item</th><th>Customer/Branch</th><th class="num">Forecast Qty</th><th class="num">Actual Qty</th><th class="num">Variance</th><th class="num">Variance %</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${footer(forecasts.length, 'forecast lines')}`));
  });

  app.get('/reports/rpt011', (req, res) => {
    // Matches Q28_Contacts_for_Phone_List: non-obsolete company AND non-obsolete contact
    const contacts = db.prepare(`
      SELECT c.* FROM "T07_Contacts" c
      JOIN "T01_Company" comp ON comp."T01_PK" = c."T01_PK"
      WHERE c."T07_11_Obsolete" = 0 AND comp."T01_14_Obsolete" = 0
      ORDER BY c."T07_02_Surname"
    `).all();
    if (!contacts.length) return res.send(page('Phone List - All', `${reportHeader('Phone List - All Contacts')}<p class="empty-notice">No active contacts found.</p>`));
    let rowsHtml = contacts.map(c => {
      const comp = c.T01_PK ? db.prepare(`SELECT * FROM "T01_Company" WHERE "T01_PK" = ?`).get(c.T01_PK) : null;
      return `<tr><td>${escapeHtml([c.T07_01_Forename, c.T07_02_Surname].filter(Boolean).join(' '))}</td><td>${escapeHtml(comp ? comp.T01_01_Company_Name : '')}</td><td>${escapeHtml(c.T07_03_Phone || c.T07_07_Mobile || '')}</td></tr>`;
    }).join('');
    res.send(page('Phone List - All', `${reportHeader('Phone List - All Contacts')}
      <table class="items"><thead><tr><th>Name</th><th>Company</th><th>Phone</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      ${footer(contacts.length, 'contacts')}`));
  });

  app.get('/reports/R40', (req, res) => {
    // Matches Q36_Employees_for_Phone_List: non-obsolete employees
    const employees = db.prepare(`SELECT * FROM "T05_Employees" WHERE "T05_11_Obsolete" = 0 ORDER BY "T05_02_Surname"`).all();
    if (!employees.length) return res.send(page('Internal Phone List', `${reportHeader('Internal Phone List')}<p class="empty-notice">No active employees found.</p>`));
    let rowsHtml = employees.map(e => `<tr><td>${escapeHtml([e.T05_01_Forename, e.T05_02_Surname].filter(Boolean).join(' '))}</td><td>${escapeHtml(e.T05_12_Title || '')}</td><td>${escapeHtml(e.T05_03_Phone || e.T05_08_Mobile || '')}</td><td>${escapeHtml(e.T05_06_Email || '')}</td></tr>`).join('');
    res.send(page('Internal Phone List', `${reportHeader('Internal Phone List')}
      <table class="items"><thead><tr><th>Name</th><th>Title</th><th>Phone</th><th>Email</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      ${footer(employees.length, 'employees')}`));
  });

  app.get('/reports/R27/:companyId', (req, res) => {
    const company = db.prepare(`SELECT * FROM "T01_Company" WHERE "T01_PK" = ?`).get(req.params.companyId);
    if (!company) return res.status(404).send(page('Not Found', '<p class="empty-notice">Company not found.</p>'));
    const contacts = db.prepare(`SELECT * FROM "T07_Contacts" WHERE "T01_PK" = ?`).all(req.params.companyId);
    let rowsHtml = contacts.map(c => `<tr><td>${escapeHtml([c.T07_01_Forename, c.T07_02_Surname].filter(Boolean).join(' '))}</td><td>${escapeHtml(c.T07_12_Title || '')}</td><td>${escapeHtml(c.T07_03_Phone || c.T07_07_Mobile || '')}</td></tr>`).join('');
    res.send(page(`Phone List - ${company.T01_01_Company_Name}`, `${reportHeader(`Phone List`, company.T01_01_Company_Name)}
      <table class="items"><thead><tr><th>Name</th><th>Title</th><th>Phone</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="3" class="empty-notice">No contacts on file</td></tr>'}</tbody></table>
      ${footer(contacts.length, 'contacts')}`));
  });

  // ===== Contact management / history (R25, R41) =====
  app.get('/reports/R25/:contactId', (req, res) => {
    const contact = db.prepare(`SELECT * FROM "T07_Contacts" WHERE "T07_PK" = ?`).get(req.params.contactId);
    if (!contact) return res.status(404).send(page('Not Found', '<p class="empty-notice">Contact not found.</p>'));
    const notes = db.prepare(`SELECT * FROM "T08_Contact_Management" WHERE "T07_PK" = ? ORDER BY "T08_01_Date" DESC`).all(req.params.contactId);
    const name = [contact.T07_01_Forename, contact.T07_02_Surname].filter(Boolean).join(' ');
    let rowsHtml = notes.map(n => `<tr><td>${escapeHtml(fmtDate(n.T08_01_Date))}</td><td>${escapeHtml(n.T08_02_Contact_Record || '')}</td></tr>`).join('');
    res.send(page(`Contact History - ${name}`, `${reportHeader('Contact Management Report', name)}
      <table class="items"><thead><tr><th>Date</th><th>Note</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="2" class="empty-notice">No notes on file</td></tr>'}</tbody></table>
      ${footer(notes.length, 'notes')}`));
  });

  // ===== Letter / Fax templates (R44, R45) =====
  function letterFaxTemplate(kind, contact) {
    const yc = getYourCompany();
    const name = contact ? [contact.T07_01_Forename, contact.T07_02_Surname].filter(Boolean).join(' ') : '';
    return `${reportHeader(kind === 'fax' ? 'Fax' : 'Letter')}
      <div style="margin-top:20px;">
        <p>${new Date().toLocaleDateString()}</p>
        <p>${escapeHtml(name)}${contact && contact.T07_05_Email ? `<br>${escapeHtml(contact.T07_05_Email)}` : ''}</p>
        <p style="margin-top:30px;">Dear ${escapeHtml(name || 'Sir/Madam')},</p>
        <p style="min-height:200px;">&nbsp;</p>
        <p>Yours sincerely,</p>
        <p style="margin-top:40px;">${escapeHtml(yc.T04_01_Your_Company_Name || 'Your Company')}</p>
      </div>
      ${footer()}`;
  }
  app.get('/reports/letter/:contactId', (req, res) => {
    const contact = db.prepare(`SELECT * FROM "T07_Contacts" WHERE "T07_PK" = ?`).get(req.params.contactId);
    res.send(page('Letter', letterFaxTemplate('letter', contact)));
  });
  app.get('/reports/fax/:contactId', (req, res) => {
    const contact = db.prepare(`SELECT * FROM "T07_Contacts" WHERE "T07_PK" = ?`).get(req.params.contactId);
    res.send(page('Fax', letterFaxTemplate('fax', contact)));
  });

  // ===== Reports directory (index of all 50 original reports) =====
  app.get('/reports', (req, res) => {
    const companies = db.prepare(`SELECT "T01_PK", "T01_01_Company_Name" FROM "T01_Company" ORDER BY "T01_01_Company_Name"`).all();
    const contacts = db.prepare(`SELECT "T07_PK", "T07_01_Forename", "T07_02_Surname" FROM "T07_Contacts" ORDER BY "T07_02_Surname"`).all();

    const companyPicker = companies.map(c => `<option value="${c.T01_PK}">${escapeHtml(c.T01_01_Company_Name)}</option>`).join('');
    const contactPicker = contacts.map(c => `<option value="${c.T07_PK}">${escapeHtml([c.T07_01_Forename, c.T07_02_Surname].filter(Boolean).join(' '))}</option>`).join('');

    const sections = [
      { title: 'Sales & Purchase Documents', links: [
        ['Invoice (pick a Sales Order from the Sales Orders tab)', null],
        ['Commercial Invoice (pick a Sales Order from the Sales Orders tab)', null],
        ['Delivery Note (pick a Sales Order from the Sales Orders tab)', null],
        ['Purchase Order (pick a PO from the Purchase Orders tab)', null],
        ['Quotation (pick a Quotation from the Quotations tab)', null],
      ]},
      { title: 'Price Lists & Directories', links: [
        ['Retail Price List', '/reports/item-catalog'],
        ['3-Tier Price List (List/Trade/OEM)', '/reports/rpt014'],
        ['All Parts by Item Code', '/reports/rpt015'],
        ['Phone List - All Contacts', '/reports/rpt011'],
        ['Internal Phone List (Employees)', '/reports/R40'],
        ['Company Directory', '/reports/directory'],
      ]},
      { title: 'Quote Analytics', links: [
        ['Quote Detail by Company', '/reports/rpt101'], ['Quote Summary by Company', '/reports/rpt102'], ['Quotes by Company (chart)', '/reports/rpt103'],
        ['Quote Detail by Employee', '/reports/rpt104'], ['Quote Summary by Employee', '/reports/rpt105'], ['Quotes by Employee (chart)', '/reports/rpt106'],
        ['Quote Detail by Month', '/reports/rpt107'], ['Quote Summary by Month', '/reports/rpt108'], ['Quotes by Month (chart)', '/reports/rpt109'],
        ['Open Quotes', '/reports/rpt121'],
      ]},
      { title: 'Sales Analytics', links: [
        ['Sales Detail by Company', '/reports/rpt201'], ['Sales Summary by Company', '/reports/rpt202'], ['Sales by Company (chart)', '/reports/rpt203'],
        ['Sales Detail by Employee', '/reports/rpt204'], ['Sales Summary by Employee', '/reports/rpt205'], ['Sales by Employee (chart)', '/reports/rpt206'],
        ['Sales Detail by Month', '/reports/rpt207'], ['Sales Summary by Month', '/reports/rpt208'], ['Sales by Month (chart)', '/reports/rpt209'],
      ]},
      { title: 'Forecast', links: [
        ['Forecast Detail by Product', '/reports/rpt131'], ['Forecast Summary by Product', '/reports/rpt132'],
      ]},
      { title: 'Accounts & Balance Sheet', links: [
        ['Purchase Detail Due by Company', '/reports/rpt301'], ['Purchase Detail by Due Date', '/reports/rpt302'],
        ['Sales Detail Due by Date', '/reports/rpt303'], ['Purchase Details by Received Date', '/reports/rpt304'],
        ['Overdue Accounts', '/reports/rpt305'], ['Outstanding Invoices', '/reports/rpt306'],
        ['Invoice Summary by Month', '/reports/rpt307'], ['Paid Account Summary', '/reports/rpt308'],
        ['Balance Sheet', '/reports/rpt309'],
      ]},
    ];

    let sectionsHtml = sections.map(s => `
      <div style="margin-bottom:28px;">
        <h3 style="font-family:'Inter',sans-serif;font-size:13px;text-transform:uppercase;letter-spacing:0.8px;color:#666;border-bottom:1px solid #ccc;padding-bottom:6px;">${escapeHtml(s.title)}</h3>
        <ul style="columns:2;column-gap:32px;list-style:none;padding:0;margin:10px 0;">
          ${s.links.map(([label, url]) => url
            ? `<li style="margin-bottom:6px;"><a href="${url}" target="_blank" style="color:#1a1a1a;text-decoration:none;border-bottom:1px solid #d97706;">${escapeHtml(label)}</a></li>`
            : `<li style="margin-bottom:6px;color:#999;">${escapeHtml(label)}</li>`
          ).join('')}
        </ul>
      </div>`).join('');

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reports Directory</title>${BASE_STYLE}
      <style>body{max-width:900px;}</style></head><body>
      ${reportHeader('Reports Directory', `${sections.reduce((n, s) => n + s.links.length, 0)} reports`)}
      <div style="margin-top:20px; padding:14px 18px; background:#f7f2e8; border-radius:6px; font-size:12.5px; color:#555;">
        Need a per-company phone list, a contact's history, or a letter/fax? Open the relevant record from its section in the app (Companies, Contacts) — each has a Print or history link that leads here with the right record pre-selected.
      </div>
      ${sectionsHtml}
      </body></html>`);
  });
}

module.exports = { registerReports2 };
