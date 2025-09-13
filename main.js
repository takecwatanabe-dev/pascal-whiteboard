// Note – Link (Whiteboard) v0.5.0
// - ベクター手書き（ズームしても薄くならない / ページごと保持）
// - 手のひらのみピンチズーム可 / ペン・消しゴム中は無効
// - スワイプでページ送り（プレビュー + フリック）
// - IndexedDB でPDF・ページ・ズーム・ツール・手書きを保存＆復元
// - Firebase コラボ（セッション作成 / リンク配布 / PDF配布 / ストローク＆ページ＆ズーム同期）
// - Gemini 採点UI（先生レビュー/自動返却を選択）
// - ピンチ中は CSS transform だけ → 指を離したタイミングで pdf.js 再描画（速度統一）

/* ====== 設定（後で差し替えOK） ====== */
// Firebase 設定（Firebase Consoleの “firebaseConfig” を貼り付け）
const FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:XXXXXXXXXXXXXX"
};

// Gemini APIキー（Google Cloud Console > APIとサービス > 認証情報で発行）
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";

/* ====== pdf.js worker ====== */
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
} else {
  alert("pdf.js の読み込みに失敗しました。index.html の <script> を確認してください。");
}

/* ====== IndexedDB（ローカル保存） ====== */
const DB_NAME="note-link", STORE="state";
function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB_NAME,1); r.onupgradeneeded=()=>r.result.createObjectStore(STORE); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function saveKV(key, value){ const db=await idb(); const tx=db.transaction(STORE,"readwrite"); tx.objectStore(STORE).put(value,key); return new Promise(r=>tx.oncomplete=r); }
async function loadKV(key){ const db=await idb(); const tx=db.transaction(STORE,"readonly"); const req=tx.objectStore(STORE).get(key); return new Promise(r=>{ req.onsuccess=()=>r(req.result); }); }

