/**
 * 資產追蹤器 — Google 試算表後端 (Apps Script)
 * ------------------------------------------------
 * 部署方式：
 * 1. 開一份新的 Google 試算表
 * 2. 選單「擴充功能」→「Apps Script」，把這個檔案內容整份貼進去（取代預設內容）
 * 3. 把這份程式碼存檔
 * 4. 執行一次 setupSheets() 函式（上方選 setupSheets → 按執行▶），
 *    它會自動幫你在試算表建立 assets / snapshots 兩個工作表並填好標題列
 * 5. 選單右上角「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *    - 執行身分：我
 *    - 具有存取權的使用者：任何人
 *    部署後會拿到一個網址，複製起來貼到 App.jsx 的 SHEETS_API_URL
 */


const SHEET_ASSETS = "assets";
const SHEET_SNAPSHOTS = "snapshots";
const SHEET_BILL_TEMPLATES = "bill_templates";
const SHEET_BILLS = "bills";
const SHEET_EXPENSE_CATEGORIES = "expense_categories";
const SHEET_EXPENSES = "expenses";
const SHEET_TODOS = "todos";

const ASSET_HEADERS = ["id","name","bank","account","category","quantity","original_value","currency","value","owner","sort_order"];
const SNAPSHOT_HEADERS = ["id","total_value","bank_breakdown","category_breakdown","fx_rates","taken_at","note"];
const BILL_TEMPLATE_HEADERS = ["id","name","category","note","sort_order","active","due_day","auto_debit","frequency"];
const BILL_HEADERS = ["id","template_id","name","month","amount","paid","due_day","paid_date","note","auto_debit"];
const EXPENSE_CATEGORY_HEADERS = ["id","name","sort_order","active"];
const EXPENSE_HEADERS = ["id","date","category","amount","payment_method","note"];
const TODO_HEADERS = ["id","content","done","created_at","completed_at"];
// done 為布林值；created_at 為新增當下的 ISO 時間，completed_at 為標記完成當下的 ISO 時間（未完成則空白）
const JSON_FIELDS = ["bank_breakdown","category_breakdown","fx_rates"];
const NUMERIC_FIELDS = ["original_value","value","sort_order","amount","total_value","due_day"];
// 這幾欄存的是「YYYY-MM」或「YYYY-MM-DD」文字，長得很像日期，Google 試算表會自動把它們轉成日期格式儲存，
// 導致之後用文字比對（例如篩選月份）會對不起來，所以寫入時強制用純文字格式儲存
const DATE_TEXT_FIELDS = ["month","date","paid_date"];
// 注意：quantity 欄位本身是「數字+單位」的文字（例如 "1000股"），不強制轉數字
// frequency: "monthly"(每月固定) 或 "irregular"(不定期)；active/auto_debit/paid 為布林值
// payment_method: "現金"/"行動支付"/"刷卡"/"禮券"

// ── 初始化：第一次使用時手動執行一次 ─────────────────────────────
// ── 一次性清理工具：清掉同一個範本、同一個月重複產生的帳單 ────────────
// 用法：在 Apps Script 編輯器上方函式下拉選單選 cleanupDuplicateBills，
// 按執行▶（第一次可能要授權），跑完後點「執行項目」或看 Logger 記錄確認刪了幾筆。
// 同一組 template_id + month，只保留「金額不是 0 的那一筆」；
// 如果全部都是 0，保留最早新增的那一筆（其餘刪除）。
function cleanupDuplicateBills() {
  const sheet = getSheet(SHEET_BILLS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log("沒有資料"); return; }
  const values = sheet.getRange(2, 1, lastRow - 1, BILL_HEADERS.length).getValues();

  const idxId = BILL_HEADERS.indexOf("id");
  const idxTpl = BILL_HEADERS.indexOf("template_id");
  const idxMonth = BILL_HEADERS.indexOf("month");
  const idxAmount = BILL_HEADERS.indexOf("amount");

  const groups = {}; // key: template_id::month -> [{rowNumber, amount}]
  values.forEach((row, i) => {
    const tpl = row[idxTpl];
    const month = row[idxMonth];
    if (!tpl || !month) return; // 沒綁範本的（例如手動新增的不定期帳單）不處理
    const key = tpl + "::" + month;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ rowNumber: i + 2, amount: Number(row[idxAmount]) || 0 });
  });

  const rowsToDelete = [];
  Object.values(groups).forEach(list => {
    if (list.length <= 1) return;
    const nonZero = list.filter(r => r.amount !== 0);
    const keep = (nonZero.length > 0 ? nonZero : list)[0].rowNumber;
    list.forEach(r => { if (r.rowNumber !== keep) rowsToDelete.push(r.rowNumber); });
  });

  // 由大到小刪除，避免刪除過程中列號跑掉
  rowsToDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  Logger.log("刪除了 " + rowsToDelete.length + " 筆重複帳單");
}

