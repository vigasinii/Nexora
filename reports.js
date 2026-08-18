// Print-friendly HTML report generation
// Mirrors the report/printout features of the original Access application

const { dbGet, dbAll, dbRun, dbExec } = require('./db-turso');

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtDate(d) {
  if (!d) return '';
  return String(d);
}

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Converts a number to words, e.g. 1234.56 -> "One Thousand Two Hundred
// Thirty-Four and 56/100". Used under totals so amounts are unambiguous
// on printed documents.
function amountInWords(n, currencyName) {
  const num = Number(n) || 0;
  const whole = Math.floor(Math.abs(num));
  const cents = Math.round((Math.abs(num) - whole) * 100);

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function chunkToWords(chunk) {
    let str = '';
    if (chunk >= 100) {
      str += ones[Math.floor(chunk / 100)] + ' Hundred ';
      chunk %= 100;
    }
    if (chunk >= 20) {
      str += tens[Math.floor(chunk / 10)] + (chunk % 10 ? '-' + ones[chunk % 10] : '') + ' ';
    } else if (chunk > 0) {
      str += ones[chunk] + ' ';
    }
    return str.trim();
  }

  function numberToWords(num) {
    if (num === 0) return 'Zero';
    const scales = ['', 'Thousand', 'Million', 'Billion'];
    let scaleIdx = 0;
    let parts = [];
    while (num > 0) {
      const chunk = num % 1000;
      if (chunk) parts.unshift(chunkToWords(chunk) + (scales[scaleIdx] ? ' ' + scales[scaleIdx] : ''));
      num = Math.floor(num / 1000);
      scaleIdx++;
    }
    return parts.join(' ').trim();
  }

  const wholeWords = numberToWords(whole);
  const centsStr = String(cents).padStart(2, '0');
  const currencyPart = currencyName ? ' ' + currencyName : '';
  return `${wholeWords}${currencyPart} and ${centsStr}/100 Only`;
}

const BASE_STYLE = `
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a;
    max-width: 800px;
    margin: 0 auto;
    padding: 48px 40px;
    font-size: 13px;
    line-height: 1.5;
  }
  .toolbar { text-align: right; margin-bottom: 20px; }
  .toolbar button {
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    font-weight: 600;
    padding: 8px 16px;
    border-radius: 4px;
    border: 1px solid #d97706;
    background: #d97706;
    color: #fff;
    cursor: pointer;
  }
  .letterhead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #1a1a1a;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .letterhead .company-name { font-size: 22px; font-weight: 700; letter-spacing: 0.3px; }
  .letterhead .company-details { font-size: 11.5px; color: #444; margin-top: 4px; }
  .letterhead-brand { display: flex; align-items: center; gap: 14px; }
  .letterhead-logo { max-height: 56px; max-width: 160px; object-fit: contain; }
  .doc-title { text-align: right; }
  .doc-title h1 {
    font-family: 'Inter', sans-serif;
    font-size: 24px;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .doc-title .doc-number { font-family: 'Inter', sans-serif; font-size: 13px; color: #666; margin-top: 4px; }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-bottom: 28px;
  }
  .meta-block h4 {
    font-family: 'Inter', sans-serif;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #999;
    margin: 0 0 6px;
  }
  .meta-block .primary { font-weight: 700; font-size: 14px; }
  .meta-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
  .meta-row span:first-child { color: #666; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
  }
  table.items th {
    font-family: 'Inter', sans-serif;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    text-align: left;
    color: #666;
    border-bottom: 2px solid #1a1a1a;
    padding: 8px 6px;
  }
  table.items td {
    padding: 9px 6px;
    border-bottom: 1px solid #ddd;
    font-size: 12.5px;
  }
  table.items td.num, table.items th.num { text-align: right; }
  .totals { display: flex; flex-direction: column; align-items: flex-end; margin-top: 12px; }
  .totals table { border-collapse: collapse; }
  .totals td { padding: 4px 10px; font-size: 13px; }
  .amount-words { font-size: 11px; color: #666; font-style: italic; margin-top: 4px; text-align: right; max-width: 380px; }
  .totals tr.grand td { font-weight: 700; font-size: 15px; border-top: 2px solid #1a1a1a; padding-top: 8px; }
  .notes-block { margin-top: 28px; font-size: 12px; }
  .notes-block h4 {
    font-family: 'Inter', sans-serif;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #999;
    margin: 0 0 6px;
  }
  .footer {
    margin-top: 48px;
    padding-top: 12px;
    border-top: 1px solid #ccc;
    font-family: 'Inter', sans-serif;
    font-size: 10px;
    color: #999;
    text-align: center;
  }
  .empty-notice { color: #999; font-style: italic; padding: 20px 0; }
  @media print {
    .toolbar { display: none; }
    body { padding: 0; max-width: none; }
  }
</style>
`;

function toolbar() {
  return `<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div>`;
}