/* ====== Firebase（互換SDKをCDNで動的ロード） ====== */
let fb = { app:null, auth:null, db:null, storage:null, user:null, roomRef:null, strokesRef:null };
let roomId = null;           // URL ?room=xxx
let linkMode = "local";      // 'local' | 'view' | 'edit' | 'teacher'
const fbReady = (async () => {
  if (window.firebase) return;
  async function add(src){ await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
  await add('https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js');
  await add('https://www.gstatic.com/firebasejs/10.12.3/firebase-auth-compat.js');
  await add('https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore-compat.js');
  await add('https://www.gstatic.com/firebasejs/10.12.3/firebase-storage-compat.js');
  firebase.initializeApp(FIREBASE_CONFIG);
})();
async function initFirebaseIfNeeded() {
  await fbReady;
  fb.app     = firebase.app();
  fb.auth    = firebase.auth();
  fb.db      = firebase.firestore();
  fb.storage = firebase.storage();
  if (!fb.user) { await fb.auth.signInAnonymously(); fb.user = fb.auth.currentUser; }
}

/* ====== URL パラメータ ====== */
(function parseQuery(){
  const q = new URL(location.href).searchParams;
  roomId   = q.get('room');
  const m  = q.get('mode');
  if (m === 'view' || m === 'edit' || m === 'teacher') linkMode = m;
})();

/* ====== DOM ====== */
const fileInput    = document.getElementById("file-input");
const stage        = document.getElementById("stage");
const pageLayer    = document.getElementById("page-layer");
const pdfContainer = document.getElementById("pdf-container");
const drawCanvas   = document.getElementById("draw-layer");
const dctx         = drawCanvas.getContext("2d");

const btnPrev   = document.getElementById("prev-page");
const btnNext   = document.getElementById("next-page");
const pageInfo  = document.getElementById("page-info");
const btnZoomOut= document.getElementById("zoom-out");
const btnZoomIn = document.getElementById("zoom-in");
const zoomLabel = document.getElementById("zoom-label");
const zoomReset = document.getElementById("zoom-reset");

const menuToggle= document.getElementById("menu-toggle");
const edgeToggle= document.getElementById("edge-toggle");
const sidebar   = document.getElementById("sidebar");
const body      = document.body;

const toolPen    = document.getElementById("tool-pen");
const toolEraser = document.getElementById("tool-eraser");
const toolHand   = document.getElementById("tool-hand");
const clearBtn   = document.getElementById("clear");
const colorPicker= document.getElementById("color-picker");
const sizePicker = document.getElementById("size-picker");
const exportBtn  = document.getElementById("export");

const roleBadge   = document.getElementById('role-badge');
const btnStart    = document.getElementById('start-session');
const btnT        = document.getElementById('copy-teacher');
const btnV        = document.getElementById('copy-view');
const btnE        = document.getElementById('copy-edit');

const paperTypeSel= document.getElementById('paper-type');

/* 採点UI */
const qText = document.getElementById("q-text");
const aText = document.getElementById("a-text");
const sText = document.getElementById("s-text");
const maxScoreInput = document.getElementById("max-score");
const returnModeSel = document.getElementById("return-mode");
const gradeRunBtn = document.getElementById("grade-run");
const gradeResultBox = document.getElementById("grade-result");

/* ====== 状態 ====== */
const BASE_SCALE=1.0, STEP=0.1, ZMIN=0.5, ZMAX=3.0;
let pdfDoc=null, currentPage=1, totalPages=0, zoom=1.0;
let currentTool="pen";
let currentPaper="pdf"; // 'pdf'|'plain'|'ruled'|'grid'|'genkou'

// ページごとの手書き（ベクター）
const strokesByPage = new Map();
const getStrokes = (p)=> (strokesByPage.get(p) || (strokesByPage.set(p,[]), strokesByPage.get(p)));

// 役割UI
function setRoleBadge(r){ roleBadge.textContent = r; roleBadge.className = 'pill'; }

/* ====== レンダリング ====== */
async function renderPage(n){
  if (currentPaper === 'pdf' && pdfDoc) {
    const page = await pdfDoc.getPage(n);
    const viewport = page.getViewport({ scale: BASE_SCALE*zoom });

    // PDFキャンバスを貼り直し
    pdfContainer.innerHTML = "";
    const pdfCanvas = document.createElement("canvas");
    pdfCanvas.width = Math.floor(viewport.width);
    pdfCanvas.height= Math.floor(viewport.height);
    pdfCanvas.style.display="block";
    pdfContainer.appendChild(pdfCanvas);
    await page.render({ canvasContext: pdfCanvas.getContext("2d"), viewport }).promise;

    // 手書きキャンバスもサイズ合わせ
    drawCanvas.width = pdfCanvas.width;
    drawCanvas.height= pdfCanvas.height;
    drawCanvas.classList.remove("paper-plain","paper-ruled","paper-grid","paper-genkou");
  } else {
    // ノート紙面：PDFを使わず背景だけ
    const W = Math.round(900*zoom), H = Math.round(1200*zoom);
    pdfContainer.innerHTML = "";
    const bg = document.createElement("div");
    bg.style.width = W+"px"; bg.style.height = H+"px";
    bg.style.margin = "0 auto";
    bg.className = {
      plain: "paper-plain",
      ruled: "paper-ruled",
      grid : "paper-grid",
      genkou:"paper-genkou"
    }[currentPaper] || "paper-plain";
    pdfContainer.appendChild(bg);
    drawCanvas.width = W; drawCanvas.height = H;
  }

  // ベクター再描画
  redrawStrokes();

  // UI
  pageInfo.textContent = (currentPaper==='pdf' && pdfDoc) ? `${n} / ${totalPages}` : `ノート`;
  btnPrev.disabled = (currentPaper==='pdf' ? n<=1 : true);
  btnNext.disabled = (currentPaper==='pdf' ? n>=totalPages : true);
  zoomLabel.textContent = Math.round(zoom*100)+"%";
  btnZoomOut.disabled = (zoom<=ZMIN);
  btnZoomIn.disabled  = (zoom>=ZMAX);

  // 保存
  persistState();
}

function redrawStrokes(){
  dctx.clearRect(0,0,drawCanvas.width,drawCanvas.height);
  for(const s of getStrokes(currentPage)){
    drawStroke(s);
  }
}
function drawStroke(s){
  dctx.save();
  dctx.lineCap="round"; dctx.lineJoin="round";
  dctx.globalCompositeOperation=(s.mode==="eraser")?"destination-out":"source-over";
  dctx.strokeStyle=(s.mode==="eraser")?"#000":s.color;
  dctx.lineWidth=s.size*zoom;
  dctx.beginPath();
  s.points.forEach((pt,i)=>{
    const x=pt.xN*drawCanvas.width, y=pt.yN*drawCanvas.height;
    if(i===0) dctx.moveTo(x,y); else dctx.lineTo(x,y);
  });
  dctx.stroke(); dctx.restore();
}

/* ====== PDF 読み込み ====== */
fileInput.addEventListener("change", async (e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  // ローカル保存（IndexedDB）
  const buf=await file.arrayBuffer();
  await saveKV("pdf-bytes", buf);
  currentPaper = "pdf";
  await openPdfFromBytes(buf);

  // 共有セッション中なら Storage へアップロードし、room に配布URLを保存
  try { await uploadPdfToRoom(file); } catch {}
});

async function openPdfFromBytes(buf){
  const uint=new Uint8Array(buf);
  pdfDoc=await pdfjsLib.getDocument({data:uint}).promise;
  totalPages=pdfDoc.numPages; if(currentPage>totalPages) currentPage=1;
  await renderPage(currentPage);
  stage.scrollTo({left:0, top:0, behavior:"instant"});
  // 公開フック
  window.__OPEN_PDF_BYTES = openPdfFromBytes;
}

/* ====== ページ移動 ====== */
window.__GOTO_PAGE = async (p, opt={})=>{
  if (currentPaper!=='pdf' || !pdfDoc) return;
  currentPage = Math.max(1, Math.min(totalPages, p));
  await renderPage(currentPage);
  if (!opt.fromRemote) syncPageZoom('page', currentPage);
  window.__CURRENT_PAGE = currentPage;
};
btnPrev.addEventListener("click", ()=> window.__GOTO_PAGE(currentPage-1));
btnNext.addEventListener("click", ()=> window.__GOTO_PAGE(currentPage+1));

/* ====== ズーム ====== */
window.__SET_ZOOM = async (z, opt={})=>{
  zoom = Math.max(ZMIN, Math.min(ZMAX, +(+z).toFixed(2)));
  // ピンチ中のtransformは touchハンドラ側で。ここは本描画。
  await renderPage(currentPage);
  if (!opt.fromRemote) syncPageZoom('zoom', zoom);
};
btnZoomOut.addEventListener("click", ()=> window.__SET_ZOOM(zoom-STEP));
btnZoomIn .addEventListener("click", ()=> window.__SET_ZOOM(zoom+STEP));
zoomReset  .addEventListener("click", ()=> window.__SET_ZOOM(1.0));

/* ====== ツール ====== */
function setTool(t){
  currentTool=t;
  toolPen.classList.toggle("active", t==="pen");
  toolEraser.classList.toggle("active", t==="eraser");
  toolHand.classList.toggle("active", t==="hand");
  body.classList.toggle("hand-mode", t==="hand");
  persistState();
}
toolPen   .addEventListener("click", ()=>setTool("pen"));
toolEraser.addEventListener("click", ()=>setTool("eraser"));
toolHand  .addEventListener("click", ()=>setTool("hand"));

clearBtn.addEventListener("click", ()=>{
  strokesByPage.set(currentPage,[]);
  redrawStrokes(); persistState();
});

/* ====== ノート紙面 ====== */
paperTypeSel.addEventListener("change", async ()=>{
  currentPaper = paperTypeSel.value; // 'pdf'|'plain'|'ruled'|'grid'|'genkou'
  await renderPage(currentPage);
});

/* ====== 手書き ====== */
let drawing=false, currentStroke=null;
const norm=(ev)=>{
  const rect=drawCanvas.getBoundingClientRect();
  const t=ev.touches?.[0];
  const x=(t?t.clientX:ev.clientX)-rect.left, y=(t?t.clientY:ev.clientY)-rect.top;
  return {xN:Math.max(0,Math.min(1,x/drawCanvas.width)), yN:Math.max(0,Math.min(1,y/drawCanvas.height))};
};
function startDraw(ev){
  if (currentTool==="hand") return;
  drawing=true;
  currentStroke={mode:currentTool, color:colorPicker.value, size:+sizePicker.value, points:[norm(ev)]};
  ev.preventDefault?.();
}
function moveDraw(ev){
  if(!drawing||!currentStroke) return;
  currentStroke.points.push(norm(ev));
  // プレビュー
  dctx.clearRect(0,0,drawCanvas.width,drawCanvas.height);
  getStrokes(currentPage).forEach(drawStroke);
  drawStroke(currentStroke);
  ev.preventDefault?.();
}
async function endDraw(){
  if(!drawing||!currentStroke){ drawing=false; return; }
  getStrokes(currentPage).push(currentStroke);
  drawing=false; const finished = currentStroke; currentStroke=null;
  redrawStrokes(); persistState();
  // 共同編集へ送信
  try { await sendStrokeToRoom(finished, currentPage); } catch {}
}
drawCanvas.addEventListener("mousedown", startDraw);
drawCanvas.addEventListener("mousemove", moveDraw);
window.addEventListener("mouseup", endDraw);
drawCanvas.addEventListener("touchstart", startDraw, {passive:false});
drawCanvas.addEventListener("touchmove",  moveDraw,   {passive:false});
drawCanvas.addEventListener("touchend",   endDraw);

/* ====== PNG出力 ====== */
exportBtn.addEventListener("click", ()=>{
  const pdfCanvas = pdfContainer.querySelector("canvas");
  const baseW = drawCanvas.width, baseH = drawCanvas.height;
  const out=document.createElement("canvas");
  out.width = baseW; out.height= baseH;
  const octx=out.getContext("2d");

  if (pdfCanvas) octx.drawImage(pdfCanvas,0,0);
  else {
    // ノート紙面の背景を描画（簡易）
    const bg=document.createElement("canvas"); bg.width=baseW; bg.height=baseH;
    const g=bg.getContext("2d");
    g.fillStyle="#fff"; g.fillRect(0,0,baseW,baseH);
    if (currentPaper==='ruled'){
      g.strokeStyle="#e3e7ee"; g.lineWidth=1;
      for(let y=28;y<baseH;y+=28){ g.beginPath(); g.moveTo(0,y); g.lineTo(baseW,y); g.stroke(); }
    } else if (currentPaper==='grid'){
      g.strokeStyle="rgba(0,0,0,.08)"; g.lineWidth=1;
      for(let x=16;x<baseW;x+=16){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,baseH); g.stroke(); }
      for(let y=16;y<baseH;y+=16){ g.beginPath(); g.moveTo(0,y); g.lineTo(baseW,y); g.stroke(); }
    } else if (currentPaper==='genkou'){
      g.strokeStyle="rgba(0,0,0,.1)"; g.lineWidth=1;
      for(let x=24;x<baseW;x+=24){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,baseH); g.stroke(); }
      for(let y=24;y<baseH;y+=24){ g.beginPath(); g.moveTo(0,y); g.lineTo(baseW,y); g.stroke(); }
    }
    octx.drawImage(bg,0,0);
  }
  octx.drawImage(drawCanvas,0,0);

  const a=document.createElement("a");
  a.download=`note-link-page${currentPage}.png`;
  a.href=out.toDataURL("image/png"); a.click();
});

