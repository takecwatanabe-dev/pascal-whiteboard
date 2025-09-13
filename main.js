// Pascal Whiteboard (MVP) v0.4.2
// - 手のひらのみピンチズーム可 / ペン時は無効
// - スワイプページめくり強化
// - ハンドル当たり拡大
// - 状態をIndexedDBへ保存・復元（PDF/ページ/ズーム/ツール/手書き）

window.addEventListener("DOMContentLoaded", () => {
  // ==== DOM ====
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

  // ==== pdf.js ====
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  // ==== 状態 ====
  const BASE_SCALE=1.0, STEP=0.1, ZMIN=0.5, ZMAX=3.0;
  let pdfDoc=null, currentPage=1, totalPages=0, zoom=1.0;
  let currentTool="pen";

  // ページごとの手書き（ベクター）
  const strokesByPage = new Map();
  const getStrokes = (p)=> (strokesByPage.get(p) || (strokesByPage.set(p,[]), strokesByPage.get(p)));

  // ==== IndexedDB（簡易） ====
  const DB_NAME="pascal-whiteboard", STORE="state";
  function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open(DB_NAME,1); r.onupgradeneeded=()=>r.result.createObjectStore(STORE); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  async function saveKV(key, value){ const db=await idb(); const tx=db.transaction(STORE,"readwrite"); tx.objectStore(STORE).put(value,key); return new Promise(r=>tx.oncomplete=r); }
  async function loadKV(key){ const db=await idb(); const tx=db.transaction(STORE,"readonly"); const req=tx.objectStore(STORE).get(key); return new Promise(r=>{ req.onsuccess=()=>r(req.result); tx.oncomplete=()=>{}; }); }

  // ==== PDF描画 ====
  async function renderPage(n){
    if(!pdfDoc) return;
    const page=await pdfDoc.getPage(n);
    const viewport=page.getViewport({scale:BASE_SCALE*zoom});

    // PDF
    pdfContainer.innerHTML="";
    const pdfCanvas=document.createElement("canvas");
    pdfCanvas.width=Math.floor(viewport.width);
    pdfCanvas.height=Math.floor(viewport.height);
    pdfCanvas.style.display="block";
    pdfContainer.appendChild(pdfCanvas);
    await page.render({canvasContext:pdfCanvas.getContext("2d"), viewport}).promise;

    // DRAW
    drawCanvas.width=pdfCanvas.width; drawCanvas.height=pdfCanvas.height;
    redrawStrokes();

    pageInfo.textContent=`${n} / ${totalPages}`;
    btnPrev.disabled=(n<=1); btnNext.disabled=(n>=totalPages);
    zoomLabel.textContent=Math.round(zoom*100)+"%";
    btnZoomOut.disabled=(zoom<=ZMIN); btnZoomIn.disabled=(zoom>=ZMAX);

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

  // ==== 入出力 ====
  fileInput.addEventListener("change", async (e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const buf=await file.arrayBuffer();
    await saveKV("pdf-bytes", buf);
    await openPdfFromBytes(buf);
  });

  async function openPdfFromBytes(buf){
    const uint=new Uint8Array(buf);
    pdfDoc=await pdfjsLib.getDocument({data:uint}).promise;
    totalPages=pdfDoc.numPages; if(currentPage>totalPages) currentPage=1;
    await renderPage(currentPage);
  }

  // ==== ページ移動 ====
  btnPrev.addEventListener("click", async ()=>{ if(!pdfDoc||currentPage<=1) return; currentPage--; await renderPage(currentPage); stage.scrollTo({left:0,top:0,behavior:"instant"}); });
  btnNext.addEventListener("click", async ()=>{ if(!pdfDoc||currentPage>=totalPages) return; currentPage++; await renderPage(currentPage); stage.scrollTo({left:0,top:0,behavior:"instant"}); });

  // ==== ズーム ====
  btnZoomOut.addEventListener("click", async ()=>{ if(!pdfDoc) return; zoom=Math.max(ZMIN, +(zoom-STEP).toFixed(2)); await renderPage(currentPage); });
  btnZoomIn .addEventListener("click", async ()=>{ if(!pdfDoc) return; zoom=Math.min(ZMAX, +(zoom+STEP).toFixed(2)); await renderPage(currentPage); });
  zoomReset  .addEventListener("click", async ()=>{ if(!pdfDoc) return; zoom=1.0; await renderPage(currentPage); });

  // ==== ツール ====
  function setTool(t){
    currentTool=t;
    toolPen.classList.toggle("active", t==="pen");
    toolEraser.classList.toggle("active", t==="eraser");
    toolHand.classList.toggle("active", t==="hand");
    body.classList.toggle("hand-mode", t==="hand");
    persistState();
  }
  toolPen.addEventListener("click", ()=>setTool("pen"));
  toolEraser.addEventListener("click", ()=>setTool("eraser"));
  toolHand.addEventListener("click", ()=>setTool("hand"));
  setTool("pen");

  clearBtn.addEventListener("click", ()=>{ strokesByPage.set(currentPage,[]); redrawStrokes(); persistState(); });

  // ==== 手書き ====
  let drawing=false, currentStroke=null;
  const norm=(ev)=>{
    const rect=drawCanvas.getBoundingClientRect();
    const t=ev.touches?.[0];
    const x=(t?t.clientX:ev.clientX)-rect.left, y=(t?t.clientY:ev.clientY)-rect.top;
    return {xN:Math.max(0,Math.min(1,x/drawCanvas.width)), yN:Math.max(0,Math.min(1,y/drawCanvas.height))};
  };

  function startDraw(ev){
    if(!pdfDoc) return;
    if(currentTool==="hand") return;     // 手のひらでは描かない
    drawing=true;
    currentStroke={mode:currentTool, color:colorPicker.value, size:+sizePicker.value, points:[norm(ev)]};
    ev.preventDefault?.();
  }
  function moveDraw(ev){
    if(!drawing||!currentStroke) return;
    currentStroke.points.push(norm(ev));
    // プレビュー（既存＋新規）
    dctx.clearRect(0,0,drawCanvas.width,drawCanvas.height);
    getStrokes(currentPage).forEach(drawStroke);
    drawStroke(currentStroke);
    ev.preventDefault?.();
  }
  function endDraw(){
    if(!drawing||!currentStroke){ drawing=false; return; }
    getStrokes(currentPage).push(currentStroke);
    drawing=false; currentStroke=null;
    redrawStrokes(); persistState();
  }

  drawCanvas.addEventListener("mousedown", startDraw);
  drawCanvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", endDraw);
  drawCanvas.addEventListener("touchstart", startDraw, {passive:false});
  drawCanvas.addEventListener("touchmove",  moveDraw,   {passive:false});
  drawCanvas.addEventListener("touchend",   endDraw);

  // ==== PNG出力 ====
  exportBtn.addEventListener("click", ()=>{
    if(!pdfDoc) { alert("先にPDFを表示してください。"); return; }
    const pdfCanvas=pdfContainer.querySelector("canvas"); if(!pdfCanvas) return;
    const out=document.createElement("canvas");
    out.width=pdfCanvas.width; out.height=pdfCanvas.height;
    const octx=out.getContext("2d");
    octx.drawImage(pdfCanvas,0,0); octx.drawImage(drawCanvas,0,0);
    const a=document.createElement("a");
    a.download=`pascal-page${currentPage}.png`;
    a.href=out.toDataURL("image/png"); a.click();
  });

  // ==== ツールバー開閉 ====
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

  // ==== 手のひら（パン）& ピンチズーム（手のひら限定） ====
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

  // 手のひら時のみピンチ
  let pinch={active:false,dist0:0,zoom0:1};
  const dist2=(ts)=>Math.hypot(ts[0].clientX-ts[1].clientX, ts[0].clientY-ts[1].clientY);

  stage.addEventListener("touchstart",(ev)=>{
    if(currentTool==="hand" && ev.touches.length===1){
      // 1本指はパン
      pan={active:true,sx:ev.touches[0].clientX,sy:ev.touches[0].clientY,left:stage.scrollLeft,top:stage.scrollTop};
      body.classList.add("hand-dragging");
    }
    if(currentTool==="hand" && ev.touches.length===2){
      pinch={active:true,dist0:dist2(ev.touches),zoom0:zoom};
      ev.preventDefault();
    }
  },{passive:false});

  stage.addEventListener("touchmove",(ev)=>{
    if(currentTool==="hand" && pinch.active && ev.touches.length===2){
      const ratio=dist2(ev.touches)/(pinch.dist0||1);
      const z=Math.max(ZMIN, Math.min(ZMAX, +(pinch.zoom0*ratio).toFixed(2)));
      if(z!==zoom){ zoom=z; renderPage(currentPage); }
      ev.preventDefault();
      return;
    }
    if(pan.active && currentTool==="hand" && ev.touches.length===1){
      const t=ev.touches[0];
      stage.scrollLeft=pan.left-(t.clientX-pan.sx);
      stage.scrollTop =pan.top -(t.clientY-pan.sy);
    }
  },{passive:true});

  stage.addEventListener("touchend",()=>{
    pinch.active=false; pan.active=false; body.classList.remove("hand-dragging");
  });

  // ==== スワイプページめくり（強化） ====
  let swipe={active:false,x0:0,t0:0,dx:0};
  const MAX_DRAG=120, DIST_TH=80, VEL_TH=0.6;

  stage.addEventListener("touchstart",(ev)=>{
    // ズーム中/手のひら/描画中は無効
    if(zoom>1.05 || currentTool==="hand" || drawing){ swipe.active=false; return; }
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

    if(goNext && currentPage<totalPages){ currentPage++; await renderPage(currentPage); }
    else if(goPrev && currentPage>1){ currentPage--; await renderPage(currentPage); }
  },{passive:true});

  // ==== 状態保存/復元 ====
  async function persistState(){
    const state={
      page:currentPage, zoom, tool:currentTool,
      strokes:Array.from(strokesByPage.entries()) // [ [page, strokeArray], ... ]
    };
    await saveKV("state", state);
  }
  async function restoreState(){
    const buf=await loadKV("pdf-bytes");
    const state=await loadKV("state");
    if(buf){
      await openPdfFromBytes(buf);
    }
    if(state){
      currentPage=state.page||1; zoom=state.zoom||1.0; setTool(state.tool||"pen");
      strokesByPage.clear();
      if(Array.isArray(state.strokes)){
        for(const [p,arr] of state.strokes){ strokesByPage.set(+p, arr||[]); }
      }
      if(pdfDoc) await renderPage(currentPage);
    }
  }

  // 起動時に復元
  restoreState();
});