function page(title, bodyHtml) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${BASE_STYLE}</head>
<body>${toolbar()}${bodyHtml}</body></html>`;
}

function registerReportRoutes(app) {

  // Sequential document numbers (INT2600182 style: prefix + 2-digit year +
  // zero-padded sequence). Shared logic with server.js's generic counter.
  async function getNextDocNumber(prefix, { includeYear = true, digits = 5 } = {}) {
    const row = (await dbGet(`SELECT next_number FROM T29_DocCounters WHERE doc_type = ?`, [prefix]));
    const next = row ? row.next_number : 1;
    if (row) {
      (await dbRun(`UPDATE T29_DocCounters SET next_number = ? WHERE doc_type = ?`, [next + 1, prefix]));
    } else {
      (await dbRun(`INSERT INTO T29_DocCounters (doc_type, next_number) VALUES (?, ?)`, [prefix, next + 1]));
    }
    const yearPart = includeYear ? String(new Date().getFullYear()).slice(-2) : '';
    const seqPart = digits > 0 ? String(next).padStart(digits, '0') : String(next);
    return `${prefix}${yearPart}${seqPart}`;
  }

  // Commercial Invoice and Packing List share one document number per
  // shipment (matches real-world usage — same number appears on both).
  // Generated once on first request, then reused every time after.
  async function getOrCreateShipmentDocNumber(soPk) {
    let ful = (await dbGet(`SELECT * FROM "T25_SO_Fulfillment" WHERE "T14_SO_PK" = ?`, [soPk]));
    if (ful && ful.T25_30_CI_Number) return ful.T25_30_CI_Number;
    const docNumber = await getNextDocNumber('INT');
    if (ful) {
      (await dbRun(`UPDATE "T25_SO_Fulfillment" SET "T25_30_CI_Number" = ?, "T25_31_PL_Number" = ? WHERE "T14_SO_PK" = ?`, [docNumber, docNumber, soPk]));
    } else {
      (await dbRun(`INSERT INTO "T25_SO_Fulfillment" ("T14_SO_PK", "T25_30_CI_Number", "T25_31_PL_Number") VALUES (?, ?, ?)`, [soPk, docNumber, docNumber]));
    }
    return docNumber;
  }

  // Looks up an approved requisition tied to this Sales Order, if one
  // exists, so its SRF number can be shown on logistics documents
  // (Commercial Invoice / Packing List / Delivery Note) alongside the
  // shipment's own Invoice/PL number.
  async function getSrfNumberForSO(soPk) {
    const req_ = (await dbGet(`
      SELECT T27_09_SRF_Number FROM T27_Requisition
      WHERE T14_SO_PK = ? AND T27_06_Status = 'Approved' AND T27_09_SRF_Number IS NOT NULL
      ORDER BY T27_Requisition_ID DESC LIMIT 1
    `, [soPk]));
    return req_ ? req_.T27_09_SRF_Number : null;
  }

  async function getYourCompany() {
    const yc = (await dbGet(`SELECT * FROM "T04_Your_Company" LIMIT 1`));
    if (!yc) return { name: 'Your Company', address: '', city: '', web: '', phone: '', fax: '' };
    let city = '';
    if (yc.T02_City_PK) {
      const c = (await dbGet(`SELECT * FROM "T02_CityStatePCode" WHERE "T02_City_PK" = ?`, [yc.T02_City_PK]));
      if (c) city = [c.T02_1_City, c.T02_2_State, c.T02_3_PCode].filter(Boolean).join(', ');
    }
    return {
      name: yc.T04_01_Your_Company_Name || 'Your Company',
      address: yc.T04_02_Your_Street_Address || '',
      city,
      web: yc.T04_06_Your_Web_Site || '',
      phone: yc.T04_07_Your_Switch || '',
      fax: yc.T04_08_Your_Fax || '',
      logo: yc.T04_09_Logo || '',
    };
  }

  async function letterheadHtml() {
    const yc = await getYourCompany();
    const detailsParts = [yc.address, yc.city, yc.phone ? `Tel: ${yc.phone}` : '', yc.fax ? `Fax: ${yc.fax}` : '', yc.web]
      .filter(Boolean).map(escapeHtml).join(' &nbsp;|&nbsp; ');
    const logoHtml = yc.logo ? `<img src="/uploads/${escapeHtml(yc.logo)}" class="letterhead-logo" />` : '';
    return { yc, detailsParts, logoHtml };
  }

  async function getContact(pk) {
    if (!pk) return null;
    const c = (await dbGet(`SELECT * FROM "T07_Contacts" WHERE "T07_PK" = ?`, [pk]));
    if (!c) return null;
    let companyName = '';
    if (c.T01_PK) {
      const comp = (await dbGet(`SELECT * FROM "T01_Company" WHERE "T01_PK" = ?`, [c.T01_PK]));
      if (comp) companyName = comp.T01_01_Company_Name || '';
    }
    return {
      name: [c.T07_01_Forename, c.T07_02_Surname].filter(Boolean).join(' '),
      phone: c.T07_03_Phone || '',
      email: c.T07_05_Email || '',
      company: companyName,
    };
  }

  async function getEmployee(pk) {
    if (!pk) return null;
    const e = (await dbGet(`SELECT * FROM "T05_Employees" WHERE "T05_Employee_PK" = ?`, [pk]));
    if (!e) return null;
    return { name: [e.T05_01_Forename, e.T05_02_Surname].filter(Boolean).join(' ') };
  }

  async function getCurrency(id) {
    if (!id) return null;
    return (await dbGet(`SELECT * FROM "T22_Currency" WHERE "T22_Currency_ID" = ?`, [id]));
  }

  async function getCourier(pk) {
    if (!pk) return null;
    return (await dbGet(`SELECT * FROM "T13_Courier" WHERE "T13_PK" = ?`, [pk]));
  }

  // ---------- Sales Order / Invoice ----------
  app.get('/reports/sales-order/:id', async (req, res) => {
    const so = (await dbGet(`SELECT * FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [req.params.id]));
    if (!so) return res.status(404).send(page('Not Found', '<p class="empty-notice">Sales order not found.</p>'));

    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    const contact = await getContact(so.T07_PK);
    const shipTo = await getContact(so.T07_PK_SHIPTO);
    const employee = await getEmployee(so.T05_Employee_PK);
    const currency = await getCurrency(so.T22_Currency_ID);
    const courier = await getCourier(so.T13_PK);
    const symbol = currency?.T22_02_Symbol || '';

    const lines = (await dbAll(`
      SELECT d.*, i."T11_03_Short_Description" as item_desc, i."T11_04_Long_Description" as item_long
      FROM "T15_SO_Details" d
      LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
      WHERE d."T14_SO_PK" = ?
    `, [so.T14_SO_PK]));

    let subtotal = 0;
    const convRate = Number(so.T14_15_Conversion_Rate) || 1;
    const rowsHtml = lines.map(l => {
      const qty = Number(l.T15_01_Quantity) || 0;
      const unitPrice = (Number(l.T15_02_Price) || 0) * convRate;
      const lineTotal = qty * unitPrice;
      subtotal += lineTotal;
      return `<tr>
        <td>${escapeHtml(l.item_desc || l.item_long || l.T11_Item_Master_PK)}</td>
        <td class="num">${qty}</td>
        <td class="num">${symbol}${fmtMoney(unitPrice)}</td>
        <td class="num">${symbol}${fmtMoney(lineTotal)}</td>
      </tr>`;
    }).join('');

    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div>
          <div class="company-name">${escapeHtml(yc.name)}</div>
          <div class="company-details">${detailsParts}</div>
        </div></div>
        <div class="doc-title">
          <h1>Sales Order</h1>
          <div class="doc-number">SO #${escapeHtml(so.T14_01_SO_Number ?? '')}</div>
        </div>
      </div>
      <div class="meta-grid">
        <div class="meta-block">
          <h4>Bill To</h4>
          <div class="primary">${escapeHtml(contact?.name || '—')}</div>
          <div>${escapeHtml(contact?.company || '')}</div>
          <div>${escapeHtml(contact?.email || '')} ${contact?.phone ? ' &middot; ' + escapeHtml(contact.phone) : ''}</div>
        </div>
        <div class="meta-block">
          <h4>Ship To</h4>
          <div class="primary">${escapeHtml(shipTo?.name || contact?.name || '—')}</div>
          <div>${escapeHtml(shipTo?.company || '')}</div>
        </div>
      </div>
      <div class="meta-grid">
        <div class="meta-block">
          <div class="meta-row"><span>Sale Date</span><span>${fmtDate(so.T14_04_Sale_Date)}</span></div>
          <div class="meta-row"><span>Despatch Date</span><span>${fmtDate(so.T14_05_Despatch_Date)}</span></div>
          <div class="meta-row"><span>Payment Due</span><span>${fmtDate(so.T14_07_Payment_Due_Date)}</span></div>
        </div>
        <div class="meta-block">
          <div class="meta-row"><span>Sales Rep</span><span>${escapeHtml(employee?.name || '—')}</span></div>
          <div class="meta-row"><span>Customer PO</span><span>${escapeHtml(so.T14_11_Cust_PO_Number || '—')}</span></div>
          <div class="meta-row"><span>Courier</span><span>${escapeHtml(courier?.T13_01_Courier || '—')}</span></div>
        </div>
      </div>
      ${lines.length ? `
      <table class="items">
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Line Total</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="totals">
        <table>
          <tr class="grand"><td>Total</td><td>${symbol}${fmtMoney(subtotal)}</td></tr>
        </table>
        <div class="amount-words">${escapeHtml(amountInWords(subtotal, currency?.T22_01_Currency))}</div>
      </div>
      ` : `<p class="empty-notice">No line items recorded for this sales order.</p>`}
      ${so.T14_10_SO_Notes ? `<div class="notes-block"><h4>Notes</h4><p>${escapeHtml(so.T14_10_SO_Notes)}</p></div>` : ''}
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`Sales Order ${so.T14_01_SO_Number ?? ''}`, body));
  });

  // ---------- Commercial Invoice (export document, used for customs/shipping) ----------
  app.get('/reports/commercial-invoice/:id', async (req, res) => {
    const so = (await dbGet(`SELECT * FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [req.params.id]));
    if (!so) return res.status(404).send(page('Not Found', '<p class="empty-notice">Sales order not found.</p>'));

    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    const contact = await getContact(so.T07_PK);
    const shipTo = await getContact(so.T07_PK_SHIPTO);
    const currency = await getCurrency(so.T22_Currency_ID);
    const symbol = currency?.T22_02_Symbol || '';
    const ful = (await dbGet(`SELECT * FROM "T25_SO_Fulfillment" WHERE "T14_SO_PK" = ?`, [so.T14_SO_PK])) || {};
    const shipmentDocNumber = await getOrCreateShipmentDocNumber(so.T14_SO_PK);
    const srfNumber = await getSrfNumberForSO(so.T14_SO_PK);

    const lines = (await dbAll(`
      SELECT d.*, i."T11_01_Part_Number" as part_number, i."T11_03_Short_Description" as item_desc, i."T11_04_Long_Description" as item_long
      FROM "T15_SO_Details" d LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
      WHERE d."T14_SO_PK" = ?
    `, [so.T14_SO_PK]));

    let subtotal = 0;
    const convRate = Number(so.T14_15_Conversion_Rate) || 1;
    const rowsHtml = lines.map(l => {
      const qty = Number(l.T15_01_Quantity) || 0;
      const unitPrice = (Number(l.T15_02_Price) || 0) * convRate;
      const lineTotal = qty * unitPrice;
      subtotal += lineTotal;
      return `<tr>
        <td>${escapeHtml(l.part_number ?? '')}</td>
        <td>${escapeHtml(l.item_desc || l.item_long || l.T11_Item_Master_PK)}</td>
        <td>${escapeHtml(ful.T25_11_HSCode || '—')}</td>
        <td class="num">${qty}</td>
        <td class="num">${symbol}${fmtMoney(unitPrice)}</td>
        <td class="num">${symbol}${fmtMoney(lineTotal)}</td>
      </tr>`;
    }).join('');

    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
        <div class="doc-title"><h1>Commercial Invoice</h1><div class="doc-number">Invoice No. ${escapeHtml(shipmentDocNumber)}${srfNumber ? ` &middot; SRF ${escapeHtml(srfNumber)}` : ''}</div></div>
      </div>
      <div class="meta-block" style="margin-bottom:12px"><span style="font-size:11px;color:#666">SO Reference: ${escapeHtml(so.T14_01_SO_Number ?? '')}</span></div>
      <div class="meta-grid">
        <div class="meta-block">
          <h4>Exporter / Seller</h4>
          <div class="primary">${escapeHtml(yc.name)}</div>
          <div>${escapeHtml(yc.address)} ${escapeHtml(yc.city)}</div>
        </div>
        <div class="meta-block">
          <h4>Consignee / Buyer</h4>
          <div class="primary">${escapeHtml((shipTo || contact)?.name || '—')}</div>
          <div>${escapeHtml((shipTo || contact)?.company || '')}</div>
        </div>
      </div>
      <div class="meta-grid">
        <div class="meta-block">
          <div class="meta-row"><span>Invoice Date</span><span>${fmtDate(so.T14_06_Invoice_Date) || new Date().toLocaleDateString()}</span></div>
          <div class="meta-row"><span>Customer PO</span><span>${escapeHtml(so.T14_11_Cust_PO_Number || '—')}</span></div>
        </div>
        <div class="meta-block">
          <div class="meta-row"><span>Shipping Arranged By</span><span>${escapeHtml(ful.T25_18_ShippingArrangedBy || '—')}</span></div>
          <div class="meta-row"><span>Weight</span><span>${ful.T25_13_WeightKg ? ful.T25_13_WeightKg + ' kg' : '—'}</span></div>
          <div class="meta-row"><span>Dimensions</span><span>${escapeHtml(ful.T25_12_Dimensions || '—')}</span></div>
        </div>
      </div>
      ${lines.length ? `
      <table class="items">
        <thead><tr><th>Item Code</th><th>Description</th><th>HS Code</th><th class="num">Qty</th><th class="num">Unit Value</th><th class="num">Total Value</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="totals"><table><tr class="grand"><td>Total Value</td><td>${symbol}${fmtMoney(subtotal)}</td></tr></table>
        <div class="amount-words">${escapeHtml(amountInWords(subtotal, currency?.T22_01_Currency))}</div>
      </div>
      <p style="font-size:11px;color:#666;margin-top:12px">Country of Origin: — &nbsp;|&nbsp; Reason for Export: Sale of Goods</p>
      ` : `<p class="empty-notice">No line items recorded for this order.</p>`}
      <div class="notes-block" style="margin-top:24px">
        <p style="font-size:11px">I/We certify that the information on this invoice is true and correct.</p>
        <div style="margin-top:40px;border-top:1px solid #ccc;width:220px;padding-top:4px;font-size:11px">Authorized Signature</div>
      </div>
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`Commercial Invoice ${so.T14_01_SO_Number ?? ''}`, body));
  });

  // ---------- Delivery Note (packing list style — quantities, no pricing) ----------
  // ---------- Packing List (generated from a Stock/Purchase Requisition) ----------
  // ---------- Packing List for a Sales Order shipment (shares the same
  // document number as the Commercial Invoice, matching real-world usage) ----------
  // ---------- RMA (Return Merchandise Authorization) ----------
  app.get('/reports/rma/:id', async (req, res) => {
    const rma = (await dbGet(`SELECT * FROM T30_RMA WHERE T30_RMA_PK = ?`, [req.params.id]));
    if (!rma) return res.status(404).send(page('Not Found', '<p class="empty-notice">RMA not found.</p>'));

    const so = (await dbGet(`SELECT * FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [rma.T14_SO_PK]));
    const item = (await dbGet(`SELECT * FROM "T11_Item_Master" WHERE "T11_Item_Master_PK" = ?`, [rma.T11_Item_Master_PK]));
    const serial = rma.T24_Serial_PK ? (await dbGet(`SELECT * FROM "T24_Serial_Numbers" WHERE "T24_Serial_PK" = ?`, [rma.T24_Serial_PK])) : null;
    const contact = await getContact(so?.T07_PK);
    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    const shipmentDocNumber = so ? await getOrCreateShipmentDocNumber(so.T14_SO_PK) : null;

    const warrantyBadge = rma.T30_04_Under_Warranty === 1
      ? '<span style="color:#15803d;font-weight:700">UNDER WARRANTY</span>'
      : rma.T30_04_Under_Warranty === 0
        ? '<span style="color:#b91c1c;font-weight:700">WARRANTY EXPIRED</span>'
        : '<span style="color:#666">No warranty data on file</span>';

    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
        <div class="doc-title"><h1>Return Merchandise Authorization</h1><div class="doc-number">${escapeHtml(rma.T30_01_RMA_Number)}</div></div>
      </div>
      <div class="meta-grid">
        <div class="meta-block">
          <h4>Customer</h4>
          <div class="primary">${escapeHtml(contact?.name || '—')}</div>
          <div>${escapeHtml(contact?.company || '')}</div>
        </div>
        <div class="meta-block">
          <div class="meta-row"><span>Original SO #</span><span>${escapeHtml(String(so?.T14_01_SO_Number ?? '—'))}</span></div>
          <div class="meta-row"><span>Commercial Invoice / Packing List No.</span><span>${escapeHtml(shipmentDocNumber || '—')}</span></div>
          <div class="meta-row"><span>Date Requested</span><span>${fmtDate(rma.T30_03_Date_Requested) || '—'}</span></div>
        </div>
      </div>
      <table class="items">
        <thead><tr><th>Item Code</th><th>Description</th><th>Serial Number</th><th>Warranty End</th><th>Status</th></tr></thead>
        <tbody>
          <tr>
            <td>${escapeHtml(item?.T11_01_Part_Number ?? '')}</td>
            <td>${escapeHtml(item?.T11_03_Short_Description ?? '')}</td>
            <td>${escapeHtml(serial?.T24_03_Serial_Number || '—')}</td>
            <td>${fmtDate(serial?.T24_05_Warranty_End) || '—'}</td>
            <td>${warrantyBadge}</td>
          </tr>
        </tbody>
      </table>
      <div class="notes-block" style="margin-top:20px">
        <h4>Reason for Return</h4>
        <p>${escapeHtml(rma.T30_02_Reason || '—')}</p>
        ${rma.T30_07_Notes ? `<h4>Notes</h4><p>${escapeHtml(rma.T30_07_Notes)}</p>` : ''}
      </div>
      <div class="meta-row" style="margin-top:16px"><span>RMA Status</span><span><strong>${escapeHtml(rma.T30_05_Status || 'Open')}</strong></span></div>
      ${rma.T30_06_Resolution ? `<div class="meta-row"><span>Resolution</span><span>${escapeHtml(rma.T30_06_Resolution)}</span></div>` : ''}
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`RMA ${rma.T30_01_RMA_Number}`, body));
  });

  app.get('/reports/packing-list-so/:id', async (req, res) => {
    const so = (await dbGet(`SELECT * FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [req.params.id]));
    if (!so) return res.status(404).send(page('Not Found', '<p class="empty-notice">Sales order not found.</p>'));

    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    const contact = await getContact(so.T07_PK);
    const shipTo = await getContact(so.T07_PK_SHIPTO);
    const ful = (await dbGet(`SELECT * FROM "T25_SO_Fulfillment" WHERE "T14_SO_PK" = ?`, [so.T14_SO_PK])) || {};
    const shipmentDocNumber = await getOrCreateShipmentDocNumber(so.T14_SO_PK);
    const srfNumber = await getSrfNumberForSO(so.T14_SO_PK);

    const lines = (await dbAll(`
      SELECT d.*, i."T11_01_Part_Number" as part_number, i."T11_03_Short_Description" as item_desc, i."T11_04_Long_Description" as item_long
      FROM "T15_SO_Details" d LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
      WHERE d."T14_SO_PK" = ?
    `, [so.T14_SO_PK]));

    const rowsHtml = lines.map(l => `<tr>
      <td>${escapeHtml(l.part_number ?? '')}</td>
      <td>${escapeHtml(l.item_desc || l.item_long || l.T11_Item_Master_PK)}</td>
      <td class="num">${Number(l.T15_01_Quantity) || 0}</td>
      <td>Ea</td>
    </tr>`).join('');

    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
        <div class="doc-title"><h1>Packing List</h1><div class="doc-number">PL No. ${escapeHtml(shipmentDocNumber)}${srfNumber ? ` &middot; SRF ${escapeHtml(srfNumber)}` : ''}</div></div>
      </div>
      <div class="meta-grid">
        <div class="meta-block">
          <h4>Consignee</h4>
          <div class="primary">${escapeHtml(contact?.name || '—')}</div>
          <div>${escapeHtml(contact?.company || '')}</div>
        </div>
        <div class="meta-block">
          <h4>Ship To</h4>
          <div class="primary">${escapeHtml((shipTo || contact)?.name || '—')}</div>
          <div>${escapeHtml((shipTo || contact)?.company || '')}</div>
        </div>
      </div>
      ${lines.length ? `
      <table class="items">
        <thead><tr><th>Item Code</th><th>Description</th><th class="num">Quantity</th><th>U.O.M</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${(ful.T25_12_Dimensions || ful.T25_13_WeightKg) ? `
      <div class="notes-block" style="margin-top:16px">
        <h4>Packing Information</h4>
        <div class="meta-row"><span>Total Weight</span><span>${ful.T25_13_WeightKg ? ful.T25_13_WeightKg + ' Kgs' : '—'}</span></div>
        <div class="meta-row"><span>Dimensions</span><span>${escapeHtml(ful.T25_12_Dimensions || '—')}</span></div>
      </div>
      ` : ''}
      ` : `<p class="empty-notice">No line items recorded for this order.</p>`}
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`Packing List ${shipmentDocNumber}`, body));
  });

  app.get('/reports/packing-list/:id', async (req, res) => {
    const req_ = (await dbGet(`SELECT * FROM "T27_Requisition" WHERE "T27_Requisition_ID" = ?`, [req.params.id]));
    if (!req_) return res.status(404).send(page('Not Found', '<p class="empty-notice">Requisition not found.</p>'));

    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    let ful = {};
    let soNumber = null;
    let soLines = [];
    if (req_.T14_SO_PK) {
      ful = (await dbGet(`SELECT * FROM "T25_SO_Fulfillment" WHERE "T14_SO_PK" = ?`, [req_.T14_SO_PK])) || {};
      const so = (await dbGet(`SELECT "T14_01_SO_Number" FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [req_.T14_SO_PK]));
      soNumber = so?.T14_01_SO_Number;
      soLines = (await dbAll(`
        SELECT d.*, i."T11_01_Part_Number" as partNumber, i."T11_03_Short_Description" as itemName
        FROM "T15_SO_Details" d LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
        WHERE d."T14_SO_PK" = ?
      `, [req_.T14_SO_PK]));
    }

    const rowsHtml = soLines.map(l => `<tr>
      <td>${escapeHtml(l.partNumber ?? '')}</td>
      <td>${escapeHtml(l.itemName || l.T11_Item_Master_PK)}</td>
      <td class="num">${Number(l.T15_01_Quantity) || 0}</td>
    </tr>`).join('');

    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
        <div class="doc-title"><h1>Stock Requisition</h1><div class="doc-number">${req_.T27_09_SRF_Number ? escapeHtml(req_.T27_09_SRF_Number) : 'Requisition #' + escapeHtml(String(req_.T27_Requisition_ID))}${soNumber ? ` &middot; SO #${escapeHtml(String(soNumber))}` : ''}</div></div>
      </div>
      <div class="meta-grid">
        <div class="meta-block">
          <h4>Requisition Details</h4>
          <div class="meta-row"><span>Type</span><span>${escapeHtml(req_.T27_01_Type || '—')}</span></div>
          <div class="meta-row"><span>Requesting Office</span><span>${escapeHtml(req_.T27_04_Requesting_Office || '—')}</span></div>
          <div class="meta-row"><span>Requested By</span><span>${escapeHtml(req_.T27_03_Requested_By || '—')}</span></div>
          <div class="meta-row"><span>Date Requested</span><span>${fmtDate(req_.T27_05_Date_Requested) || '—'}</span></div>
        </div>
        <div class="meta-block">
          <div class="meta-row"><span>Status</span><span>${escapeHtml(req_.T27_06_Status || 'Requested')}</span></div>
          <div class="meta-row"><span>Reviewed By</span><span>${escapeHtml(req_.T27_10_Reviewed_By || '—')}</span></div>
          <div class="meta-row"><span>Approved By</span><span>${escapeHtml(req_.T27_12_Approved_By || '—')}</span></div>
          <div class="meta-row"><span>HS Code</span><span>${escapeHtml(ful.T25_11_HSCode || '—')}</span></div>
        </div>
      </div>
      ${soLines.length ? `
      <table class="items">
        <thead><tr><th>Item Code</th><th>Description</th><th class="num">Quantity</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ` : `<p class="empty-notice">No Sales Order linked, or the order has no line items.</p>`}
      ${req_.T27_08_Notes ? `<div class="notes-block"><h4>Notes</h4><p>${escapeHtml(req_.T27_08_Notes)}</p></div>` : ''}
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`Stock Requisition ${req_.T27_09_SRF_Number || req_.T27_Requisition_ID}`, body));
  });

  app.get('/reports/delivery-note/:id', async (req, res) => {
    const so = (await dbGet(`SELECT * FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [req.params.id]));
    if (!so) return res.status(404).send(page('Not Found', '<p class="empty-notice">Sales order not found.</p>'));

    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    const contact = await getContact(so.T07_PK);
    const shipTo = await getContact(so.T07_PK_SHIPTO);
    const courier = await getCourier(so.T13_PK);
    const ful = (await dbGet(`SELECT * FROM "T25_SO_Fulfillment" WHERE "T14_SO_PK" = ?`, [so.T14_SO_PK])) || {};
    const srfNumber = await getSrfNumberForSO(so.T14_SO_PK);

    const lines = (await dbAll(`
      SELECT d.*, i."T11_01_Part_Number" as part_number, i."T11_03_Short_Description" as item_desc, i."T11_04_Long_Description" as item_long
      FROM "T15_SO_Details" d LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
      WHERE d."T14_SO_PK" = ?
    `, [so.T14_SO_PK]));

    // Serial numbers assigned to this specific sales order, grouped by item
    const serials = (await dbAll(`
      SELECT * FROM "T24_Serial_Numbers" WHERE "T14_SO_PK" = ?
    `, [so.T14_SO_PK]));
    const serialsByItem = {};
    serials.forEach(s => {
      if (!serialsByItem[s.T11_Item_Master_PK]) serialsByItem[s.T11_Item_Master_PK] = [];
      serialsByItem[s.T11_Item_Master_PK].push(s);
    });

    const rowsHtml = lines.map(l => {
      const itemSerials = serialsByItem[l.T11_Item_Master_PK] || [];
      const mainRow = `<tr>
        <td>${escapeHtml(l.part_number ?? '')}</td>
        <td>${escapeHtml(l.item_desc || l.item_long || l.T11_Item_Master_PK)}</td>
        <td class="num">${Number(l.T15_01_Quantity) || 0}</td>
      </tr>`;
      const serialRows = itemSerials.map(s => `<tr>
        <td></td>
        <td colspan="2" style="font-size:11px;color:#555;padding-left:16px;">
          S/N: <strong>${escapeHtml(s.T24_03_Serial_Number || '—')}</strong>
          ${s.T24_04_Warranty_Start || s.T24_05_Warranty_End ? ` &middot; Warranty: ${fmtDate(s.T24_04_Warranty_Start) || '—'} to ${fmtDate(s.T24_05_Warranty_End) || '—'}` : ''}
        </td>
      </tr>`).join('');
      return mainRow + serialRows;
    }).join('');

    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
        <div class="doc-title"><h1>Delivery Note</h1><div class="doc-number">SO #${escapeHtml(so.T14_01_SO_Number ?? '')}${srfNumber ? ` &middot; SRF ${escapeHtml(srfNumber)}` : ''}</div></div>
      </div>
      <div class="meta-grid">
        <div class="meta-block">
          <h4>Deliver To</h4>
          <div class="primary">${escapeHtml((shipTo || contact)?.name || '—')}</div>
          <div>${escapeHtml((shipTo || contact)?.company || '')}</div>
        </div>
        <div class="meta-block">
          <div class="meta-row"><span>Despatch Date</span><span>${fmtDate(so.T14_05_Despatch_Date) || '—'}</span></div>
          <div class="meta-row"><span>Courier</span><span>${escapeHtml(courier?.T13_01_Courier || '—')}</span></div>
          <div class="meta-row"><span>Tracking Number</span><span>${escapeHtml(ful.T25_22_TrackingNumber || '—')}</span></div>
          <div class="meta-row"><span>Weight / Dimensions</span><span>${ful.T25_13_WeightKg ? ful.T25_13_WeightKg + ' kg' : '—'} ${ful.T25_12_Dimensions ? '/ ' + escapeHtml(ful.T25_12_Dimensions) : ''}</span></div>
        </div>
      </div>
      ${lines.length ? `
      <table class="items">
        <thead><tr><th>Item Code</th><th>Description</th><th class="num">Qty Shipped</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ` : `<p class="empty-notice">No line items recorded for this order.</p>`}
      ${(ful.T25_27_Warranty_Duration || ful.T25_28_Warranty_Start || ful.T25_29_Warranty_End) ? `
      <div class="notes-block" style="margin-top:24px">
        <h4>Warranty Information</h4>
        <div class="meta-row"><span>Duration</span><span>${escapeHtml(ful.T25_27_Warranty_Duration || '—')}</span></div>
        <div class="meta-row"><span>Warranty Start</span><span>${fmtDate(ful.T25_28_Warranty_Start) || '—'}</span></div>
        <div class="meta-row"><span>Warranty End</span><span>${fmtDate(ful.T25_29_Warranty_End) || '—'}</span></div>
      </div>
      ` : ''}
      <div class="notes-block" style="margin-top:40px">
        <div style="display:flex;gap:60px">
          <div style="border-top:1px solid #ccc;width:220px;padding-top:4px;font-size:11px">Received in good condition — Signature</div>
          <div style="border-top:1px solid #ccc;width:140px;padding-top:4px;font-size:11px">Date</div>
        </div>
      </div>
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`Delivery Note ${so.T14_01_SO_Number ?? ''}`, body));
  });

  // ---------- Purchase Order ----------
  app.get('/reports/purchase-order/:id', async (req, res) => {
    const po = (await dbGet(`SELECT * FROM "T17_Purchase_Orders" WHERE "T17_PO_PK" = ?`, [req.params.id]));
    if (!po) return res.status(404).send(page('Not Found', '<p class="empty-notice">Purchase order not found.</p>'));

    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    const supplier = await getContact(po.T07_PK);
    const employee = await getEmployee(po.T05_Employee_PK);
    const courier = await getCourier(po.T13_PK);

    const lines = (await dbAll(`
      SELECT d.*, i."T11_03_Short_Description" as item_desc, i."T11_04_Long_Description" as item_long
      FROM "T18_PO_Details" d
      LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
      WHERE d."T17_PO_PK" = ?
    `, [po.T17_PO_PK]));

    let subtotal = 0;
    const rowsHtml = lines.map(l => {
      const qty = Number(l.T18_01_Quantity) || 0;
      const price = Number(l.T18_02_Price) || 0;
      const lineTotal = qty * price;
      subtotal += lineTotal;
      return `<tr>
        <td>${escapeHtml(l.item_desc || l.item_long || l.T11_Item_Master_PK)}</td>
        <td class="num">${qty}</td>
        <td class="num">${fmtMoney(price)}</td>
        <td class="num">${fmtMoney(lineTotal)}</td>
      </tr>`;
    }).join('');

    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div>
          <div class="company-name">${escapeHtml(yc.name)}</div>
          <div class="company-details">${detailsParts}</div>
        </div></div>
        <div class="doc-title">
          <h1>Purchase Order</h1>
          <div class="doc-number">PO #${escapeHtml(po.T17_01_PO_Number ?? '')}</div>
        </div>
      </div>
      <div class="meta-grid">
        <div class="meta-block">
          <h4>Supplier</h4>
          <div class="primary">${escapeHtml(supplier?.name || '—')}</div>
          <div>${escapeHtml(supplier?.company || '')}</div>
          <div>${escapeHtml(supplier?.email || '')} ${supplier?.phone ? ' &middot; ' + escapeHtml(supplier.phone) : ''}</div>
        </div>
        <div class="meta-block">
          <div class="meta-row"><span>PO Date</span><span>${fmtDate(po.T17_02_PO_Date)}</span></div>
          <div class="meta-row"><span>Due Date</span><span>${fmtDate(po.T17_04_Due_Date)}</span></div>
          <div class="meta-row"><span>Received Date</span><span>${fmtDate(po.T17_03_Received_Date)}</span></div>
          <div class="meta-row"><span>Raised By</span><span>${escapeHtml(employee?.name || '—')}</span></div>
          <div class="meta-row"><span>Courier</span><span>${escapeHtml(courier?.T13_01_Courier || '—')}</span></div>
        </div>
      </div>
      ${lines.length ? `
      <table class="items">
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Line Total</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="totals">
        <table><tr class="grand"><td>Total</td><td>${fmtMoney(subtotal)}</td></tr></table>
        <div class="amount-words">${escapeHtml(amountInWords(subtotal))}</div>
      </div>
      ` : `<p class="empty-notice">No line items recorded for this purchase order.</p>`}
      ${po.T17_05_Notes ? `<div class="notes-block"><h4>Notes</h4><p>${escapeHtml(po.T17_05_Notes)}</p></div>` : ''}
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`Purchase Order ${po.T17_01_PO_Number ?? ''}`, body));
  });

  // ---------- Quote (Simple) — totals only, no per-tier pricing ----------
  app.get('/reports/quote-simple/:id', async (req, res) => {
    const so = (await dbGet(`SELECT * FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [req.params.id]));
    if (!so) return res.status(404).send(page('Not Found', '<p class="empty-notice">Sales order not found.</p>'));
    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    const contact = await getContact(so.T07_PK);
    const currency = await getCurrency(so.T22_Currency_ID);
    const symbol = currency?.T22_02_Symbol || '';
    const convRate = Number(so.T14_15_Conversion_Rate) || 1;
    const lines = (await dbAll(`
      SELECT d.*, i."T11_03_Short_Description" as item_desc
      FROM "T15_SO_Details" d LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
      WHERE d."T14_SO_PK" = ?
    `, [so.T14_SO_PK]));
    let subtotal = 0;
    const rowsHtml = lines.map(l => {
      const qty = Number(l.T15_01_Quantity) || 0;
      const unitPrice = (Number(l.T15_02_Price) || 0) * convRate;
      const lineTotal = qty * unitPrice;
      subtotal += lineTotal;
      return `<tr><td>${escapeHtml(l.item_desc || l.T11_Item_Master_PK)}</td><td class="num">${qty}</td><td class="num">${symbol}${fmtMoney(unitPrice)}</td><td class="num">${symbol}${fmtMoney(lineTotal)}</td></tr>`;
    }).join('');
    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
        <div class="doc-title"><h1>Quotation</h1><div class="doc-number">SO #${escapeHtml(so.T14_01_SO_Number ?? '')}</div></div>
      </div>
      <div class="meta-block"><h4>Quote For</h4><div class="primary">${escapeHtml(contact?.name || '—')}</div><div>${escapeHtml(contact?.company || '')}</div></div>
      ${lines.length ? `<table class="items"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <div class="totals"><table><tr class="grand"><td>Total</td><td>${symbol}${fmtMoney(subtotal)}</td></tr></table><div class="amount-words">${escapeHtml(amountInWords(subtotal, currency?.T22_01_Currency))}</div></div>`
      : `<p class="empty-notice">No line items recorded for this quote.</p>`}
      <div class="footer">Quote valid 30 days &middot; Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`Quote (Simple) ${so.T14_01_SO_Number ?? ''}`, body));
  });

  // ---------- Quote (Extended) — shows Retail / Trade / OEM price tiers ----------
  app.get('/reports/quote-extended/:id', async (req, res) => {
    const so = (await dbGet(`SELECT * FROM "T14_Sales_Orders" WHERE "T14_SO_PK" = ?`, [req.params.id]));
    if (!so) return res.status(404).send(page('Not Found', '<p class="empty-notice">Sales order not found.</p>'));
    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    const contact = await getContact(so.T07_PK);
    const currency = await getCurrency(so.T22_Currency_ID);
    const symbol = currency?.T22_02_Symbol || '';
    const convRate = Number(so.T14_15_Conversion_Rate) || 1;
    const lines = (await dbAll(`
      SELECT d.*, i."T11_01_Part_Number" as part_number, i."T11_03_Short_Description" as item_desc,
             i."T11_09_List_Price" as retail, i."T11_10_Trade_Price" as trade, i."T11_11_OEM_Price" as oem
      FROM "T15_SO_Details" d LEFT JOIN "T11_Item_Master" i ON i."T11_Item_Master_PK" = d."T11_Item_Master_PK"
      WHERE d."T14_SO_PK" = ?
    `, [so.T14_SO_PK]));
    let subtotal = 0;
    const rowsHtml = lines.map(l => {
      const qty = Number(l.T15_01_Quantity) || 0;
      const unitPrice = (Number(l.T15_02_Price) || 0) * convRate;
      const lineTotal = qty * unitPrice;
      subtotal += lineTotal;
      return `<tr>
        <td>${escapeHtml(l.part_number ?? '')}</td>
        <td>${escapeHtml(l.item_desc || l.T11_Item_Master_PK)}</td>
        <td class="num">${qty}</td>
        <td class="num">${symbol}${fmtMoney(l.retail)}</td>
        <td class="num">${symbol}${fmtMoney(l.trade)}</td>
        <td class="num">${symbol}${fmtMoney(l.oem)}</td>
        <td class="num">${symbol}${fmtMoney(unitPrice)}</td>
        <td class="num">${symbol}${fmtMoney(lineTotal)}</td>
      </tr>`;
    }).join('');
    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
        <div class="doc-title"><h1>Quotation (Extended)</h1><div class="doc-number">SO #${escapeHtml(so.T14_01_SO_Number ?? '')}</div></div>
      </div>
      <div class="meta-block"><h4>Quote For</h4><div class="primary">${escapeHtml(contact?.name || '—')}</div><div>${escapeHtml(contact?.company || '')}</div></div>
      ${lines.length ? `<table class="items"><thead><tr><th>Item Code</th><th>Description</th><th class="num">Qty</th><th class="num">Retail</th><th class="num">Trade</th><th class="num">OEM</th><th class="num">Unit Price</th><th class="num">Total</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <div class="totals"><table><tr class="grand"><td>Total</td><td>${symbol}${fmtMoney(subtotal)}</td></tr></table><div class="amount-words">${escapeHtml(amountInWords(subtotal, currency?.T22_01_Currency))}</div></div>`
      : `<p class="empty-notice">No line items recorded for this quote.</p>`}
      <div class="footer">Quote valid 30 days &middot; Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`Quote (Extended) ${so.T14_01_SO_Number ?? ''}`, body));
  });

  // ---------- Quotation ----------
  app.get('/reports/quotation/:id', async (req, res) => {
    const q = (await dbGet(`SELECT * FROM "T20_Quotations" WHERE "T20_Quotation_ID" = ?`, [req.params.id]));
    if (!q) return res.status(404).send(page('Not Found', '<p class="empty-notice">Quotation not found.</p>'));
    const { yc, detailsParts, logoHtml } = await letterheadHtml();
    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div>
          <div class="company-name">${escapeHtml(yc.name)}</div>
          <div class="company-details">${detailsParts}</div>
        </div></div>
        <div class="doc-title">
          <h1>Quotation</h1>
          <div class="doc-number">Quote #${escapeHtml(q.T20_Quotation_ID ?? '')}</div>
        </div>
      </div>
      <div class="notes-block">
        <p>${escapeHtml(q.T20_01_Quotation || '').replace(/\n/g, '<br>')}</p>
      </div>
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()}</div>
    `;
    res.send(page(`Quotation ${q.T20_Quotation_ID ?? ''}`, body));
  });

  // ---------- Item Catalog / Price List ----------
  app.get('/reports/item-catalog', async (req, res) => {
    const items = (await dbAll(`
      SELECT i.*, c."T12_01_Category" as category_name
      FROM "T11_Item_Master" i
      LEFT JOIN "T12_Category" c ON c."T12_Category_PK" = i."T12_Category_PK"
      WHERE i."T11_12_Obsolete" = 0
        AND (COALESCE(i."T11_09_List_Price",0) <> 0 OR COALESCE(i."T11_10_Trade_Price",0) <> 0 OR COALESCE(i."T11_11_OEM_Price",0) <> 0)
      ORDER BY category_name, i."T11_01_Part_Number"
    `));

    const { yc, detailsParts, logoHtml } = await letterheadHtml();

    if (!items.length) {
      return res.send(page('Item Catalog', `
        <div class="letterhead">
          <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
          <div class="doc-title"><h1>Item Catalog</h1></div>
        </div>
        <p class="empty-notice">No items recorded yet.</p>
      `));
    }

    // group by category
    const groups = {};
    items.forEach(it => {
      const cat = it.category_name || 'Uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(it);
    });

    let bodyRows = '';
    for (const [cat, list] of Object.entries(groups)) {
      bodyRows += `<tr><td colspan="4" style="font-family:'Inter',sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;padding-top:16px;border-bottom:2px solid #1a1a1a;">${escapeHtml(cat)}</td></tr>`;
      list.forEach(it => {
        bodyRows += `<tr>
          <td>${escapeHtml(it.T11_01_Part_Number ?? '')}</td>
          <td>${escapeHtml(it.T11_03_Short_Description || it.T11_04_Long_Description || '')}</td>
          <td class="num">${fmtMoney(it.T11_09_List_Price)}</td>
          <td class="num">${it.T11_06_Qty_OH ?? 0}</td>
        </tr>`;
      });
    }

    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
        <div class="doc-title"><h1>Item Catalog</h1></div>
      </div>
      <table class="items">
        <thead><tr><th>Item Code</th><th>Description</th><th class="num">List Price</th><th class="num">Qty On Hand</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()} &middot; ${items.length} items</div>
    `;
    res.send(page('Item Catalog', body));
  });

  // ---------- Company / Contact Directory ----------
  app.get('/reports/directory', async (req, res) => {
    const companies = (await dbAll(`SELECT * FROM "T01_Company" ORDER BY "T01_01_Company_Name"`));
    const { yc, detailsParts, logoHtml } = await letterheadHtml();

    if (!companies.length) {
      return res.send(page('Company Directory', `
        <div class="letterhead">
          <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
          <div class="doc-title"><h1>Directory</h1></div>
        </div>
        <p class="empty-notice">No companies recorded yet.</p>
      `));
    }

    let rows = '';
    for (const comp of companies) {
      const contacts = (await dbAll(`SELECT * FROM "T07_Contacts" WHERE "T01_PK" = ?`, [comp.T01_PK]));
      let city = '';
      if (comp.T02_City_PK) {
        const c = (await dbGet(`SELECT * FROM "T02_CityStatePCode" WHERE "T02_City_PK" = ?`, [comp.T02_City_PK]));
        if (c) city = [c.T02_1_City, c.T02_2_State].filter(Boolean).join(', ');
      }
      rows += `<tr><td colspan="3" style="font-family:'Inter',sans-serif;font-weight:700;font-size:13px;padding-top:18px;border-bottom:2px solid #1a1a1a;">
        ${escapeHtml(comp.T01_01_Company_Name)} ${city ? `<span style="font-weight:400;color:#666;font-size:11px;"> — ${escapeHtml(city)}</span>` : ''}
      </td></tr>`;
      if (contacts.length === 0) {
        rows += `<tr><td colspan="3" style="color:#999;font-style:italic;padding-left:12px;">No contacts on file</td></tr>`;
      } else {
        contacts.forEach(ct => {
          rows += `<tr>
            <td style="padding-left:12px;">${escapeHtml([ct.T07_01_Forename, ct.T07_02_Surname].filter(Boolean).join(' '))} ${ct.T07_12_Title ? `<span style="color:#999;">(${escapeHtml(ct.T07_12_Title)})</span>` : ''}</td>
            <td>${escapeHtml(ct.T07_05_Email || '')}</td>
            <td>${escapeHtml(ct.T07_03_Phone || ct.T07_07_Mobile || '')}</td>
          </tr>`;
        });
      }
    }

    const body = `
      <div class="letterhead">
        <div class="letterhead-brand">${logoHtml}<div><div class="company-name">${escapeHtml(yc.name)}</div><div class="company-details">${detailsParts}</div></div></div>
        <div class="doc-title"><h1>Directory</h1></div>
      </div>
      <table class="items">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="footer">Generated from Nexora &middot; ${new Date().toLocaleDateString()} &middot; ${companies.length} companies</div>
    `;
    res.send(page('Company Directory', body));
  });
}

module.exports = { registerReportRoutes, BASE_STYLE, page, escapeHtml, fmtDate, fmtMoney, amountInWords };