/* ====== ツールバー開閉 ====== */
function setSidebar(open){
  sidebar.classList.toggle("open", open);
  const ex=open?"true":"false";
  menuToggle.setAttribute("aria-expanded", ex);
  edgeToggle.setAttribute("aria-expanded", ex);
  edgeToggle.textContent=open?"▶":"◀";
}
menuToggle.addEventListener("click", ()=>setSidebar(!sidebar.classList.contains("open")));
edgeToggle.addEventListener("click", ()=>setSidebar(!sidebar.classList.contains("open")));
setSidebar(false);

/* ====== 手のひら（パン） ====== */
let pan={active:false,sx:0,sy:0,left:0,top:0};
stage.addEventListener("mousedown",(ev)=>{
  if(currentTool!=="hand") return;
  pan={active:true,sx:ev.clientX,sy:ev.clientY,left:stage.scrollLeft,top:stage.scrollTop};
  body.classList.add("hand-dragging");
});
stage.addEventListener("mousemove",(ev)=>{
  if(!pan.active) return;
  stage.scrollLeft=pan.left-(ev.clientX-pan.sx);
  stage.scrollTop =pan.top -(ev.clientY-pan.sy);
});
window.addEventListener("mouseup",()=>{ pan.active=false; body.classList.remove("hand-dragging"); });

