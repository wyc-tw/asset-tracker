import { useState, useMemo, useEffect, useCallback, Fragment } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

// ── Google 試算表後端設定 ──────────────────────────────────────
// 網址不寫在程式碼裡，改成執行時讓使用者輸入，存在瀏覽器的 localStorage
// （只留在使用者自己的裝置上，不會出現在原始碼或打包後的檔案裡）
// 安全性靠這組網址本身的隨機性保護（Apps Script 網址包含一長串無法猜測的 ID），
// 沒有另外用密碼驗證，所以請不要把這組網址分享給不信任的人。
let SHEETS_API_URL = (typeof localStorage!=="undefined" && localStorage.getItem("sheets_api_url")) || "";

const DATA_CACHE_KEY = "asset_tracker_data_cache_v1";

function setSheetsConfig(url) {
  SHEETS_API_URL = (url||"").trim();
  localStorage.setItem("sheets_api_url", SHEETS_API_URL);
}
function clearSheetsConfig() {
  SHEETS_API_URL = "";
  localStorage.removeItem("sheets_api_url");
  localStorage.removeItem(DATA_CACHE_KEY);
}

async function apiGet(action, params={}) {
  const qs = new URLSearchParams({action, ...params}).toString();
  const res = await fetch(`${SHEETS_API_URL}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
async function apiPost(body) {
  const res = await fetch(SHEETS_API_URL, {
    method: "POST",
    // 用 text/plain 避免瀏覽器發送 CORS 預檢請求（Apps Script 不會回應 OPTIONS）
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

const FX_API = "https://api.exchangerate-api.com/v4/latest/TWD";

const SUPPORTED_CURRENCIES = ["TWD","USD","JPY"];
const CURRENCY_LABELS = { TWD:"台幣",USD:"美金",JPY:"日圓" };

const BANK_COLORS = {
  "郵局":"#FF6B6B","星展":"#FF8E53","永豐(個人)":"#4ECDC4",
  "台新":"#A78BFA","玉山":"#34D399","中國信託":"#F59E0B",
  "富邦":"#60A5FA","國泰":"#F472B6","永豐(共有)":"#2DD4BF",
};
const ACCT_COLORS = {
  "存款帳戶":"#34D399","證券帳戶":"#F87171","基金/其他":"#FBBF24",
};
const EXPENSE_PALETTE = ["#F87171","#60A5FA","#34D399","#FBBF24","#A78BFA","#F472B6","#2DD4BF","#FB923C","#818CF8","#4ADE80"];
const PAYMENT_METHODS = ["現金","信用卡","行動支付","悠遊卡","禮券"];
const COMMON_EXPENSE_CATEGORIES = ["餐食","購物","家用","交通","玩樂","帳單","投資","其他"];
const EXPENSE_CATEGORY_ICONS = {
  "餐食":"🍽️","購物":"🛍️","家用":"🏠","交通":"🚗","玩樂":"🎉","帳單":"🧾","投資":"📈","其他":"📦",
};
const expenseCatIcon = (name)=>EXPENSE_CATEGORY_ICONS[name]||"🏷️";
const CAT_COLORS = {
  "台股":"#F87171","美股":"#60A5FA","現金":"#34D399",
  "外幣":"#FBBF24","基金":"#A78BFA","保險":"#2DD4BF","其他":"#9CA3AF",
};
const ALL_BANKS    = ["富邦","永豐(個人)","永豐(共有)","台新","國泰(共有)","玉山","中國信託","星展","郵局"];

const ACCT_OPTIONS = {
  "存款帳戶": { cats:["現金","外幣"],   currencies:["TWD","USD","JPY"] },
  "證券帳戶": { cats:["台股","美股"],   currencies:["TWD","USD"] },
  "基金/其他":{ cats:["基金","其他"],   currencies:["TWD"] },
};
const SHARED_BANKS = ["永豐(共有)","國泰(共有)"];
const ownerForBank = (bank) => SHARED_BANKS.includes(bank) ? "共有" : "本人";
const ALL_ACCOUNTS = ["存款帳戶","證券帳戶","基金/其他"];
const ALL_CATS     = ["台股","美股","現金","外幣","基金","保險","其他"];

// ── Tokens ────────────────────────────────────────────────────────────────
const T = {
  bg:      "#0F1117",
  surface: "#1A1D27",
  card:    "#222535",
  border:  "#2A2D3E",
  text:    "#F0F2FF",
  muted:   "#6B7280",
  accent:  "#7C6EF7",
};

function fmt(n) {
  if (!n && n !== 0) return "—";
  if (n >= 100000000) return (n/100000000).toFixed(2)+"億";
  if (n >= 10000)     return (n/10000).toFixed(1)+"萬";
  return Math.round(n).toLocaleString()+"元";
}
function fmtOrig(n, currency) {
  if (!n) return "";
  if (currency==="JPY") return "¥"+n.toLocaleString();
  if (currency==="USD") return "$"+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  return n.toLocaleString()+" "+currency;
}
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
}
const today = new Date();
const dateStr = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;

const inputSt = {
  background: T.surface, border:`1px solid ${T.border}`, borderRadius:8,
  padding:"8px 12px", fontSize:14, outline:"none", width:"100%",
  boxSizing:"border-box", fontFamily:"inherit", color:T.text,
};
const labelSt = { display:"block", fontSize:11, fontWeight:600, color:T.muted, marginBottom:4, letterSpacing:0.5 };
const thSt = { textAlign:"left", padding:"10px 12px", fontSize:12, fontWeight:700, color:T.muted, borderBottom:`1px solid ${T.border}` };
const tdSt = { padding:"10px 12px", verticalAlign:"middle" };

function CustomTooltip({active,payload,label}) {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 16px",fontSize:13}}>
      <div style={{marginBottom:4,color:T.muted}}>{label}</div>
      {payload.map(p=>(
        <div key={p.dataKey} style={{color:p.color,fontWeight:700}}>{p.name}：{fmt(p.value)}</div>
      ))}
    </div>
  );
}

function Toast({toast}) {
  return (
    <div style={{
      position:"fixed",top:24,left:"50%",transform:"translateX(-50%)",
      background:toast.type==="error"?"#EF4444":"#10B981",
      color:"#fff",borderRadius:20,padding:"10px 24px",
      fontSize:14,fontWeight:700,zIndex:9999,letterSpacing:0.3,
      boxShadow:"0 8px 24px rgba(0,0,0,0.4)"
    }}>{toast.msg}</div>
  );
}

// Donut chart with center label
function DonutChart({data, colors, size=140, centerLabel="總資產"}) {
  const total = data.reduce((s,d)=>s+d.value,0);
  const pad = 6;
  const full = size + pad*2;
  return (
    <div style={{position:"relative",width:full,height:full}}>
      <PieChart width={full} height={full} margin={{top:pad,right:pad,bottom:pad,left:pad}}>
        <Pie data={data} cx={size/2+pad-1} cy={size/2+pad-1}
          innerRadius={size*0.35} outerRadius={size*0.48}
          paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}>
          {data.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}
        </Pie>
      </PieChart>
      <div style={{
        position:"absolute",inset:0,display:"flex",
        alignItems:"center",justifyContent:"center",
        flexDirection:"column",pointerEvents:"none"
      }}>
        <div style={{fontSize:11,color:T.muted,marginBottom:2}}>{centerLabel}</div>
        <div style={{fontSize:15,fontWeight:800,color:T.text}}>{fmt(total)}</div>
      </div>
    </div>
  );
}

function SetupScreen({onSave}) {
  const [url,setUrl] = useState(SHEETS_API_URL||"");
  const canSave = url.trim();
  return (
    <div style={{
      minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",
      padding:20,fontFamily:"'Noto Sans TC','PingFang TC',sans-serif"
    }}>
      <div style={{width:"100%",maxWidth:420,background:T.surface,borderRadius:16,padding:"28px 24px",border:`1px solid ${T.border}`}}>
        <h2 style={{margin:"0 0 8px",fontSize:18,fontWeight:800,color:T.text}}>連接你的試算表</h2>
        <p style={{margin:"0 0 20px",fontSize:12,color:T.muted,lineHeight:1.7}}>
          請先到你的 Google 試算表 → 擴充功能 → Apps Script，貼上提供給你的程式碼，部署為「網頁應用程式」（存取權限選「任何人」），把取得的網址填在下面。
        </p>
        <div style={{marginBottom:20}}>
          <div style={labelSt}>Apps Script 網址</div>
          <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" style={inputSt}/>
        </div>
        <button
          disabled={!canSave}
          onClick={()=>onSave(url.trim())}
          style={{
            width:"100%",background:canSave?T.accent:T.card,color:canSave?"#fff":T.muted,
            border:"none",borderRadius:10,padding:"12px 0",fontSize:14,fontWeight:700,
            cursor:canSave?"pointer":"not-allowed",fontFamily:"inherit"
          }}
        >儲存並連接</button>
        <p style={{margin:"14px 0 0",fontSize:11,color:T.muted,lineHeight:1.6}}>
          這組網址只會存在你目前這個瀏覽器裡，不會出現在原始碼或其他裝置上；換裝置或清除瀏覽器資料後需要重新輸入一次。網址本身包含一長串無法猜測的 ID，請不要分享給不信任的人。
        </p>
      </div>
    </div>
  );
}

function SwipeRow({id, openId, setOpenId, actions, borderRadius=12, children}) {
  const [dragX,setDragX] = useState(0);
  const dragRef = useState(()=>({startX:0,startY:0,dragging:false,locked:null,x:0}))[0];
  const ACTION_W = 56;
  const maxOffset = -(actions.length*ACTION_W);
  const isOpen = openId===id;
  const translateX = dragRef.dragging ? dragX : (isOpen?maxOffset:0);

  const onTouchStart = (e)=>{
    dragRef.startX = e.touches[0].clientX;
    dragRef.startY = e.touches[0].clientY;
    dragRef.dragging = true;
    dragRef.locked = null;
    dragRef.x = isOpen?maxOffset:0;
    setDragX(dragRef.x);
  };
  const onTouchMove = (e)=>{
    if (!dragRef.dragging) return;
    const dx = e.touches[0].clientX - dragRef.startX;
    const dy = e.touches[0].clientY - dragRef.startY;
    if (dragRef.locked===null && (Math.abs(dx)>6||Math.abs(dy)>6)) {
      dragRef.locked = Math.abs(dx)>Math.abs(dy) ? "x" : "y";
    }
    if (dragRef.locked==="x") {
      if (e.cancelable) e.preventDefault();
      const base = isOpen?maxOffset:0;
      dragRef.x = Math.max(maxOffset, Math.min(0, base+dx));
      setDragX(dragRef.x);
    }
  };
  const onTouchEnd = ()=>{
    if (dragRef.locked==="x") {
      setOpenId(dragRef.x < maxOffset/2 ? id : null);
    }
    dragRef.dragging = false; dragRef.locked = null;
  };

  // 桌面滑鼠拖曳（跟觸控邏輯共用同一套判斷，只是事件來源不同）
  const onMouseDown = (e)=>{
    dragRef.startX = e.clientX;
    dragRef.startY = e.clientY;
    dragRef.dragging = true;
    dragRef.locked = null;
    dragRef.x = isOpen?maxOffset:0;
    setDragX(dragRef.x);

    const onMouseMove = (ev)=>{
      const dx = ev.clientX - dragRef.startX;
      const dy = ev.clientY - dragRef.startY;
      if (dragRef.locked===null && (Math.abs(dx)>4||Math.abs(dy)>4)) {
        dragRef.locked = Math.abs(dx)>Math.abs(dy) ? "x" : "y";
      }
      if (dragRef.locked==="x") {
        const base = isOpen?maxOffset:0;
        dragRef.x = Math.max(maxOffset, Math.min(0, base+dx));
        setDragX(dragRef.x);
      }
    };
    const onMouseUp = ()=>{
      if (dragRef.locked==="x") {
        setOpenId(dragRef.x < maxOffset/2 ? id : null);
      }
      dragRef.dragging = false; dragRef.locked = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div style={{position:"relative",overflow:"hidden",borderRadius}}>
      <div style={{position:"absolute",top:0,right:0,bottom:0,display:"flex"}}>
        {actions.map(a=>(
          <button key={a.key} onClick={()=>{a.onClick();setOpenId(null);}} style={{
            width:ACTION_W,border:"none",background:a.color,color:"#fff",
            fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"
          }}>{a.icon}</button>
        ))}
      </div>
      <div
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
        onClick={e=>{ if(isOpen){ e.preventDefault(); e.stopPropagation(); setOpenId(null);} }}
        style={{
          transform:`translateX(${translateX}px)`,
          transition:dragRef.dragging?"none":"transform 0.2s ease",
          position:"relative",background:T.surface,touchAction:"pan-y",cursor:"grab",
          userSelect:dragRef.dragging?"none":"auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SnapshotModal({show, dateStr, totalValue, snapshotNote, setSnapshotNote, snapshotting, onConfirm, onCancel}) {
  if (!show) return null;
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:1000}}>
      <div style={{
        background:T.surface,borderRadius:"20px 20px 0 0",padding:"28px 24px 40px",
        width:"100%",maxWidth:500,boxShadow:"0 -8px 40px rgba(0,0,0,0.5)"
      }}>
        <div style={{width:36,height:4,borderRadius:2,background:T.border,margin:"0 auto 20px"}}/>
        <h3 style={{margin:"0 0 4px",fontSize:18,fontWeight:800}}>記錄今日快照</h3>
        <p style={{margin:"0 0 20px",fontSize:12,color:T.muted}}>{dateStr} · 總資產 {fmt(totalValue)}</p>
        <div style={{marginBottom:20}}>
          <label style={labelSt}>備註（選填）</label>
          <textarea
            value={snapshotNote}
            onChange={e=>setSnapshotNote(e.target.value)}
            placeholder="e.g. 台股大漲、調整美股部位..."
            rows={3}
            style={{...inputSt,resize:"none",lineHeight:1.6}}
          />
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onConfirm} disabled={snapshotting} style={{
            flex:1,background:T.accent,color:"#fff",border:"none",
            borderRadius:12,padding:"13px 0",fontSize:15,fontWeight:700,
            cursor:"pointer",fontFamily:"inherit",opacity:snapshotting?0.6:1
          }}>{snapshotting?"記錄中...":"確認記錄"}</button>
          <button onClick={onCancel} style={{
            flex:0,background:T.card,color:T.muted,border:`1px solid ${T.border}`,
            borderRadius:12,padding:"13px 20px",fontSize:15,
            cursor:"pointer",fontFamily:"inherit"
          }}>取消</button>
        </div>
      </div>
    </div>
  );
}

export default function AssetTracker() {
  const [assets,setAssets]               = useState([]);
  const [snapshots,setSnapshots]         = useState([]);
  const [fxRates,setFxRates]             = useState({});
  const [fxUpdated,setFxUpdated]         = useState(null);
  const [loading,setLoading]             = useState(true);
  const [saving,setSaving]               = useState(false);
  const [snapshotting,setSnapshotting]   = useState(false);
  const [snapshotNote,setSnapshotNote]     = useState("");
  const [showSnapshotModal,setShowSnapshotModal] = useState(false);
  const [configured,setConfigured] = useState(()=>!!SHEETS_API_URL);
  const [page,setPage]                   = useState("main");
  const [billTemplates,setBillTemplates] = useState([]);
  const [bills,setBills]                 = useState([]);
  const [billsMonth,setBillsMonth]       = useState(()=>{
    const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });
  const [newTemplateName,setNewTemplateName] = useState("");
  const [newTemplateDueDay,setNewTemplateDueDay] = useState("");
  const [newTemplateAutoDebit,setNewTemplateAutoDebit] = useState(false);
  const [newTemplateFrequency,setNewTemplateFrequency] = useState("monthly");
  const [expenses,setExpenses] = useState([]);
  const [expensesMonth,setExpensesMonth] = useState(()=>{
    const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });
  const [expenseSaving,setExpenseSaving] = useState(false);
  const [editingExpenseId,setEditingExpenseId] = useState(null);
  const [editExpenseForm,setEditExpenseForm]   = useState(null);
  const [openExpenseSwipeId,setOpenExpenseSwipeId] = useState(null);
  const [expenseForm,setExpenseForm] = useState(()=>{
    const d=new Date();
    return {date:d.toISOString().slice(0,10),category:"",amount:"",payment_method:"現金",note:""};
  });
  const [showTemplateManager,setShowTemplateManager] = useState(false);
  const [billSaving,setBillSaving]       = useState(false);
  const [editingBillId,setEditingBillId] = useState(null);
  const [editBillForm,setEditBillForm]   = useState(null);
  const [openBillSwipeId,setOpenBillSwipeId] = useState(null);
  const [expandedRows,setExpandedRows]   = useState(()=>new Set());
  const toggleExpandRow = (key)=>{
    setExpandedRows(prev=>{
      const next=new Set(prev);
      next.has(key)?next.delete(key):next.add(key);
      return next;
    });
  };
  const [openBanks,setOpenBanks]         = useState({});
  const [openAccts,setOpenAccts]         = useState({});
  const [editingId,setEditingId]         = useState(null);
  const [editForm,setEditForm]           = useState({});
  const [showAdd,setShowAdd]             = useState(false);
  const [addForm,setAddForm]             = useState({bank:"富邦",account:"存款帳戶",category:"現金",name:"",quantity:"",original_value:"",currency:"TWD",owner:"本人"});
  const [ownerFilter,setOwnerFilter]     = useState("全部");
  const [toast,setToast]                 = useState(null);
  const [chartType,setChartType]         = useState("total");

  const showToast = (msg,type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),2500); };

  const toTWD = useCallback((amount,currency) => {
    const n = Number(amount);
    if (!n || Number.isNaN(n)) return 0;
    if (currency==="TWD"||!currency) return n;
    const rate = fxRates[currency];
    return rate ? n*rate : n;
  },[fxRates]);

  useEffect(()=>{
    if (!configured) { setLoading(false); return; }

    // 先讀本地快取，能立即顯示上次的資料，不用空等網路
    let hasCache = false;
    try {
      const cached = JSON.parse(localStorage.getItem(DATA_CACHE_KEY)||"null");
      if (cached) {
        hasCache = true;
        setAssets(cached.assets||[]);
        setSnapshots(cached.snapshots||[]);
        setBillTemplates(cached.billTemplates||[]);
        setBills(cached.bills||[]);
        setExpenses(cached.expenses||[]);
        setFxRates(cached.fxRates||{});
        setFxUpdated(cached.fxUpdated?new Date(cached.fxUpdated):null);
        setLoading(false); // 有快取就先讓畫面出現，背景再偷偷更新
      }
    } catch(e) { /* 快取壞掉就當作沒有，走正常流程 */ }

    const load = async () => {
      if (!hasCache) setLoading(true);

      // 資產資料跟匯率互不相關，平行抓取，不要一個等完才抓下一個
      const [listResult, fxResult] = await Promise.allSettled([
        apiGet("list"),
        fetch(FX_API).then(r=>r.json()),
      ]);

      let newAssets,newSnapshots,newBillTemplates,newBills,newExpenses;
      if (listResult.status==="fulfilled") {
        const {assets:aData, snapshots:sData, bill_templates:btData, bills:bData, expenses:eData} = listResult.value;
        newAssets = (aData||[]).slice().sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
        newSnapshots = (sData||[]).slice().sort((a,b)=>new Date(a.taken_at)-new Date(b.taken_at));
        newBillTemplates = (btData||[]).slice().sort((a,b)=>(a.sort_order??0)-(b.sort_order??0));
        newBills = bData||[];
        newExpenses = eData||[];
        setAssets(newAssets); setSnapshots(newSnapshots); setBillTemplates(newBillTemplates);
        setBills(newBills); setExpenses(newExpenses);
      } else if (!hasCache) {
        showToast("資產載入失敗："+listResult.reason.message,"error");
      }

      let newFxRates,newFxUpdated;
      if (fxResult.status==="fulfilled") {
        newFxRates={};
        Object.entries(fxResult.value.rates).forEach(([k,v])=>{newFxRates[k]=1/v;});
        newFxUpdated=new Date();
        setFxRates(newFxRates); setFxUpdated(newFxUpdated);
      } else if (!hasCache) {
        showToast("匯率載入失敗","error");
      }

      // 把這次成功抓到的部分寫回快取（失敗的部分沿用舊快取，避免整份被清空）
      try {
        const prev = JSON.parse(localStorage.getItem(DATA_CACHE_KEY)||"null") || {};
        localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({
          assets: newAssets ?? prev.assets ?? [],
          snapshots: newSnapshots ?? prev.snapshots ?? [],
          billTemplates: newBillTemplates ?? prev.billTemplates ?? [],
          bills: newBills ?? prev.bills ?? [],
          expenses: newExpenses ?? prev.expenses ?? [],
          fxRates: newFxRates ?? prev.fxRates ?? {},
          fxUpdated: newFxUpdated ? newFxUpdated.toISOString() : (prev.fxUpdated ?? null),
        }));
      } catch(e) { /* 存不了快取不影響功能，忽略即可 */ }

      setLoading(false);
    };
    load();
  },[configured]);

  const assetTWD  = useCallback((a)=>toTWD(a.original_value??a.value??0, a.currency||"TWD"),[toTWD]);
  const filtered  = useMemo(()=>ownerFilter==="全部"?assets:assets.filter(a=>a.owner===ownerFilter||a.owner==="共有"),[assets,ownerFilter]);
  const totalValue= useMemo(()=>filtered.reduce((s,a)=>s+assetTWD(a),0),[filtered,assetTWD]);
  const pct       = v=>totalValue>0?(v/totalValue*100):0;
  const bankTotal = b=>filtered.filter(a=>a.bank===b).reduce((s,a)=>s+assetTWD(a),0);
  const acctTotal = (b,ac)=>filtered.filter(a=>a.bank===b&&a.account===ac).reduce((s,a)=>s+assetTWD(a),0);

  const banks = useMemo(()=>
    ALL_BANKS.filter(b=>assets.some(a=>a.bank===b)).sort((a,b)=>bankTotal(b)-bankTotal(a)),
  [filtered,assets]);

  const bankBreakdown = useMemo(()=>banks.filter(b=>bankTotal(b)>0).map(b=>({name:b,value:bankTotal(b)})),[banks,filtered]);
  const catBreakdown  = useMemo(()=>{
    const m={};
    filtered.forEach(a=>{m[a.category]=(m[a.category]||0)+assetTWD(a);});
    return Object.entries(m).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  },[filtered,assetTWD]);

  // 分類總覽表：依現有資產實際出現的分類自動分組，同分類內名稱相同的項目自動合併加總，依分類總額大小排序
  const catGroups = useMemo(()=>{
    const groups={};
    filtered.forEach(a=>{
      const v=assetTWD(a);
      (groups[a.category]=groups[a.category]||[]).push({...a,twdVal:v});
    });
    const parseQty = (q) => {
      if (q==null || q==="") return null;
      const m = String(q).trim().match(/^([\d,.]+)\s*(.*)$/);
      if (!m) return null;
      const num = parseFloat(m[1].replace(/,/g,""));
      if (Number.isNaN(num)) return null;
      return { num, unit: m[2]||"" };
    };
    const mergeQty = (items) => {
      if (items.length===1) return items[0].quantity;
      const parsed = items.map(it=>parseQty(it.quantity));
      if (parsed.some(p=>p===null)) return null;
      const unit = parsed[0].unit;
      if (!parsed.every(p=>p.unit===unit)) return null;
      const sum = Math.round(parsed.reduce((s,p)=>s+p.num,0)*100000)/100000;
      return `${sum}${unit}`;
    };
    return Object.keys(groups)
      .map(cat=>{
        const byName={};
        groups[cat].forEach(it=>{ (byName[it.name]=byName[it.name]||[]).push(it); });
        const merged = Object.entries(byName).map(([name,arr])=>({
          id: arr[0].id, name,
          quantity: mergeQty(arr),
          twdVal: arr.reduce((s,it)=>s+it.twdVal,0),
          sources: arr.map(it=>({
            id:it.id, bank:it.bank, account:it.account,
            quantity:it.quantity, twdVal:it.twdVal,
          })).sort((x,y)=>y.twdVal-x.twdVal),
        })).sort((x,y)=>y.twdVal-x.twdVal);
        const catTotal = merged.reduce((s,it)=>s+it.twdVal,0);
        return { cat, catTotal, catPct: pct(catTotal), items: merged.map(it=>({...it, itemPct: pct(it.twdVal)})) };
      })
      .sort((a,b)=>b.catTotal-a.catTotal);
  },[filtered,assetTWD,totalValue]);

  // 診斷：找出資料庫裡存在、但不在目前下拉選單選項（ALL_ACCOUNTS）裡的帳戶類型
  const unknownAccounts = useMemo(()=>{
    const m={};
    assets.forEach(a=>{
      if (!ALL_ACCOUNTS.includes(a.account)) {
        const key=`${a.bank}｜${a.account}`;
        if (!m[key]) m[key]={bank:a.bank,account:a.account,count:0,total:0};
        m[key].count+=1; m[key].total+=assetTWD(a);
      }
    });
    return Object.values(m).sort((x,y)=>y.total-x.total);
  },[assets,assetTWD]);

  const chartData = useMemo(()=>snapshots.map(s=>({
    date:fmtDate(s.taken_at),total:s.total_value,
    ...s.bank_breakdown,
    ...Object.fromEntries(Object.entries(s.category_breakdown||{}).map(([k,v])=>["cat_"+k,v]))
  })),[snapshots]);

  const isBankOpen  = b=>openBanks[b]!==false;
  const isAcctOpen  = (b,ac)=>openAccts[b+"__"+ac]!==false;
  const toggleBank  = b=>setOpenBanks(p=>({...p,[b]:p[b]===false?true:false}));
  const toggleAcct  = (b,ac)=>setOpenAccts(p=>({...p,[b+"__"+ac]:p[b+"__"+ac]===false?true:false}));
  const startEdit   = a=>{ setEditingId(a.id); setEditForm({...a,original_value:a.original_value??a.value??0,currency:a.currency||"TWD"}); };

  const saveEdit = async id => {
    setSaving(true);
    const twdVal = toTWD(parseFloat(editForm.original_value)||0, editForm.currency||"TWD");
    const qty = editForm.quantity && /^\d+(\.\d+)?$/.test(String(editForm.quantity).trim())
      ? String(editForm.quantity).trim()+"股" : editForm.quantity;
    const payload = {
      name:editForm.name,bank:editForm.bank,account:editForm.account,
      category:editForm.category,quantity:qty,
      original_value:parseFloat(editForm.original_value)||0,
      currency:editForm.currency||"TWD",value:twdVal,owner:editForm.owner,
    };
    try {
      const result = await apiPost({action:"updateAsset", id, payload});
      setAssets(p=>p.map(a=>a.id===id?{...a,...result}:a));
      showToast("已儲存");
    } catch(e) { showToast("儲存失敗："+e.message,"error"); }
    setSaving(false); setEditingId(null);
  };

  const deleteAsset = async id => {
    try {
      await apiPost({action:"deleteAsset", id});
      setAssets(p=>p.filter(a=>a.id!==id));
      showToast("已刪除");
    } catch(e) { showToast("刪除失敗："+e.message,"error"); }
  };

  const addAsset = async () => {
    if (!addForm.name) return;
    setSaving(true);
    const twdVal = toTWD(parseFloat(addForm.original_value)||0, addForm.currency||"TWD");
    const qty = addForm.quantity && /^\d+(\.\d+)?$/.test(addForm.quantity.trim())
      ? addForm.quantity.trim()+"股" : addForm.quantity;
    const payload = {
      ...addForm,quantity:qty,original_value:parseFloat(addForm.original_value)||0,
      currency:addForm.currency||"TWD",value:twdVal,sort_order:assets.length,
    };
    try {
      const result = await apiPost({action:"addAsset", payload});
      setAssets(p=>[...p,result]);
      showToast("新增成功"); setShowAdd(false); setAddForm({bank:"富邦",account:"存款帳戶",category:"現金",name:"",quantity:"",original_value:"",currency:"TWD",owner:"本人"});
    } catch(e) { showToast("新增失敗："+e.message,"error"); }
    setSaving(false);
  };

  const deleteSnapshot = async (id) => {
    try {
      await apiPost({action:"deleteSnapshot", id});
      setSnapshots(p=>p.filter(s=>s.id!==id));
      showToast("快照已刪除");
    } catch(e) { showToast("刪除失敗："+e.message,"error"); }
  };

  const takeSnapshot = async (note="") => {
    if (!assets.length){showToast("尚無資產資料","error");return;}
    setSnapshotting(true);
    const total=assets.reduce((s,a)=>s+assetTWD(a),0);
    const bankBD={},catBD={},fxSnap={};
    assets.forEach(a=>{bankBD[a.bank]=(bankBD[a.bank]||0)+assetTWD(a);catBD[a.category]=(catBD[a.category]||0)+assetTWD(a);});
    ["USD","JPY"].forEach(c=>{if(fxRates[c])fxSnap[c]=fxRates[c];});
    const payload = {
      total_value:total,bank_breakdown:bankBD,category_breakdown:catBD,
      fx_rates:fxSnap,taken_at:new Date().toISOString(),
      note: note||null,
    };
    try {
      const result = await apiPost({action:"addSnapshot", payload});
      setSnapshots(p=>[...p,result]);
      showToast("✅ 已記錄今日快照");
    } catch(e) { showToast("快照失敗："+e.message,"error"); }
    setSnapshotting(false);
    setShowSnapshotModal(false);
    setSnapshotNote("");
  };

  // ── 帳單功能 ──────────────────────────────────────────────────────
  const monthBills = useMemo(()=>bills.filter(b=>b.month===billsMonth), [bills,billsMonth]);
  const monthLabel = useMemo(()=>{
    const [y,m]=billsMonth.split("-");
    return `${y}年${parseInt(m,10)}月`;
  },[billsMonth]);
  const shiftMonth = (delta)=>{
    const [y,m]=billsMonth.split("-").map(Number);
    const d = new Date(y, m-1+delta, 1);
    setBillsMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };
  const billYear = billsMonth.split("-")[0];
  const annualTotal = useMemo(()=>
    bills.filter(b=>b.month&&b.month.startsWith(billYear+"-")).reduce((s,b)=>s+(parseFloat(b.amount)||0),0)
  ,[bills,billYear]);

  const monthlyTemplates = useMemo(()=>billTemplates.filter(t=>t.active!==false&&(t.frequency||"monthly")==="monthly"),[billTemplates]);
  const irregularTemplates = useMemo(()=>billTemplates.filter(t=>t.active!==false&&t.frequency==="irregular"),[billTemplates]);
  const missingTemplatesThisMonth = useMemo(()=>
    monthlyTemplates.filter(t=>!monthBills.some(b=>b.template_id===t.id))
  ,[monthlyTemplates,monthBills]);
  const irregularAvailableThisMonth = useMemo(()=>
    irregularTemplates.filter(t=>!monthBills.some(b=>b.template_id===t.id))
  ,[irregularTemplates,monthBills]);

  const generateMonthBills = async () => {
    if (!missingTemplatesThisMonth.length) return;
    setBillSaving(true);
    try {
      const results = await Promise.all(missingTemplatesThisMonth.map(t=>apiPost({
        action:"addBill",
        payload:{
          template_id:t.id,name:t.name,month:billsMonth,amount:0,
          paid:!!t.auto_debit,due_day:t.due_day||"",paid_date:"",note:"",
          auto_debit:!!t.auto_debit,
        }
      })));
      setBills(p=>[...p,...results]);
      showToast(`已產生 ${results.length} 筆本月帳單`);
    } catch(e) { showToast("產生失敗："+e.message,"error"); }
    setBillSaving(false);
  };

  const addOneBill = async (t) => {
    setBillSaving(true);
    try {
      const result = await apiPost({action:"addBill", payload:{
        template_id:t.id,name:t.name,month:billsMonth,amount:0,
        paid:!!t.auto_debit,due_day:t.due_day||"",paid_date:"",note:"",
        auto_debit:!!t.auto_debit,
      }});
      setBills(p=>[...p,result]);
    } catch(e) { showToast("新增失敗："+e.message,"error"); }
    setBillSaving(false);
  };

  const updateBillField = async (id, payload) => {
    setBills(p=>p.map(b=>b.id===id?{...b,...payload}:b)); // 先更新畫面，體感較快
    try {
      await apiPost({action:"updateBill", id, payload});
    } catch(e) { showToast("更新失敗："+e.message,"error"); }
  };

  const startEditBill = (b) => {
    setEditingBillId(b.id);
    setEditBillForm({name:b.name||"", amount:b.amount||"", due_day:b.due_day||"", note:b.note||""});
  };
  const saveEditBill = async (id) => {
    const payload = {
      name: editBillForm.name.trim(),
      amount: parseFloat(editBillForm.amount)||0,
      due_day: editBillForm.due_day?parseInt(editBillForm.due_day,10):"",
      note: editBillForm.note||"",
    };
    setBills(p=>p.map(b=>b.id===id?{...b,...payload}:b));
    setEditingBillId(null); setEditBillForm(null);
    try {
      await apiPost({action:"updateBill", id, payload});
      showToast("已更新");
    } catch(e) { showToast("更新失敗："+e.message,"error"); }
  };

  const deleteBill = async (id) => {
    try {
      await apiPost({action:"deleteBill", id});
      setBills(p=>p.filter(b=>b.id!==id));
      showToast("已刪除");
    } catch(e) { showToast("刪除失敗："+e.message,"error"); }
  };

  const addBillTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) return;
    try {
      const result = await apiPost({action:"addBillTemplate", payload:{
        name,category:"",note:"",sort_order:billTemplates.length,active:true,
        due_day:newTemplateDueDay?parseInt(newTemplateDueDay,10):"",
        auto_debit:!!newTemplateAutoDebit,
        frequency:newTemplateFrequency||"monthly",
      }});
      setBillTemplates(p=>[...p,result]);
      setNewTemplateName(""); setNewTemplateDueDay(""); setNewTemplateAutoDebit(false); setNewTemplateFrequency("monthly");
    } catch(e) { showToast("新增失敗："+e.message,"error"); }
  };

  const deleteBillTemplate = async (id) => {
    try {
      await apiPost({action:"deleteBillTemplate", id});
      setBillTemplates(p=>p.filter(t=>t.id!==id));
      showToast("已刪除範本");
    } catch(e) { showToast("刪除失敗："+e.message,"error"); }
  };

  // ── 記帳本功能 ────────────────────────────────────────────────────
  const monthExpenses = useMemo(()=>
    expenses.filter(e=>e.date&&e.date.slice(0,7)===expensesMonth).sort((a,b)=>b.date.localeCompare(a.date))
  ,[expenses,expensesMonth]);
  const expensesMonthLabel = useMemo(()=>{
    const [y,m]=expensesMonth.split("-");
    return `${y}年${parseInt(m,10)}月`;
  },[expensesMonth]);
  const shiftExpensesMonth = (delta)=>{
    const [y,m]=expensesMonth.split("-").map(Number);
    const d = new Date(y, m-1+delta, 1);
    setExpensesMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
  };
  const monthExpenseTotal = useMemo(()=>monthExpenses.reduce((s,e)=>s+(parseFloat(e.amount)||0),0),[monthExpenses]);
  const expenseCatBreakdown = useMemo(()=>{
    const m={};
    monthExpenses.forEach(e=>{ m[e.category]=(m[e.category]||0)+(parseFloat(e.amount)||0); });
    return Object.entries(m).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  },[monthExpenses]);
  const expensesByDate = useMemo(()=>{
    const groups={};
    monthExpenses.forEach(e=>{ (groups[e.date]=groups[e.date]||[]).push(e); });
    return Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0]));
  },[monthExpenses]);

  const addExpense = async () => {
    const amt = parseFloat(expenseForm.amount);
    if (!expenseForm.category || !amt) { showToast("請選分類並輸入金額","error"); return; }
    setExpenseSaving(true);
    try {
      const result = await apiPost({action:"addExpense", payload:{
        date:expenseForm.date, category:expenseForm.category, amount:amt,
        payment_method:expenseForm.payment_method, note:expenseForm.note||"",
      }});
      setExpenses(p=>[...p,result]);
      setExpenseForm(f=>({...f,amount:"",note:""}));
      showToast("已記一筆");
    } catch(e) { showToast("新增失敗："+e.message,"error"); }
    setExpenseSaving(false);
  };

  const deleteExpense = async (id) => {
    try {
      await apiPost({action:"deleteExpense", id});
      setExpenses(p=>p.filter(e=>e.id!==id));
      showToast("已刪除");
    } catch(e) { showToast("刪除失敗："+e.message,"error"); }
  };

  const startEditExpense = (e) => {
    setEditingExpenseId(e.id);
    setEditExpenseForm({date:e.date||"", category:e.category||"", amount:e.amount||"", payment_method:e.payment_method||"現金", note:e.note||""});
  };
  const saveEditExpense = async (id) => {
    const amt = parseFloat(editExpenseForm.amount);
    if (!editExpenseForm.category || !amt) { showToast("請選分類並輸入金額","error"); return; }
    const payload = {
      date: editExpenseForm.date, category: editExpenseForm.category, amount: amt,
      payment_method: editExpenseForm.payment_method, note: editExpenseForm.note||"",
    };
    setExpenses(p=>p.map(e=>e.id===id?{...e,...payload}:e));
    setEditingExpenseId(null); setEditExpenseForm(null);
    try {
      await apiPost({action:"updateExpense", id, payload});
      showToast("已更新");
    } catch(e) { showToast("更新失敗："+e.message,"error"); }
  };


  if (!configured) return (
    <SetupScreen onSave={(url)=>{ setSheetsConfig(url); setConfigured(true); }} />
  );

  if (loading) return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      background:T.bg,fontFamily:"'Noto Sans TC','PingFang TC',sans-serif",gap:16}}>
      <div style={{fontSize:40}}>📊</div>
      <div style={{fontSize:15,color:T.muted,letterSpacing:1}}>載入中...</div>
    </div>
  );

  const pageStyle = {
    minHeight:"100vh",background:T.bg,
    fontFamily:"'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif",
    color:T.text, padding:"0 0 80px",
    maxWidth:880, margin:"0 auto", // 桌面版限制內容寬度並置中，避免版面被拉得太寬；手機螢幕本來就窄，不受影響
  };

  // ── HISTORY ───────────────────────────────────────────────────────────────
  if (page==="history") return (
    <div style={pageStyle}>
      {toast&&<Toast toast={toast}/>}
      {/* Header */}
      <div style={{
        background:`linear-gradient(160deg, #1A1D27 0%, #12141E 100%)`,
        padding:"24px 20px 20px",borderBottom:`1px solid ${T.border}`,
        display:"flex",alignItems:"center",justifyContent:"space-between"
      }}>
        <div>
          <div style={{fontSize:11,color:T.muted,letterSpacing:1,marginBottom:4,textTransform:"uppercase"}}>
            {dateStr} · {ownerFilter==="全部"?"全部資產":ownerFilter}
          </div>
          <div style={{fontSize:20,fontWeight:800}}>歷史資產變化</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setShowSnapshotModal(true)} disabled={snapshotting} style={{
            background:T.accent,color:"#fff",border:"none",borderRadius:10,
            padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",opacity:snapshotting?0.6:1
          }}>{snapshotting?"...":"📸 今日"}</button>
          <button onClick={()=>setPage("main")} style={{
            background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,
            padding:"7px 14px",cursor:"pointer",fontSize:12,fontFamily:"inherit",color:T.muted
          }}>🏠 首頁</button>
        </div>
      </div>


      <div style={{padding:"20px 20px 40px"}}>
        {snapshots.length===0?(
          <div style={{textAlign:"center",padding:"60px 20px",background:T.surface,borderRadius:20,border:`1px solid ${T.border}`}}>
            <div style={{fontSize:48,marginBottom:16}}>📸</div>
            <div style={{fontSize:16,color:T.muted}}>還沒有任何快照</div>
            <div style={{fontSize:13,color:T.border,marginTop:8}}>點擊「今日」儲存第一筆</div>
          </div>
        ):(
          <>
            {/* Chart type toggle */}
            <div style={{display:"flex",gap:6,marginBottom:20,background:T.surface,borderRadius:12,padding:4}}>
              {[["total","總資產"],["bank","各銀行"],["category","類別"]].map(([k,l])=>(
                <button key={k} onClick={()=>setChartType(k)} style={{
                  flex:1,background:chartType===k?T.card:"transparent",
                  color:chartType===k?T.text:T.muted,
                  border:"none",borderRadius:9,padding:"8px 0",
                  fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
                  transition:"all 0.15s"
                }}>{l}</button>
              ))}
            </div>

            {/* Line Chart */}
            <div style={{background:T.surface,borderRadius:20,padding:"20px 8px 12px",marginBottom:20,border:`1px solid ${T.border}`}}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{top:5,right:16,left:8,bottom:5}}>
                  <XAxis dataKey="date" tick={{fontSize:10,fill:T.muted}} tickLine={false} axisLine={false}/>
                  <YAxis tickFormatter={v=>fmt(v)} tick={{fontSize:10,fill:T.muted}} tickLine={false} axisLine={false} width={60}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  {chartType==="total"&&<Line type="monotone" dataKey="total" name="總資產" stroke={T.accent} strokeWidth={2.5} dot={{r:4,fill:T.accent}} activeDot={{r:6}}/>}
                  {chartType==="bank"&&banks.map(b=><Line key={b} type="monotone" dataKey={b} name={b} stroke={BANK_COLORS[b]||"#888"} strokeWidth={2} dot={{r:3}} activeDot={{r:5}}/>)}
                  {chartType==="category"&&ALL_CATS.map(c=><Line key={c} type="monotone" dataKey={"cat_"+c} name={c} stroke={CAT_COLORS[c]||"#888"} strokeWidth={2} dot={{r:3}} activeDot={{r:5}}/>)}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Pie charts */}
            <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
              {[
                {title:"銀行分佈",data:Object.entries(snapshots[snapshots.length-1]?.bank_breakdown||{}).map(([k,v])=>({name:k,value:v})),colors:Object.values(BANK_COLORS)},
                {title:"類別分佈",data:Object.entries(snapshots[snapshots.length-1]?.category_breakdown||{}).map(([k,v])=>({name:k,value:v})),colors:Object.values(CAT_COLORS)},
              ].map(({title,data,colors})=>(
                <div key={title} style={{flex:"1 1 240px",background:T.surface,borderRadius:20,padding:16,border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:13,fontWeight:700,color:T.muted,marginBottom:12}}>{title}</div>
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <DonutChart data={data} colors={colors} size={120}/>
                    <div style={{flex:1,minWidth:100}}>
                      {data.slice(0,5).map((d,i)=>(
                        <div key={d.name} style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                          <div style={{width:8,height:8,borderRadius:2,background:colors[i%colors.length],flexShrink:0}}/>
                          <span style={{fontSize:11,color:T.muted,flex:1}}>{d.name}</span>
                          <span style={{fontSize:11,fontWeight:700,color:T.text}}>{fmt(d.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Snapshot list */}
            <div style={{background:T.surface,borderRadius:20,padding:20,border:`1px solid ${T.border}`}}>
              <div style={{fontSize:13,fontWeight:700,color:T.muted,marginBottom:16,letterSpacing:0.5}}>快照紀錄</div>
              {[...snapshots].reverse().map((s,i)=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",
                  borderBottom:i<snapshots.length-1?`1px solid ${T.border}`:"none"}}>
                  <div style={{fontSize:12,color:T.muted,minWidth:75}}>{fmtDate(s.taken_at)}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:800,fontSize:16}}>{fmt(s.total_value)}</div>
                    {s.note&&<div style={{fontSize:11,color:T.muted,marginTop:2}}>{s.note}</div>}
                  </div>
                  {i<snapshots.length-1&&(()=>{
                    const prev=[...snapshots].reverse()[i+1];
                    const diff=s.total_value-prev.total_value;
                    return <div style={{fontSize:12,fontWeight:700,color:diff>=0?"#10B981":"#EF4444"}}>{diff>=0?"▲":"▼"} {fmt(Math.abs(diff))}</div>;
                  })()}
                  {i===0&&<div style={{fontSize:10,background:"#10B98120",color:"#10B981",borderRadius:8,padding:"2px 8px",fontWeight:700}}>最新</div>}
                  <button onClick={()=>{if(window.confirm("確定刪除這筆快照？"))deleteSnapshot(s.id);}} style={{
                    background:"none",border:`1px solid ${T.border}`,borderRadius:8,
                    padding:"4px 10px",cursor:"pointer",fontSize:11,color:T.muted,fontFamily:"inherit"
                  }}>刪除</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <SnapshotModal
        show={showSnapshotModal}
        dateStr={dateStr}
        totalValue={totalValue}
        snapshotNote={snapshotNote}
        setSnapshotNote={setSnapshotNote}
        snapshotting={snapshotting}
        onConfirm={()=>takeSnapshot(snapshotNote)}
        onCancel={()=>{setShowSnapshotModal(false);setSnapshotNote("");}}
      />
    </div>
  );

  // ── BREAKDOWN (分類總覽) ─────────────────────────────────────────────────
  if (page==="breakdown") return (
    <div style={pageStyle}>
      {toast&&<Toast toast={toast}/>}
      <div style={{
        background:`linear-gradient(160deg, #1A1D27 0%, #12141E 100%)`,
        padding:"24px 20px 20px",borderBottom:`1px solid ${T.border}`,
        display:"flex",alignItems:"center",justifyContent:"space-between"
      }}>
        <div>
          <div style={{fontSize:11,color:T.muted,letterSpacing:1,marginBottom:4,textTransform:"uppercase"}}>
            {dateStr} · {ownerFilter==="全部"?"全部資產":ownerFilter}
          </div>
          <div style={{fontSize:20,fontWeight:800}}>資產分類總覽</div>
        </div>
        <button onClick={()=>setPage("main")} style={{
          background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,
          padding:"7px 14px",cursor:"pointer",fontSize:12,fontFamily:"inherit",color:T.muted
        }}>🏠 首頁</button>
      </div>

      <div style={{padding:"20px 16px 40px"}}>
        {unknownAccounts.length>0&&(
          <div style={{
            marginBottom:20,padding:"14px 16px",borderRadius:12,
            background:"#F59E0B15",border:`1px solid #F59E0B40`
          }}>
            <div style={{fontSize:13,fontWeight:800,color:"#F59E0B",marginBottom:8}}>
              ⚠️ 發現 {unknownAccounts.length} 種未列在帳戶選單裡的帳戶類型
            </div>
            <div style={{fontSize:12,color:T.muted,marginBottom:10,lineHeight:1.6}}>
              這些資產目前的「帳戶類型」不在存款帳戶／證券帳戶／基金其他這三種選項裡，可能是舊資料或手動輸入的。金額都有正確算入總資產，但建議確認一下是否需要合併或修正：
            </div>
            {unknownAccounts.map(u=>(
              <div key={u.bank+u.account} style={{
                display:"flex",justifyContent:"space-between",
                padding:"6px 0",fontSize:12,borderTop:`1px solid #F59E0B25`
              }}>
                <span style={{color:T.text}}>{u.bank} · <b style={{color:"#F59E0B"}}>{u.account}</b> ({u.count}筆)</span>
                <span style={{color:T.muted}}>{fmt(u.total)}</span>
              </div>
            ))}
          </div>
        )}
        {catGroups.length===0 ? (
          <div style={{textAlign:"center",color:T.muted,padding:"60px 0",fontSize:13}}>目前沒有資產資料</div>
        ) : (
          <table style={{
            width:"100%",borderCollapse:"collapse",fontSize:13,
            background:T.surface,borderRadius:12,overflow:"hidden",
            border:`1px solid ${T.border}`
          }}>
            <thead>
              <tr style={{background:T.card}}>
                <th style={thSt}>項目</th>
                <th style={thSt}>名稱</th>
                <th style={{...thSt,textAlign:"right"}}>金額</th>
                <th style={{...thSt,textAlign:"right"}}>投資佔比</th>
                <th style={{...thSt,textAlign:"right"}}>分類佔比</th>
              </tr>
            </thead>
            <tbody>
              {catGroups.map(g=>{
                const totalRows = g.items.reduce((s,it)=>{
                  const key = `${g.cat}::${it.name}`;
                  const canExpand = it.sources.length>=1;
                  return s + 1 + (canExpand&&expandedRows.has(key) ? it.sources.length : 0);
                },0);
                let rendered = 0;
                return g.items.map(it=>{
                  const key = `${g.cat}::${it.name}`;
                  const canExpand = it.sources.length>=1;
                  const isOpen = canExpand && expandedRows.has(key);
                  const isFirst = rendered===0;
                  rendered += 1 + (isOpen ? it.sources.length : 0);
                  return (
                    <Fragment key={it.id}>
                      <tr style={{borderTop:`1px solid ${T.border}`}}>
                        {isFirst&&(
                          <td rowSpan={totalRows} style={{
                            ...tdSt,fontWeight:700,textAlign:"center",
                            background:`${CAT_COLORS[g.cat]||"#9CA3AF"}22`,
                            color:CAT_COLORS[g.cat]||T.text,
                            borderRight:`1px solid ${T.border}`
                          }}>{g.cat}</td>
                        )}
                        <td style={{...tdSt,color:T.text}}>
                          {canExpand&&(
                            <button onClick={()=>toggleExpandRow(key)} style={{
                              background:"none",border:"none",cursor:"pointer",
                              color:T.muted,fontSize:11,marginRight:6,padding:0,
                              fontFamily:"inherit",verticalAlign:"middle"
                            }}>{isOpen?"▾":"▸"}</button>
                          )}
                          {it.name}{it.quantity?<span style={{color:T.muted}}> ({it.quantity})</span>:null}
                          {it.sources.length>1&&<span style={{color:T.muted,fontSize:11}}> ({it.sources.length}筆)</span>}
                        </td>
                        <td style={{...tdSt,textAlign:"right",color:T.muted}}>{fmt(it.twdVal)}</td>
                        <td style={{...tdSt,textAlign:"right",fontWeight:700}}>{it.itemPct.toFixed(2)}%</td>
                        {isFirst&&(
                          <td rowSpan={totalRows} style={{
                            ...tdSt,textAlign:"right",fontWeight:800,
                            borderLeft:`1px solid ${T.border}`
                          }}>{g.catPct.toFixed(2)}%</td>
                        )}
                      </tr>
                      {isOpen&&it.sources.map(s=>(
                        <tr key={s.id} style={{borderTop:`1px solid ${T.border}`,background:"rgba(255,255,255,0.02)"}}>
                          <td style={{...tdSt,color:T.muted,fontSize:12,paddingLeft:34}}>
                            └ {s.bank} · {s.account}{s.quantity?<span> ({s.quantity})</span>:null}
                          </td>
                          <td style={{...tdSt,textAlign:"right",color:T.muted,fontSize:12}}>{fmt(s.twdVal)}</td>
                          <td style={{...tdSt,textAlign:"right",color:T.muted,fontSize:12}}>{pct(s.twdVal).toFixed(2)}%</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                });
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  // ── BILLS (帳單) ─────────────────────────────────────────────────────────
  if (page==="bills") {
    const total = monthBills.reduce((s,b)=>s+(parseFloat(b.amount)||0),0);
    const paidCount = monthBills.filter(b=>b.paid).length;
    return (
      <div style={pageStyle}>
        {toast&&<Toast toast={toast}/>}
        <div style={{
          background:`linear-gradient(160deg, #1A1D27 0%, #12141E 100%)`,
          padding:"24px 20px 20px",borderBottom:`1px solid ${T.border}`,
          display:"flex",alignItems:"center",justifyContent:"space-between"
        }}>
          <div>
            <div style={{fontSize:11,color:T.muted,letterSpacing:1,marginBottom:4,textTransform:"uppercase"}}>每月帳單</div>
            <div style={{fontSize:20,fontWeight:800}}>🧾 帳單</div>
          </div>
          <button onClick={()=>setPage("main")} style={{
            background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,
            padding:"7px 14px",cursor:"pointer",fontSize:12,fontFamily:"inherit",color:T.muted
          }}>🏠 首頁</button>
        </div>

        <div style={{padding:"20px 16px 40px"}}>
          {/* 月份切換 */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:16}}>
            <button onClick={()=>shiftMonth(-1)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:36,height:36,color:T.text,cursor:"pointer",fontSize:16}}>‹</button>
            <div style={{fontSize:16,fontWeight:800,minWidth:100,textAlign:"center"}}>{monthLabel}</div>
            <button onClick={()=>shiftMonth(1)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:36,height:36,color:T.text,cursor:"pointer",fontSize:16}}>›</button>
          </div>

          {/* 本月總覽 */}
          <div style={{display:"flex",gap:10,marginBottom:10}}>
            <div style={{flex:1,background:T.surface,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
              <div style={{fontSize:11,color:T.muted,marginBottom:4}}>本月總額</div>
              <div style={{fontSize:20,fontWeight:800}}>{fmt(total)}</div>
            </div>
            <div style={{flex:1,background:T.surface,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
              <div style={{fontSize:11,color:T.muted,marginBottom:4}}>繳款進度</div>
              <div style={{fontSize:20,fontWeight:800}}>
                <span style={{color:"#10B981"}}>{paidCount}</span>
                <span style={{color:T.muted}}> / {monthBills.length}</span>
              </div>
            </div>
          </div>
          <div style={{background:T.card,borderRadius:12,padding:"10px 14px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,color:T.muted}}>{billYear} 年度累計</span>
            <span style={{fontSize:15,fontWeight:800,color:T.accent}}>{fmt(annualTotal)}</span>
          </div>

          {/* 缺少的範本 → 產生本月帳單 */}
          {missingTemplatesThisMonth.length>0&&(
            <button onClick={generateMonthBills} disabled={billSaving} style={{
              width:"100%",background:T.accent,color:"#fff",border:"none",borderRadius:12,
              padding:"12px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
              marginBottom:16,opacity:billSaving?0.6:1
            }}>{billSaving?"產生中...":`＋ 產生本月帳單項目（${missingTemplatesThisMonth.length} 筆待補：${missingTemplatesThisMonth.map(t=>t.name).join("、")}）`}</button>
          )}

          {/* 帳單清單 */}
          {monthBills.length===0 ? (
            <div style={{textAlign:"center",color:T.muted,padding:"40px 0",fontSize:13}}>
              本月尚無帳單項目{billTemplates.length===0&&"，先在下方新增帳單範本吧"}
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
              {monthBills.map(b=>{
                if (editingBillId===b.id) return (
                  <div key={b.id} style={{
                    background:T.surface,borderRadius:12,border:`1px solid ${T.accent}40`,
                    padding:"12px 14px",display:"flex",flexDirection:"column",gap:8
                  }}>
                    <div>
                      <div style={labelSt}>名稱</div>
                      <input value={editBillForm.name} onChange={e=>setEditBillForm(f=>({...f,name:e.target.value}))} style={inputSt}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div>
                        <div style={labelSt}>金額</div>
                        <input type="number" step="any" value={editBillForm.amount} onChange={e=>setEditBillForm(f=>({...f,amount:e.target.value}))} style={inputSt}/>
                      </div>
                      <div>
                        <div style={labelSt}>到期日（幾號，選填）</div>
                        <input type="number" min="1" max="31" value={editBillForm.due_day} onChange={e=>setEditBillForm(f=>({...f,due_day:e.target.value}))} style={inputSt}/>
                      </div>
                    </div>
                    <div>
                      <div style={labelSt}>備註（選填）</div>
                      <input value={editBillForm.note} onChange={e=>setEditBillForm(f=>({...f,note:e.target.value}))} style={inputSt}/>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:4}}>
                      <button onClick={()=>saveEditBill(b.id)} style={{
                        flex:1,background:"#10B981",color:"#fff",border:"none",borderRadius:8,
                        padding:"9px 0",cursor:"pointer",fontWeight:700,fontFamily:"inherit"
                      }}>✓ 儲存</button>
                      <button onClick={()=>{setEditingBillId(null);setEditBillForm(null);}} style={{
                        background:T.card,color:T.muted,border:`1px solid ${T.border}`,borderRadius:8,
                        padding:"9px 16px",cursor:"pointer",fontFamily:"inherit"
                      }}>取消</button>
                    </div>
                  </div>
                );
                return (
                <SwipeRow key={b.id} id={b.id} openId={openBillSwipeId} setOpenId={setOpenBillSwipeId}
                  actions={[
                    {key:"edit",icon:"✎",color:T.accent,onClick:()=>startEditBill(b)},
                    {key:"delete",icon:"✕",color:"#EF4444",onClick:()=>deleteBill(b.id)},
                  ]}
                >
                  <div style={{
                    border:`1px solid ${T.border}`,
                    padding:"12px 14px",display:"flex",alignItems:"center",gap:10
                  }}>
                    {b.auto_debit ? (
                      <div style={{
                        flexShrink:0,fontSize:10,fontWeight:700,color:"#60A5FA",background:"#60A5FA22",
                        borderRadius:20,padding:"4px 8px",whiteSpace:"nowrap"
                      }}>🔄 自動</div>
                    ) : (
                      <button onClick={()=>updateBillField(b.id,{paid:!b.paid,paid_date: !b.paid? new Date().toISOString().slice(0,10) : ""})} style={{
                        width:24,height:24,borderRadius:"50%",border:`2px solid ${b.paid?"#10B981":T.border}`,
                        background:b.paid?"#10B981":"transparent",color:"#fff",cursor:"pointer",
                        display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0,padding:0
                      }}>{b.paid?"✓":""}</button>
                    )}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:(b.paid&&!b.auto_debit)?T.muted:T.text,textDecoration:(b.paid&&!b.auto_debit)?"line-through":"none"}}>{b.name}</div>
                      <div style={{fontSize:11,color:T.muted}}>
                        {b.due_day&&`每月${b.due_day}日`}
                        {b.due_day&&b.paid&&b.paid_date&&"・"}
                        {!b.auto_debit&&b.paid&&b.paid_date&&`已繳・${b.paid_date}`}
                        {b.note&&`・${b.note}`}
                      </div>
                    </div>
                    <input
                      type="number" step="any" placeholder="0"
                      defaultValue={b.amount||""}
                      onBlur={e=>{
                        const v=parseFloat(e.target.value)||0;
                        if (v!==b.amount) updateBillField(b.id,{amount:v});
                      }}
                      style={{...inputSt,width:90,textAlign:"right",flexShrink:0}}
                    />
                  </div>
                </SwipeRow>
              );})}
            </div>
          )}

          {/* 不定期帳單：需要手動個別新增，不會自動跳出提示 */}
          {irregularAvailableThisMonth.length>0&&(
            <div style={{marginBottom:24}}>
              <div style={{fontSize:12,color:T.muted,marginBottom:8}}>不定期帳單（本月尚未新增）</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {irregularAvailableThisMonth.map(t=>(
                  <button key={t.id} onClick={()=>addOneBill(t)} disabled={billSaving} style={{
                    background:T.card,border:`1px dashed ${T.border}`,borderRadius:10,
                    padding:"8px 14px",fontSize:12,color:T.muted,cursor:"pointer",fontFamily:"inherit"
                  }}>＋ {t.name}</button>
                ))}
              </div>
            </div>
          )}

          {/* 範本管理 */}
          <div style={{borderTop:`1px solid ${T.border}`,paddingTop:16}}>
            <button onClick={()=>setShowTemplateManager(v=>!v)} style={{
              background:"none",border:"none",color:T.muted,fontSize:12,cursor:"pointer",
              fontFamily:"inherit",padding:0,marginBottom:showTemplateManager?12:0
            }}>{showTemplateManager?"▾":"▸"} 管理帳單範本（{billTemplates.length}）</button>

            {showTemplateManager&&(
              <div>
                <div style={{background:T.card,borderRadius:12,padding:12,marginBottom:12}}>
                  <input
                    value={newTemplateName} onChange={e=>setNewTemplateName(e.target.value)}
                    placeholder="例如：信用卡費、保費、電話費"
                    style={{...inputSt,marginBottom:8}}
                  />
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    <div>
                      <div style={labelSt}>到期日（選填）</div>
                      <input
                        type="number" min="1" max="31" placeholder="例如 5"
                        value={newTemplateDueDay} onChange={e=>setNewTemplateDueDay(e.target.value)}
                        style={inputSt}
                      />
                    </div>
                    <div>
                      <div style={labelSt}>頻率</div>
                      <select value={newTemplateFrequency} onChange={e=>setNewTemplateFrequency(e.target.value)} style={inputSt}>
                        <option value="monthly">每月固定</option>
                        <option value="irregular">不定期</option>
                      </select>
                    </div>
                  </div>
                  <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:T.muted,marginBottom:10,cursor:"pointer"}}>
                    <input type="checkbox" checked={newTemplateAutoDebit} onChange={e=>setNewTemplateAutoDebit(e.target.checked)}/>
                    自動扣款（不用手動勾已繳）
                  </label>
                  <button onClick={addBillTemplate} style={{
                    width:"100%",background:T.accent,color:"#fff",border:"none",borderRadius:8,
                    padding:"9px 0",cursor:"pointer",fontWeight:700,fontFamily:"inherit"
                  }}>新增範本</button>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {billTemplates.map(t=>(
                    <div key={t.id} style={{
                      display:"flex",alignItems:"center",justifyContent:"space-between",
                      background:T.card,borderRadius:8,padding:"8px 12px",fontSize:13
                    }}>
                      <div>
                        <span>{t.name}</span>
                        <span style={{color:T.muted,fontSize:11,marginLeft:8}}>
                          {t.frequency==="irregular"?"不定期":"每月"}
                          {t.due_day?`・每月${t.due_day}日`:""}
                          {t.auto_debit?"・自動扣款":""}
                        </span>
                      </div>
                      <button onClick={()=>deleteBillTemplate(t.id)} style={{
                        background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:13
                      }}>刪除</button>
                    </div>
                  ))}
                  {billTemplates.length===0&&<div style={{fontSize:12,color:T.muted}}>還沒有帳單範本，新增一個開始吧</div>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── EXPENSES (記帳本) ────────────────────────────────────────────────────
  if (page==="expenses") {
    return (
      <div style={pageStyle}>
        {toast&&<Toast toast={toast}/>}
        <div style={{
          background:`linear-gradient(160deg, #1A1D27 0%, #12141E 100%)`,
          padding:"24px 20px 20px",borderBottom:`1px solid ${T.border}`,
          display:"flex",alignItems:"center",justifyContent:"space-between"
        }}>
          <div>
            <div style={{fontSize:11,color:T.muted,letterSpacing:1,marginBottom:4,textTransform:"uppercase"}}>個人記帳本</div>
            <div style={{fontSize:20,fontWeight:800}}>📒 記帳</div>
          </div>
          <button onClick={()=>setPage("main")} style={{
            background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,
            padding:"7px 14px",cursor:"pointer",fontSize:12,fontFamily:"inherit",color:T.muted
          }}>🏠 首頁</button>
        </div>

        <div style={{padding:"20px 16px 40px"}}>
          {/* 月份切換 */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:16}}>
            <button onClick={()=>shiftExpensesMonth(-1)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:36,height:36,color:T.text,cursor:"pointer",fontSize:16}}>‹</button>
            <div style={{fontSize:16,fontWeight:800,minWidth:100,textAlign:"center"}}>{expensesMonthLabel}</div>
            <button onClick={()=>shiftExpensesMonth(1)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:36,height:36,color:T.text,cursor:"pointer",fontSize:16}}>›</button>
          </div>

          {/* 快速新增 */}
          <div style={{background:T.surface,borderRadius:16,border:`1px solid ${T.border}`,padding:16,marginBottom:16}}>
            <div style={{marginBottom:14}}>
              <div style={labelSt}>日期</div>
              <input type="date" value={expenseForm.date} onChange={e=>setExpenseForm(f=>({...f,date:e.target.value}))} style={inputSt}/>
            </div>
            <div style={{marginBottom:14}}>
              <div style={labelSt}>金額（元）</div>
              <input type="number" step="any" placeholder="0" value={expenseForm.amount} onChange={e=>setExpenseForm(f=>({...f,amount:e.target.value}))} style={{...inputSt,fontSize:16}}/>
            </div>

            <div style={{marginBottom:14}}>
              <div style={labelSt}>分類</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {COMMON_EXPENSE_CATEGORIES.map(name=>{
                  const active = expenseForm.category===name;
                  return (
                    <button key={name} type="button"
                      onClick={()=>setExpenseForm(f=>({...f,category:name}))}
                      style={{
                        display:"flex",alignItems:"center",gap:6,
                        background:active?`${T.accent}22`:T.card,
                        border:`1px solid ${active?T.accent:T.border}`,
                        color:active?T.accent:T.text,
                        borderRadius:20,padding:"8px 14px",fontSize:13,fontWeight:active?700:500,
                        cursor:"pointer",fontFamily:"inherit"
                      }}
                    ><span>{expenseCatIcon(name)}</span>{name}</button>
                  );
                })}
              </div>
            </div>

            <div style={{marginBottom:14}}>
              <div style={labelSt}>付款方式</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {PAYMENT_METHODS.map(p=>{
                  const active = expenseForm.payment_method===p;
                  return (
                    <button key={p} type="button"
                      onClick={()=>setExpenseForm(f=>({...f,payment_method:p}))}
                      style={{
                        background:active?`${T.accent}22`:T.card,
                        border:`1px solid ${active?T.accent:T.border}`,
                        color:active?T.accent:T.text,
                        borderRadius:20,padding:"8px 14px",fontSize:13,fontWeight:active?700:500,
                        cursor:"pointer",fontFamily:"inherit"
                      }}
                    >{p}</button>
                  );
                })}
              </div>
            </div>

            <div style={{marginBottom:14}}>
              <div style={labelSt}>備註（選填）</div>
              <textarea
                value={expenseForm.note} onChange={e=>setExpenseForm(f=>({...f,note:e.target.value}))}
                placeholder="例如：五月薪資、家樂福採購..." rows={3}
                style={{...inputSt,resize:"none",lineHeight:1.6}}
              />
            </div>

            <button onClick={addExpense} disabled={expenseSaving} style={{
              width:"100%",background:T.accent,color:"#fff",border:"none",borderRadius:12,
              padding:"14px 0",fontSize:15,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
              opacity:expenseSaving?0.6:1
            }}>{expenseSaving?"記錄中...":"＋ 新增記錄"}</button>
          </div>

          {/* 甜甜圈圖 + 分類佔比 */}
          {expenseCatBreakdown.length>0&&(
            <div style={{
              background:T.surface,borderRadius:16,border:`1px solid ${T.border}`,
              padding:16,marginBottom:16,display:"flex",gap:16,alignItems:"center"
            }}>
              <DonutChart data={expenseCatBreakdown} colors={EXPENSE_PALETTE} size={110} centerLabel="本月支出"/>
              <div style={{flex:1,display:"flex",flexDirection:"column",gap:6,minWidth:0}}>
                {expenseCatBreakdown.slice(0,5).map((c,i)=>(
                  <div key={c.name} style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}>
                    <div style={{width:8,height:8,borderRadius:4,background:EXPENSE_PALETTE[i%EXPENSE_PALETTE.length],flexShrink:0}}/>
                    <div style={{flex:1,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div>
                    <div style={{color:T.muted,flexShrink:0}}>{fmt(c.value)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {expenseCatBreakdown.length===0&&(
            <div style={{textAlign:"center",color:T.muted,padding:"20px 0",fontSize:13}}>本月尚無支出紀錄</div>
          )}

          {/* 明細列表，依日期分組 */}
          {expensesByDate.length>0&&(
            <div style={{marginBottom:24}}>
              {expensesByDate.map(([date,list])=>{
                const dayTotal = list.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
                return (
                  <div key={date} style={{marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",padding:"0 4px 6px",fontSize:12,color:T.muted}}>
                      <span>{date}</span>
                      <span>{fmt(dayTotal)}</span>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {list.map(e=>{
                        if (editingExpenseId===e.id) return (
                          <div key={e.id} style={{
                            background:T.surface,borderRadius:10,border:`1px solid ${T.accent}40`,
                            padding:"12px",display:"flex",flexDirection:"column",gap:8
                          }}>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                              <div>
                                <div style={labelSt}>日期</div>
                                <input type="date" value={editExpenseForm.date} onChange={ev=>setEditExpenseForm(f=>({...f,date:ev.target.value}))} style={inputSt}/>
                              </div>
                              <div>
                                <div style={labelSt}>金額（元）</div>
                                <input type="number" step="any" value={editExpenseForm.amount} onChange={ev=>setEditExpenseForm(f=>({...f,amount:ev.target.value}))} style={inputSt}/>
                              </div>
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                              <div>
                                <div style={labelSt}>分類</div>
                                <select value={editExpenseForm.category} onChange={ev=>setEditExpenseForm(f=>({...f,category:ev.target.value}))} style={inputSt}>
                                  {COMMON_EXPENSE_CATEGORIES.map(c=><option key={c} value={c}>{expenseCatIcon(c)} {c}</option>)}
                                </select>
                              </div>
                              <div>
                                <div style={labelSt}>付款方式</div>
                                <select value={editExpenseForm.payment_method} onChange={ev=>setEditExpenseForm(f=>({...f,payment_method:ev.target.value}))} style={inputSt}>
                                  {PAYMENT_METHODS.map(p=><option key={p} value={p}>{p}</option>)}
                                </select>
                              </div>
                            </div>
                            <div>
                              <div style={labelSt}>備註（選填）</div>
                              <input value={editExpenseForm.note} onChange={ev=>setEditExpenseForm(f=>({...f,note:ev.target.value}))} style={inputSt}/>
                            </div>
                            <div style={{display:"flex",gap:8,marginTop:4}}>
                              <button onClick={()=>saveEditExpense(e.id)} style={{
                                flex:1,background:"#10B981",color:"#fff",border:"none",borderRadius:8,
                                padding:"9px 0",cursor:"pointer",fontWeight:700,fontFamily:"inherit"
                              }}>✓ 儲存</button>
                              <button onClick={()=>{setEditingExpenseId(null);setEditExpenseForm(null);}} style={{
                                background:T.card,color:T.muted,border:`1px solid ${T.border}`,borderRadius:8,
                                padding:"9px 16px",cursor:"pointer",fontFamily:"inherit"
                              }}>取消</button>
                            </div>
                          </div>
                        );
                        return (
                        <SwipeRow key={e.id} id={e.id} openId={openExpenseSwipeId} setOpenId={setOpenExpenseSwipeId}
                          borderRadius={10}
                          actions={[
                            {key:"edit",icon:"✎",color:T.accent,onClick:()=>startEditExpense(e)},
                            {key:"delete",icon:"✕",color:"#EF4444",onClick:()=>deleteExpense(e.id)},
                          ]}
                        >
                          <div style={{
                            border:`1px solid ${T.border}`,
                            padding:"10px 12px",display:"flex",alignItems:"center",gap:10
                          }}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:700,color:T.text}}>{expenseCatIcon(e.category)} {e.category}</div>
                              <div style={{fontSize:11,color:T.muted}}>
                                {e.payment_method}{e.note?`・${e.note}`:""}
                              </div>
                            </div>
                            <div style={{fontSize:14,fontWeight:700,color:T.text,flexShrink:0}}>{fmt(parseFloat(e.amount)||0)}</div>
                          </div>
                        </SwipeRow>
                      );})}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── MAIN ──────────────────────────────────────────────────────────────────
  return (
    <div style={pageStyle}>
      {toast&&<Toast toast={toast}/>}

      {/* Hero header */}
      <div style={{
        background:`linear-gradient(160deg, #1A1D27 0%, #12141E 100%)`,
        padding:"32px 20px 28px",
        borderBottom:`1px solid ${T.border}`,
      }}>
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,color:T.muted,letterSpacing:1,marginBottom:6,textTransform:"uppercase"}}>
            {dateStr} · {ownerFilter==="全部"?"全部資產":ownerFilter}
            {fxUpdated&&<span style={{marginLeft:8,color:"#10B981"}}>● 匯率即時</span>}
          </div>
          <div style={{fontSize:36,fontWeight:900,letterSpacing:-1,lineHeight:1}}>{fmt(totalValue)}</div>
        </div>

        {/* 橫向導覽列 */}
        <div style={{display:"flex",gap:8,marginBottom:24}}>
          <button onClick={()=>setShowSnapshotModal(true)} disabled={snapshotting} style={{
            flex:1,background:T.accent,border:"none",borderRadius:12,
            padding:"12px 4px",cursor:"pointer",fontSize:13,fontFamily:"inherit",color:"#fff",fontWeight:700,
            display:"flex",flexDirection:"column",alignItems:"center",gap:4,
            opacity:snapshotting?0.6:1
          }}><span style={{fontSize:18}}>📸</span>{snapshotting?"...":"快照"}</button>
          <button onClick={()=>setPage("history")} style={{
            flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,
            padding:"12px 4px",cursor:"pointer",fontSize:13,fontFamily:"inherit",color:T.muted,
            display:"flex",flexDirection:"column",alignItems:"center",gap:4
          }}><span style={{fontSize:18}}>📈</span>歷史</button>
          <button onClick={()=>setPage("breakdown")} style={{
            flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,
            padding:"12px 4px",cursor:"pointer",fontSize:13,fontFamily:"inherit",color:T.muted,
            display:"flex",flexDirection:"column",alignItems:"center",gap:4
          }}><span style={{fontSize:18}}>📊</span>分類</button>
          <button onClick={()=>setPage("bills")} style={{
            flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,
            padding:"12px 4px",cursor:"pointer",fontSize:13,fontFamily:"inherit",color:T.muted,
            display:"flex",flexDirection:"column",alignItems:"center",gap:4
          }}><span style={{fontSize:18}}>🧾</span>帳單</button>
          <button onClick={()=>setPage("expenses")} style={{
            flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,
            padding:"12px 4px",cursor:"pointer",fontSize:13,fontFamily:"inherit",color:T.muted,
            display:"flex",flexDirection:"column",alignItems:"center",gap:4
          }}><span style={{fontSize:18}}>📒</span>記帳</button>
        </div>

        {/* Donut + legend */}
        <div style={{display:"flex",alignItems:"center",gap:16,justifyContent:"center"}}>
          <div style={{flexShrink:0}}>
            <DonutChart data={bankBreakdown} colors={Object.values(BANK_COLORS)} size={140}/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8,minWidth:0}}>
            {bankBreakdown.slice(0,6).map((b,i)=>{
              const col=Object.values(BANK_COLORS)[i%9];
              return (
                <div key={b.name} style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:8,height:8,borderRadius:2,background:col,flexShrink:0}}/>
                  <span style={{fontSize:13,color:T.muted,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.name}</span>
                  <span style={{fontSize:13,fontWeight:700,color:T.text,minWidth:38,textAlign:"right"}}>{pct(b.value).toFixed(1)}%</span>
                  <span style={{fontSize:11,color:T.muted,minWidth:46,textAlign:"right"}}>{fmt(b.value)}</span>
                </div>
              );
            })}
          </div>
        </div>


      </div>

      {/* Owner filter */}
      <div style={{padding:"16px 20px 0",display:"flex",gap:6}}>
        {["全部","本人","共有"].map(o=>(
          <button key={o} onClick={()=>setOwnerFilter(o)} style={{
            background:ownerFilter===o?T.accent:T.surface,
            color:ownerFilter===o?"#fff":T.muted,
            border:`1px solid ${ownerFilter===o?T.accent:T.border}`,
            borderRadius:20,padding:"5px 16px",
            fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"
          }}>{o}</button>
        ))}
      </div>

      {/* Bank tree */}
      <div style={{padding:"16px 20px 0"}}>
        {banks.map(bank=>{
          const bCol=BANK_COLORS[bank]||"#888",bVal=bankTotal(bank),bPct=pct(bVal),bOpen=isBankOpen(bank);
          const accts=[...new Set(assets.filter(a=>a.bank===bank).map(a=>a.account))]
            .sort((x,y)=>{
              const ix=ALL_ACCOUNTS.indexOf(x), iy=ALL_ACCOUNTS.indexOf(y);
              return (ix===-1?99:ix)-(iy===-1?99:iy);
            });
          return (
            <div key={bank} style={{marginBottom:10}}>
              {/* Bank header */}
              <div onClick={()=>toggleBank(bank)} style={{
                display:"flex",alignItems:"center",gap:10,
                padding:"14px 16px",borderRadius:16,
                background:T.surface,border:`1px solid ${T.border}`,
                cursor:"pointer",userSelect:"none"
              }}>
                <div style={{width:4,height:32,borderRadius:2,background:bCol,flexShrink:0}}/>
                <span style={{fontWeight:800,fontSize:15,flex:1}}>{bank}</span>
                {(bank==="國泰(共有)"||bank==="永豐(共有)")&&(
                  <span style={{fontSize:10,background:"#F472B620",color:"#F472B6",borderRadius:8,padding:"2px 8px",fontWeight:700}}>共有</span>
                )}
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:15,fontWeight:800,color:bank==="中國信託"?"#FFE603":T.text}}>{fmt(bVal)}</div>
                  <div style={{fontSize:11,color:T.muted}}>{bPct.toFixed(1)}%</div>
                </div>
                <span style={{color:T.muted,fontSize:16,transition:"transform 0.2s",transform:bOpen?"rotate(90deg)":"rotate(0deg)",display:"inline-block"}}>›</span>
              </div>

              {bOpen&&(
                <div style={{paddingLeft:12,marginTop:4}}>
                  <div style={{display:"flex"}}>
                    <div style={{width:2,background:bCol+"40",borderRadius:2,margin:"4px 10px 4px 9px",flexShrink:0}}/>
                    <div style={{flex:1}}>
                      {accts.map(acct=>{
                        const aCol=ACCT_COLORS[acct]||"#888",aVal=acctTotal(bank,acct),aPct=pct(aVal),aOpen=isAcctOpen(bank,acct);
                        const rows=filtered.filter(a=>a.bank===bank&&a.account===acct);
                        return (
                          <div key={acct} style={{marginBottom:6}}>
                            <div onClick={()=>toggleAcct(bank,acct)} style={{
                              display:"flex",alignItems:"center",gap:8,
                              padding:"8px 12px",borderRadius:10,
                              background:T.card,border:`1px solid ${T.border}`,
                              cursor:"pointer",userSelect:"none",marginBottom:3
                            }}>
                              <div style={{width:6,height:6,borderRadius:"50%",background:aCol}}/>
                              <span style={{fontWeight:700,fontSize:13,flex:1,color:T.text}}>{acct}</span>
                              <span style={{fontSize:12,color:T.muted}}>{fmt(aVal)}</span>
                              <span style={{fontSize:12,fontWeight:700,color:aCol,minWidth:36,textAlign:"right"}}>{aPct.toFixed(1)}%</span>
                              <span style={{color:T.muted,fontSize:13,transition:"transform 0.2s",transform:aOpen?"rotate(90deg)":"rotate(0deg)",display:"inline-block"}}>›</span>
                            </div>

                            {aOpen&&rows.map(asset=>{
                              const twdVal=assetTWD(asset),aBarW=Math.min(100,Math.round(pct(twdVal)));
                              const isFx=asset.currency&&asset.currency!=="TWD";
                              if (editingId===asset.id) return (
                                <div key={asset.id} style={{
                                  background:T.surface,borderRadius:12,border:`1px solid ${T.accent}40`,
                                  padding:"12px",marginBottom:4,display:"flex",flexWrap:"wrap",gap:8,alignItems:"flex-end"
                                }}>
                                  {(() => {
                                    const eAcctOpts = ACCT_OPTIONS[editForm.account] || {cats:ALL_CATS, currencies:SUPPORTED_CURRENCIES};
                                    const fields = [
                                      {label:"名稱",key:"name",kind:"text"},
                                      {label:"銀行",key:"bank",kind:"bank-select"},
                                      {label:"帳戶",key:"account",kind:"account-select"},
                                      {label:"類別",key:"category",kind:"select",options:eAcctOpts.cats},
                                      {label:"幣別",key:"currency",kind:"select",options:eAcctOpts.currencies,labelMap:CURRENCY_LABELS},
                                      {label:"數量",key:"quantity",kind:"text"},
                                      {label:`金額（${CURRENCY_LABELS[editForm.currency]||editForm.currency||"TWD"}）`,key:"original_value",kind:"number"},
                                    ];
                                    return fields.map(({label,key,kind,options,labelMap})=>(
                                      <div key={key} style={{flex:`1 1 ${["name","original_value"].includes(key)?"100px":"80px"}`}}>
                                        <div style={labelSt}>{label}</div>
                                        {kind==="bank-select" ? (
                                          <select value={editForm.bank||""} onChange={e=>{
                                            const b=e.target.value;
                                            setEditForm(f=>({...f,bank:b,owner:ownerForBank(b)}));
                                          }} style={inputSt}>
                                            {ALL_BANKS.map(o=><option key={o} value={o}>{o}</option>)}
                                          </select>
                                        ) : kind==="account-select" ? (
                                          <select value={editForm.account||""} onChange={e=>{
                                            const ac=e.target.value;
                                            const opts=ACCT_OPTIONS[ac]||{cats:ALL_CATS,currencies:SUPPORTED_CURRENCIES};
                                            setEditForm(f=>({...f,account:ac,category:opts.cats[0],currency:opts.currencies[0]}));
                                          }} style={inputSt}>
                                            {ALL_ACCOUNTS.map(o=><option key={o} value={o}>{o}</option>)}
                                          </select>
                                        ) : kind==="select" ? (
                                          <select value={editForm[key]||""} onChange={e=>setEditForm(f=>({...f,[key]:e.target.value}))} style={inputSt}>
                                            {options.map(o=><option key={o} value={o}>{(labelMap&&labelMap[o])||o}</option>)}
                                          </select>
                                        ) : (
                                          <input type={kind==="number"?"number":"text"} step={kind==="number"?"any":undefined}
                                            value={editForm[key]||""} onChange={e=>setEditForm(f=>({...f,[key]:e.target.value}))} style={inputSt}/>
                                        )}
                                      </div>
                                    ));
                                  })()}
                                  <div style={{display:"flex",gap:6}}>
                                    <button onClick={()=>saveEdit(asset.id)} disabled={saving} style={{background:"#10B981",color:"#fff",border:"none",borderRadius:8,padding:"7px 16px",cursor:"pointer",fontWeight:700,fontFamily:"inherit",opacity:saving?0.6:1}}>{saving?"...":"✓"}</button>
                                    <button onClick={()=>setEditingId(null)} style={{background:T.card,color:T.muted,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 12px",cursor:"pointer",fontFamily:"inherit"}}>✕</button>
                                  </div>
                                </div>
                              );

                              return (
                                <div key={asset.id} onClick={()=>startEdit(asset)} style={{
                                  display:"flex",alignItems:"center",gap:8,
                                  padding:"10px 12px 10px 20px",borderRadius:10,
                                  border:`1px solid ${T.border}`,background:T.card,
                                  marginBottom:3,cursor:"pointer",opacity:twdVal===0?0.4:1
                                }}>
                                  <span style={{flex:1,fontSize:13,fontWeight:500}}>{asset.name}</span>
                                  {asset.owner!=="本人"&&<span style={{fontSize:9,background:"#F472B620",color:"#F472B6",borderRadius:6,padding:"1px 6px",fontWeight:700}}>共有</span>}
                                  {isFx&&<span style={{fontSize:11,color:T.accent}}>{fmtOrig(asset.original_value,asset.currency)}</span>}
                                  <span style={{fontSize:11,color:T.muted,minWidth:52,textAlign:"right"}}>{asset.quantity}</span>
                                  <div style={{width:44,height:3,borderRadius:2,background:T.border,overflow:"hidden"}}>
                                    <div style={{width:`${aBarW}%`,height:"100%",background:aCol,borderRadius:2}}/>
                                  </div>
                                  <span style={{fontSize:12,fontWeight:700,minWidth:52,textAlign:"right"}}>{twdVal?fmt(twdVal):"未填"}</span>
                                  <span style={{fontSize:11,color:aCol,minWidth:34,textAlign:"right"}}>{twdVal?pct(twdVal).toFixed(1)+"%":"—"}</span>
                                  <button onClick={e=>{e.stopPropagation();deleteAsset(asset.id);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:T.muted,padding:"0 2px"}}>✕</button>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* FX bar - bottom */}
      {Object.keys(fxRates).length>0&&(
        <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",padding:"12px 20px 0",opacity:0.45}}>
          {["USD","JPY"].map(c=>{
            const rate=fxRates[c];
            if (!rate) return null;
            return (
              <div key={c} style={{fontSize:11,color:T.muted}}>
                <span>{c} </span>
                <span style={{fontWeight:600}}>{rate.toFixed(2)}</span>
              </div>
            );
          })}
          {fxUpdated&&<div style={{fontSize:10,color:T.muted,width:"100%",textAlign:"center"}}>匯率更新：{fxUpdated.toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}</div>}
        </div>
      )}

      <div style={{textAlign:"center",padding:"10px 20px 0"}}>
        <button onClick={()=>{ clearSheetsConfig(); setConfigured(false); }} style={{
          background:"none",border:"none",color:T.muted,fontSize:10,opacity:0.4,
          cursor:"pointer",fontFamily:"inherit"
        }}>⚙ 重新設定試算表連線</button>
      </div>

      {/* FAB Add */}
      <button onClick={()=>setShowAdd(true)} style={{
        position:"fixed",bottom:28,right:24,
        width:56,height:56,borderRadius:"50%",
        background:`linear-gradient(135deg,${T.accent},#5B8CF5)`,
        border:"none",cursor:"pointer",
        fontSize:28,color:"#fff",fontWeight:300,
        boxShadow:"0 8px 24px rgba(124,110,247,0.5)",
        display:"flex",alignItems:"center",justifyContent:"center",
        lineHeight:1,zIndex:100
      }}>+</button>

      {/* Snapshot modal */}
      <SnapshotModal
        show={showSnapshotModal}
        dateStr={dateStr}
        totalValue={totalValue}
        snapshotNote={snapshotNote}
        setSnapshotNote={setSnapshotNote}
        snapshotting={snapshotting}
        onConfirm={()=>takeSnapshot(snapshotNote)}
        onCancel={()=>{setShowSnapshotModal(false);setSnapshotNote("");}}
      />

      {/* Add modal */}
      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:1000}}>
          <div style={{
            background:T.surface,borderRadius:"20px 20px 0 0",padding:"28px 24px 40px",
            width:"100%",maxWidth:500,
            boxShadow:"0 -8px 40px rgba(0,0,0,0.5)",maxHeight:"85vh",overflowY:"auto"
          }}>
            <div style={{width:36,height:4,borderRadius:2,background:T.border,margin:"0 auto 20px"}}/>
            <h3 style={{margin:"0 0 4px",fontSize:18,fontWeight:800}}>新增資產</h3>
            <p style={{margin:"0 0 20px",fontSize:12,color:T.muted}}>外幣依即時匯率自動換算</p>
            {(() => {
              const acctOpts = ACCT_OPTIONS[addForm.account] || {cats:ALL_CATS, currencies:SUPPORTED_CURRENCIES};
              const fields = [
                {label:"銀行", key:"bank", kind:"bank-select"},
                {label:"帳戶類型", key:"account", kind:"account-select"},
                {label:"資產類別", key:"category", kind:"select", options:acctOpts.cats},
                {label:"名稱", key:"name", kind:"text", placeholder:"e.g. 台幣存款"},
                {label:"幣別", key:"currency", kind:"select", options:acctOpts.currencies, labelMap:CURRENCY_LABELS},
                {label:"數量（選填，股數）", key:"quantity", kind:"text", placeholder:"e.g. 100"},
                {label:`金額（${CURRENCY_LABELS[addForm.currency]||addForm.currency}）`, key:"original_value", kind:"number", placeholder:"e.g. 50000"},
              ];
              return fields.map(({label,key,kind,options,placeholder,labelMap}) => (
                <div key={key} style={{marginBottom:14}}>
                  <label style={labelSt}>{label}</label>
                  {kind==="bank-select" ? (
                    <select value={addForm.bank} onChange={e=>{
                      const b = e.target.value;
                      setAddForm(f=>({...f, bank:b, owner:ownerForBank(b)}));
                    }} style={inputSt}>
                      {ALL_BANKS.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : kind==="account-select" ? (
                    <select value={addForm.account} onChange={e=>{
                      const ac = e.target.value;
                      const opts = ACCT_OPTIONS[ac] || {cats:ALL_CATS, currencies:SUPPORTED_CURRENCIES};
                      setAddForm(f=>({...f, account:ac, category:opts.cats[0], currency:opts.currencies[0]}));
                    }} style={inputSt}>
                      {ALL_ACCOUNTS.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : kind==="select" ? (
                    <select value={addForm[key]} onChange={e=>setAddForm(f=>({...f,[key]:e.target.value}))} style={inputSt}>
                      {options.map(o=><option key={o} value={o}>{(labelMap&&labelMap[o])||o}</option>)}
                    </select>
                  ) : (
                    <input
                      placeholder={placeholder}
                      type={kind==="number"?"number":"text"}
                      step={kind==="number"?"any":undefined}
                      value={addForm[key]} onChange={e=>setAddForm(f=>({...f,[key]:e.target.value}))} style={inputSt}/>
                  )}
                </div>
              ));
            })()}
            {addForm.original_value&&parseFloat(addForm.original_value)>0&&(
              <div style={{background:T.bg,borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12}}>
                <span style={{color:T.muted}}>新增後佔比：</span>
                <strong style={{color:T.accent}}>{(toTWD(parseFloat(addForm.original_value),addForm.currency)/(totalValue+toTWD(parseFloat(addForm.original_value),addForm.currency))*100).toFixed(1)}%</strong>
              </div>
            )}
            <div style={{display:"flex",gap:10,marginTop:4}}>
              <button onClick={addAsset} disabled={saving} style={{
                flex:1,background:T.accent,color:"#fff",border:"none",
                borderRadius:12,padding:"13px 0",fontSize:15,fontWeight:700,
                cursor:"pointer",fontFamily:"inherit",opacity:saving?0.6:1
              }}>{saving?"新增中...":"確認新增"}</button>
              <button onClick={()=>setShowAdd(false)} style={{
                flex:0,background:T.card,color:T.muted,border:`1px solid ${T.border}`,
                borderRadius:12,padding:"13px 20px",fontSize:15,
                cursor:"pointer",fontFamily:"inherit"
              }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}