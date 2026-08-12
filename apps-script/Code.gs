/**
 * 資產追蹤器 — Google 試算表後端 (Apps Script)
 * ------------------------------------------------
 * 部署方式：
 * 1. 開一份新的 Google 試算表
 * 2. 選單「擴充功能」→「Apps Script」，把這個檔案內容整份貼進去（取代預設內容）
 * 3. 把下面的 TOKEN 改成你自己的密碼字串（隨便打一串，只要跟前端 App.jsx 裡設定的一樣即可）
 * 4. 執行一次 setupSheets() 函式（上方選 setupSheets → 按執行▶），
 *    它會自動幫你在試算表建立 assets / snapshots 兩個工作表並填好標題列
 * 5. 選單右上角「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *    - 執行身分：我
 *    - 具有存取權的使用者：任何人
 *    部署後會拿到一個網址，複製起來貼到 App.jsx 的 SHEETS_API_URL
 */

const TOKEN = "請改成你自己的密碼";

const SHEET_ASSETS = "assets";
const SHEET_SNAPSHOTS = "snapshots";
const SHEET_BILL_TEMPLATES = "bill_templates";
const SHEET_BILLS = "bills";

const ASSET_HEADERS = ["id","name","bank","account","category","quantity","original_value","currency","value","owner","sort_order"];
const SNAPSHOT_HEADERS = ["id","total_value","bank_breakdown","category_breakdown","fx_rates","taken_at","note"];
const BILL_TEMPLATE_HEADERS = ["id","name","category","note","sort_order","active","due_day","auto_debit","frequency"];
const BILL_HEADERS = ["id","template_id","name","month","amount","paid","due_day","paid_date","note","auto_debit"];
const JSON_FIELDS = ["bank_breakdown","category_breakdown","fx_rates"];
const NUMERIC_FIELDS = ["original_value","value","sort_order","amount","total_value","due_day"];
// 注意：quantity 欄位本身是「數字+單位」的文字（例如 "1000股"），不強制轉數字
// frequency: "monthly"(每月固定) 或 "irregular"(不定期)；active/auto_debit/paid 為布林值

// ── 初始化：第一次使用時手動執行一次 ─────────────────────────────
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_ASSETS)) {
    const sheet = ss.insertSheet(SHEET_ASSETS);
    sheet.appendRow(ASSET_HEADERS);
  }
  if (!ss.getSheetByName(SHEET_SNAPSHOTS)) {
    const sheet = ss.insertSheet(SHEET_SNAPSHOTS);
    sheet.appendRow(SNAPSHOT_HEADERS);
  }
  if (!ss.getSheetByName(SHEET_BILL_TEMPLATES)) {
    const sheet = ss.insertSheet(SHEET_BILL_TEMPLATES);
    sheet.appendRow(BILL_TEMPLATE_HEADERS);
  }
  if (!ss.getSheetByName(SHEET_BILLS)) {
    const sheet = ss.insertSheet(SHEET_BILLS);
    sheet.appendRow(BILL_HEADERS);
  }
}

// ── HTTP 入口 ─────────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === "list") {
      return json({
        assets: readSheet(SHEET_ASSETS, ASSET_HEADERS),
        snapshots: readSheet(SHEET_SNAPSHOTS, SNAPSHOT_HEADERS),
        bill_templates: readSheet(SHEET_BILL_TEMPLATES, BILL_TEMPLATE_HEADERS),
        bills: readSheet(SHEET_BILLS, BILL_HEADERS),
      });
    }
    return json({ error: "unknown action: " + action });
  } catch (err) {
    return json({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) return json({ error: "unauthorized" });

    let result;
    switch (body.action) {
      case "addAsset":
        result = addRow(SHEET_ASSETS, ASSET_HEADERS, body.payload);
        break;
      case "updateAsset":
        result = updateRow(SHEET_ASSETS, ASSET_HEADERS, body.id, body.payload);
        break;
      case "deleteAsset":
        result = deleteRow(SHEET_ASSETS, body.id);
        break;
      case "addSnapshot":
        result = addRow(SHEET_SNAPSHOTS, SNAPSHOT_HEADERS, body.payload);
        break;
      case "deleteSnapshot":
        result = deleteRow(SHEET_SNAPSHOTS, body.id);
        break;
      case "addBillTemplate":
        result = addRow(SHEET_BILL_TEMPLATES, BILL_TEMPLATE_HEADERS, body.payload);
        break;
      case "updateBillTemplate":
        result = updateRow(SHEET_BILL_TEMPLATES, BILL_TEMPLATE_HEADERS, body.id, body.payload);
        break;
      case "deleteBillTemplate":
        result = deleteRow(SHEET_BILL_TEMPLATES, body.id);
        break;
      case "addBill":
        result = addRow(SHEET_BILLS, BILL_HEADERS, body.payload);
        break;
      case "updateBill":
        result = updateRow(SHEET_BILLS, BILL_HEADERS, body.id, body.payload);
        break;
      case "deleteBill":
        result = deleteRow(SHEET_BILLS, body.id);
        break;
      default:
        return json({ error: "unknown action: " + body.action });
    }
    return json(result);
  } catch (err) {
    return json({ error: String(err) });
  }
}

// ── 工作表存取共用函式 ────────────────────────────────────────
function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("找不到工作表：" + name + "，請先執行 setupSheets()");
  return sheet;
}

function readSheet(name, headers) {
  const sheet = getSheet(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .filter(row => row[0] !== "" && row[0] !== null)
    .map(row => rowToObj(headers, row));
}

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    let v = row[i];
    if (JSON_FIELDS.indexOf(h) !== -1) {
      if (typeof v === "string" && v) {
        try { v = JSON.parse(v); } catch (e) { v = {}; }
      } else if (!v) {
        v = {};
      }
    } else if (NUMERIC_FIELDS.indexOf(h) !== -1) {
      if (v === "" || v === null || v === undefined) {
        v = 0;
      } else {
        const n = Number(v);
        v = isNaN(n) ? 0 : n;
      }
    }
    obj[h] = v;
  });
  return obj;
}

function serializeField(h, v) {
  if (JSON_FIELDS.indexOf(h) !== -1) return v ? JSON.stringify(v) : "";
  return (v === undefined || v === null) ? "" : v;
}

function findRowIndexById(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // 實際列號（含標題列）
  }
  return -1;
}

function addRow(name, headers, payload) {
  const sheet = getSheet(name);
  const id = Utilities.getUuid();
  const record = Object.assign({}, payload, { id: id });
  const row = headers.map(h => serializeField(h, record[h]));
  sheet.appendRow(row);
  return record;
}

function updateRow(name, headers, id, payload) {
  const sheet = getSheet(name);
  const rowIndex = findRowIndexById(sheet, id);
  if (rowIndex === -1) throw new Error("找不到 id：" + id);
  const existingRow = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const existing = rowToObj(headers, existingRow);
  const record = Object.assign({}, existing, payload, { id: id });
  const row = headers.map(h => serializeField(h, record[h]));
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  return record;
}

function deleteRow(name, id) {
  const sheet = getSheet(name);
  const rowIndex = findRowIndexById(sheet, id);
  if (rowIndex === -1) throw new Error("找不到 id：" + id);
  sheet.deleteRow(rowIndex);
  return { deleted: true, id: id };
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