stage.addEventListener("touchstart",(ev)=>{
  if(currentTool==="hand" && ev.touches.length===1){
    pan={active:true,sx:ev.touches[0].clientX,sy:ev.touches[0].clientY,left:stage.scrollLeft,top:stage.scrollTop};
    body.classList.add("hand-dragging");
  }
},{passive:true});
stage.addEventListener("touchmove",(ev)=>{
  if(!pan.active || currentTool!=="hand" || ev.touches.length!==1) return;
  const t=ev.touches[0];
  stage.scrollLeft=pan.left-(t.clientX-pan.sx);
  stage.scrollTop =pan.top -(t.clientY-pan.sy);
},{passive:true});
stage.addEventListener("touchend",()=>{ pan.active=false; body.classList.remove("hand-dragging"); });

/* ====== ピンチズーム：手のひらのみ ====== */
let pinch={active:false,dist0:0,zoom0:1};
const dist2=(ts)=>Math.hypot(ts[0].clientX-ts[1].clientX, ts[0].clientY-ts[1].clientY);
stage.addEventListener("touchstart",(ev)=>{
  if(currentTool==="hand" && ev.touches.length===2){
    pinch={active:true,dist0:dist2(ev.touches),zoom0:zoom};
    ev.preventDefault();
  }
},{passive:false});
stage.addEventListener("touchmove",(ev)=>{
  if(!(pinch.active && ev.touches.length===2)) return;
  // ピンチ中は transform だけ → 速い
  const ratio = dist2(ev.touches)/(pinch.dist0||1);
  const z = Math.max(ZMIN, Math.min(ZMAX, +(pinch.zoom0*ratio).toFixed(2)));
  pdfContainer.style.transform = `scale(${z})`;
  pdfContainer.style.transformOrigin = '0 0';
  drawCanvas.style.transform = `scale(${z})`;
  drawCanvas.style.transformOrigin = '0 0';
  ev.preventDefault();
},{passive:false});
stage.addEventListener("touchend", async ()=>{
  if(!pinch.active) return;
  pinch.active=false;
  // transform を戻して本描画を1回だけ
  const m = /scale\(([\d.]+)\)/.exec(pdfContainer.style.transform);
  const z = m ? parseFloat(m[1]) : zoom;
  pdfContainer.style.transform = '';
  drawCanvas.style.transform = '';
  await window.__SET_ZOOM(z);
});