// 把某個工作表指定欄位（整欄）設成純文字格式，避免 Google 試算表自動把看起來像日期的文字轉成日期型別
function setColumnAsPlainText(sheet, headers, fieldName) {
  const colIndex = headers.indexOf(fieldName) + 1; // 1-based
  if (colIndex < 1) return;
  sheet.getRange(1, colIndex, sheet.getMaxRows(), 1).setNumberFormat("@");
}

// ── 一次性修復工具：把 bills.month / bills.paid_date / expenses.date 這幾欄，
// 之前不小心被 Google 試算表自動轉成「日期格式」的舊資料，轉回正確的純文字（例如 "2026-08"），
// 並把整欄改成純文字格式，避免以後又被自動轉型。
// 用法：在 Apps Script 編輯器上方函式下拉選單選 fixDateTextFields，按執行▶（第一次可能要授權），跑完即可。
// 這個函式可以放心重複執行，已經是純文字的欄位不會被誤改。
function fixDateTextFields() {
  let fixed = 0;
  fixed += fixColumnDateValues(SHEET_BILLS, BILL_HEADERS, "month", "yyyy-MM");
  fixed += fixColumnDateValues(SHEET_BILLS, BILL_HEADERS, "paid_date", "yyyy-MM-dd");
  fixed += fixColumnDateValues(SHEET_EXPENSES, EXPENSE_HEADERS, "date", "yyyy-MM-dd");
  Logger.log("修復完成，共修正 " + fixed + " 個被誤判成日期格式的儲存格");
}

function fixColumnDateValues(sheetName, headers, fieldName, dateFormat) {
  const sheet = getSheet(sheetName);
  const colIndex = headers.indexOf(fieldName) + 1; // 1-based
  if (colIndex < 1) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { setColumnAsPlainText(sheet, headers, fieldName); return 0; }

  const range = sheet.getRange(2, colIndex, lastRow - 1, 1);
  const values = range.getValues();
  let fixedCount = 0;
  const newValues = values.map(row => {
    const v = row[0];
    if (Object.prototype.toString.call(v) === "[object Date]") {
      fixedCount++;
      return [Utilities.formatDate(v, Session.getScriptTimeZone(), dateFormat)];
    }
    return [v];
  });

  setColumnAsPlainText(sheet, headers, fieldName); // 先把整欄改成純文字格式，避免寫回去又被轉型
  range.setValues(newValues);
  return fixedCount;
}

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
    setColumnAsPlainText(sheet, BILL_HEADERS, "month");
    setColumnAsPlainText(sheet, BILL_HEADERS, "paid_date");
  }
  if (!ss.getSheetByName(SHEET_EXPENSE_CATEGORIES)) {
    const sheet = ss.insertSheet(SHEET_EXPENSE_CATEGORIES);
    sheet.appendRow(EXPENSE_CATEGORY_HEADERS);
  }
  if (!ss.getSheetByName(SHEET_EXPENSES)) {
    const sheet = ss.insertSheet(SHEET_EXPENSES);
    sheet.appendRow(EXPENSE_HEADERS);
    setColumnAsPlainText(sheet, EXPENSE_HEADERS, "date");
  }
  if (!ss.getSheetByName(SHEET_TODOS)) {
    const sheet = ss.insertSheet(SHEET_TODOS);
    sheet.appendRow(TODO_HEADERS);
  }
}