/* ====== スワイプページめくり（PDFのみ / ズーム≈1） ====== */
let swipe={active:false,x0:0,t0:0,dx:0};
const MAX_DRAG=120, DIST_TH=80, VEL_TH=0.6;
stage.addEventListener("touchstart",(ev)=>{
  if(currentTool==="hand" || drawing || zoom>1.05 || !pdfDoc) { swipe.active=false; return; }
  if(ev.touches.length!==1){ swipe.active=false; return; }
  swipe={active:true,x0:ev.touches[0].clientX,t0:performance.now(),dx:0};
  pageLayer.style.transition="none";
},{passive:true});
stage.addEventListener("touchmove",(ev)=>{
  if(!swipe.active) return;
  swipe.dx=ev.touches[0].clientX-swipe.x0;
  pageLayer.style.transform=`translateX(${Math.max(-MAX_DRAG, Math.min(MAX_DRAG, swipe.dx))}px)`;
},{passive:true});
stage.addEventListener("touchend", async ()=>{
  if(!swipe.active) return;
  const dt=Math.max(1, performance.now()-swipe.t0);
  const v=Math.abs(swipe.dx)/dt;
  const goNext=(swipe.dx<0) && (Math.abs(swipe.dx)>DIST_TH || v>VEL_TH);
  const goPrev=(swipe.dx>0) && (Math.abs(swipe.dx)>DIST_TH || v>VEL_TH);
  pageLayer.style.transition="transform .18s ease";
  pageLayer.style.transform="translateX(0)";
  swipe.active=false;
  if (goNext && currentPage<totalPages) await window.__GOTO_PAGE(currentPage+1);
  else if (goPrev && currentPage>1)     await window.__GOTO_PAGE(currentPage-1);
});

/* ====== 状態保存/復元 ====== */
async function persistState(){
  const state={
    page:currentPage, zoom, tool:currentTool, paper:currentPaper,
    strokes:Array.from(strokesByPage.entries()) // [ [page, strokeArray], ... ]
  };
  await saveKV("state", state);
}
async function restoreState(){
  const buf=await loadKV("pdf-bytes");
  const state=await loadKV("state");
  if(state){
    currentPage=state.page||1; zoom=state.zoom||1.0; setTool(state.tool||"pen");
    currentPaper = state.paper || 'pdf';
    strokesByPage.clear();
    if(Array.isArray(state.strokes)){
      for(const [p,arr] of state.strokes){ strokesByPage.set(+p, arr||[]); }
    }
    paperTypeSel.value = currentPaper;
  }
  if(buf){ await openPdfFromBytes(buf); }
  else { await renderPage(currentPage); }
  window.__CURRENT_PAGE = currentPage;
}
restoreState();

/* ====== Firebase 共同編集 ====== */
// 役割バッジ
setRoleBadge(linkMode);

// セッション作成（先生）
btnStart?.addEventListener('click', async () => {
  await initFirebaseIfNeeded();
  const id = Math.random().toString(36).slice(2,8);
  roomId = id;

  const roomDoc = fb.db.collection('rooms').doc(roomId);
  await roomDoc.set({
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: fb.user.uid,
    publicRead: false,
    members: { [fb.user.uid]: { role: 'teacher', joinedAt: Date.now() } },
    pdfUrl: null, page: currentPage, zoom, paper: currentPaper
  }, { merge: true });

  linkMode = 'teacher';
  fb.roomRef   = roomDoc;
  fb.strokesRef= roomDoc.collection('strokes');
  setRoleBadge('teacher');

  copyLinks();
  alert('セッションを作成しました。リンクを配布してください。');
  history.replaceState({}, '', `?room=${roomId}&mode=teacher`);
});

// 共有リンク
function buildUrl(mode){ return `${location.origin}${location.pathname}?room=${roomId}&mode=${mode}`; }
function copy(text){ navigator.clipboard?.writeText(text); }
function copyLinks(){
  if (!roomId) return;
  copy(`先生: ${buildUrl('teacher')}\n編集: ${buildUrl('edit')}\n閲覧: ${buildUrl('view')}`);
}
btnT?.addEventListener('click', ()=> roomId && copy(buildUrl('teacher')));
btnV?.addEventListener('click', ()=> roomId && copy(buildUrl('view')));
btnE?.addEventListener('click', ()=> roomId && copy(buildUrl('edit')));

// 参加（URLにroomがある）
joinRoomIfNeeded();
async function joinRoomIfNeeded(){
  if (!roomId) return;
  await initFirebaseIfNeeded();

  const roomDoc = fb.db.collection('rooms').doc(roomId);
  const snap = await roomDoc.get();
  if (!snap.exists) await roomDoc.set({ createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });

  const role = (linkMode === 'teacher') ? 'teacher' :
               (linkMode === 'edit')    ? 'editor'  :
               (linkMode === 'view')    ? 'viewer'  : 'viewer';

  await roomDoc.set({
    members: { [fb.user.uid]: { role, joinedAt: Date.now() } }
  }, { merge: true });

  fb.roomRef    = roomDoc;
  fb.strokesRef = roomDoc.collection('strokes');
  setRoleBadge(role);

  // ルーム状態を購読
  fb.roomRef.onSnapshot(async s=>{
    const d=s.data()||{};
    if (d.paper && d.paper !== currentPaper){ currentPaper = d.paper; paperTypeSel.value=d.paper; await renderPage(currentPage); }
    if (typeof d.page === 'number' && d.page !== currentPage) { await window.__GOTO_PAGE(d.page, {fromRemote:true}); }
    if (typeof d.zoom === 'number' && Math.abs(d.zoom-zoom)>0.001) { await window.__SET_ZOOM(d.zoom, {fromRemote:true}); }
    if (d.pdfUrl) { ensurePdfLoadedFromUrl(d.pdfUrl); }
  });

  // ストローク購読
  fb.strokesRef.orderBy('createdAt').onSnapshot((qs)=>{
    qs.docChanges().forEach(ch=>{
      if (ch.type !== 'added') return;
      const st = ch.doc.data();
      if (st.uid === fb.user.uid) return;
      if (st.page !== currentPage) return;
      __applyRemoteStroke(st);
    });
  });
}