// ── HTTP 入口 ─────────────────────────────────────────────────
// 讀取整批資料（list）的結果快取 60 秒；新增/修改/刪除任何資料時會主動清掉，
// 所以不會有「改了看不到最新資料」的問題，純粹只是加速重複讀取
const LIST_CACHE_KEY = "list_response_v1";
const LIST_CACHE_TTL_SECONDS = 60;

function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === "list") {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(LIST_CACHE_KEY);
      if (cached) {
        // 命中快取：完全不用碰試算表，直接回傳，速度差非常多
        return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
      }

      const ss = SpreadsheetApp.getActiveSpreadsheet(); // 只開一次試算表，7 張表共用同一個參照
      const data = {
        assets: readSheet(ss, SHEET_ASSETS, ASSET_HEADERS),
        snapshots: readSheet(ss, SHEET_SNAPSHOTS, SNAPSHOT_HEADERS),
        bill_templates: readSheet(ss, SHEET_BILL_TEMPLATES, BILL_TEMPLATE_HEADERS),
        bills: readSheet(ss, SHEET_BILLS, BILL_HEADERS),
        expense_categories: readSheet(ss, SHEET_EXPENSE_CATEGORIES, EXPENSE_CATEGORY_HEADERS),
        expenses: readSheet(ss, SHEET_EXPENSES, EXPENSE_HEADERS),
        todos: readSheet(ss, SHEET_TODOS, TODO_HEADERS),
      };
      const jsonStr = JSON.stringify(data);
      try {
        // CacheService 單一項目上限 100KB，資料量大到超過就存不進去，
        // 存失敗不影響功能，只是這次沒被快取到而已，所以用 try/catch 包起來忽略錯誤
        cache.put(LIST_CACHE_KEY, jsonStr, LIST_CACHE_TTL_SECONDS);
      } catch (cacheErr) {}
      return ContentService.createTextOutput(jsonStr).setMimeType(ContentService.MimeType.JSON);
    }
    return json({ error: "unknown action: " + action });
  } catch (err) {
    return json({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

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
      case "addExpenseCategory":
        result = addRow(SHEET_EXPENSE_CATEGORIES, EXPENSE_CATEGORY_HEADERS, body.payload);
        break;
      case "deleteExpenseCategory":
        result = deleteRow(SHEET_EXPENSE_CATEGORIES, body.id);
        break;
      case "addExpense":
        result = addRow(SHEET_EXPENSES, EXPENSE_HEADERS, body.payload);
        break;
      case "updateExpense":
        result = updateRow(SHEET_EXPENSES, EXPENSE_HEADERS, body.id, body.payload);
        break;
      case "deleteExpense":
        result = deleteRow(SHEET_EXPENSES, body.id);
        break;
      case "addTodo":
        result = addRow(SHEET_TODOS, TODO_HEADERS, body.payload);
        break;
      case "updateTodo":
        result = updateRow(SHEET_TODOS, TODO_HEADERS, body.id, body.payload);
        break;
      case "deleteTodo":
        result = deleteRow(SHEET_TODOS, body.id);
        break;
      default:
        return json({ error: "unknown action: " + body.action });
    }
    CacheService.getScriptCache().remove(LIST_CACHE_KEY); // 資料異動了，清掉讀取快取，下次讀取一定拿到最新資料
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

function readSheet(ss, name, headers) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error("找不到工作表：" + name + "，請先執行 setupSheets()");
  const data = sheet.getDataRange().getValues(); // 一次讀整張表（含標題列），比「算最後一列」+「讀取範圍」少一次服務呼叫
  if (data.length < 2) return [];
  return data.slice(1)
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
  if (DATE_TEXT_FIELDS.indexOf(h) !== -1 && v) return "'" + v; // 前面加一撇強制存成純文字，避免被試算表誤判成日期型別
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