// リモート適用フック
function __applyRemoteStroke(s){
  getStrokes(currentPage).push({ mode:s.mode, color:s.color, size:s.size, points:s.points });
  redrawStrokes();
}
window.__applyRemoteStroke = __applyRemoteStroke;

// PDF URLからロード（Storage配布）
async function ensurePdfLoadedFromUrl(url){
  if (window.__CURRENT_PDF_URL === url) return;
  window.__CURRENT_PDF_URL = url;
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  await openPdfFromBytes(buf);
}

// PDFをStorageへ（先生/編集のみ）
async function uploadPdfToRoom(file){
  if (!fb.roomRef) return;
  const metaSnap = await fb.roomRef.get();
  const members = (metaSnap.data()?.members)||{};
  const me = members[fb.user.uid];
  const canEdit = me && (me.role === 'teacher' || me.role === 'editor');
  if (!canEdit) return;

  const path = `rooms/${fb.roomRef.id}/source.pdf`;
  const ref  = fb.storage.ref().child(path);
  await ref.put(file);
  const url = await ref.getDownloadURL();
  await fb.roomRef.set({ pdfUrl: url }, { merge:true });
}

// ページ/ズーム/紙面を同期（先生/編集のみ）
async function syncPageZoom(type, value){
  if (!fb.roomRef) return;
  const members = (await fb.roomRef.get()).data()?.members || {};
  const me      = members[fb.user.uid];
  const canEdit = me && (me.role === 'teacher' || me.role === 'editor');
  if (!canEdit) return;
  await fb.roomRef.set({ [type]: value }, { merge: true });
}
paperTypeSel.addEventListener("change", async ()=>{
  if (!fb.roomRef) return;
  await syncPageZoom('paper', paperTypeSel.value);
});

/* ====== 採点（Gemini） ====== */
async function gradeWithGemini({ question, modelAnswer, studentAnswer, maxScore=10, rubric='' }) {
  const prompt = `
あなたは中高生の答案を採点する採点官です。以下の基準で厳密に採点してください。
- 満点: ${maxScore}
- 採点基準: ${rubric || '特になし（正確性・過程・表現で採点）'}
- 出力は必ず JSON だけ:
{"score": 数値, "feedback": "短い講評"}

問題: ${question}
模範解答: ${modelAnswer}
生徒の解答: ${studentAnswer}`.trim();

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }]}] })
    }
  );
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try { return JSON.parse(text); } catch { return { score: null, feedback: "解析に失敗しました。" }; }
}

gradeRunBtn?.addEventListener("click", async () => {
  const question = (qText?.value ?? "").trim();
  const modelAns = (aText?.value ?? "").trim();
  const stuAns   = (sText?.value ?? "").trim();
  const maxScore = Math.max(1, Number(maxScoreInput?.value ?? 10));
  const mode     = (returnModeSel?.value ?? "review"); // 'review' | 'auto'

  if (!question || !modelAns || !stuAns) {
    gradeResultBox.textContent = "問題文・模範解答・生徒の解答（テキスト）を入力してください。";
    return;
  }

  gradeResultBox.textContent = "採点中…";
  try {
    const result = await gradeWithGemini({ question, modelAnswer: modelAns, studentAnswer: stuAns, maxScore });
    const score = result?.score;
    const feedback = result?.feedback ?? "";

    gradeResultBox.innerHTML = `結果: <b>${score}/${maxScore}</b><br>講評: ${feedback}`;

    // Firestore に保存（セッション中のみ）
    try {
      if (fb?.db && roomId) {
        const subRef = fb.db.collection('rooms').doc(roomId).collection('submissions').doc();
        await subRef.set({
          assignId: null,
          page: currentPage,
          question, modelAnswer: modelAns, ocrText: stuAns,
          score, maxScore, feedback,
          mode, status: (mode === 'auto' ? 'returned' : 'graded'),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          gradedAt: firebase.firestore.FieldValue.serverTimestamp(),
          returnedAt: (mode === 'auto') ? firebase.firestore.FieldValue.serverTimestamp() : null,
          by: fb.user?.uid || null
        });
      }
    } catch (e) {
      console.warn("Firestore保存はスキップ（未設定または権限なし）:", e);
    }

  } catch (err) {
    console.error(err);
    gradeResultBox.textContent = "採点に失敗しました。ネットワークとAPIキーを確認してください。";
  }
});