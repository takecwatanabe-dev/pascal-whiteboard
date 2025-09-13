// Pascal Whiteboard (MVP) v0.4.1
// ・手のひらをツール側に移動（選択が優先）
// ・手書きをベクター保存→再描画（ズームで薄くならない / ページごと保持）
// ・スワイプ改良：ドラッグで横ズレ表示 + フリックでページ送り

window.addEventListener("DOMContentLoaded", () => {
  // DOM
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

  const menuToggle= document.getElementById("menu-toggle");
  const edgeToggle= document.getElementById("edge-toggle");
  const sidebar   = document.getElementById("sidebar");

  const toolPen    = document.getElementById("tool-pen");
  const toolEraser = document.getElementById("tool-eraser");
  const toolHand   = document.getElementById("tool-hand");
  const clearBtn   = document.getElementById("clear");
  const colorPicker= document.getElementById("color-picker");
  const sizePicker = document.getElementById("size-picker");
  const exportBtn  = document.getElementById("export");
  const body       = document.body;

  // pdf.js worker
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

  // ==== 状態 ====
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;

  const BASE_SCALE = 1.0;
  let zoom = 1.0;
  const ZOOM_STEP = 0.1, ZOOM_MIN = 0.5, ZOOM_MAX = 3.0;

  // ツール
  let currentTool = "pen"; // 'pen' | 'eraser' | 'hand'

  // ベクター軌跡: ページごとに配列
  // path = { mode:'pen'|'eraser', color:'#rrggbb', size:number, points:[{xN,yN}] }
  const strokesByPage = new Map();

  function getPageStrokes(page){
    if (!strokesByPage.has(page)) strokesByPage.set(page, []);
    return strokesByPage.get(page);
  }

  // ==== PDF レンダリング ====
  async function renderPage(pageNum){
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: BASE_SCALE * zoom });

    // PDFキャンバス
    pdfContainer.innerHTML = "";
    const pdfCanvas = document.createElement("canvas");
    const pctx = pdfCanvas.getContext("2d");
    pdfCanvas.width = Math.floor(viewport.width);
    pdfCanvas.height = Math.floor(viewport.height);
    pdfCanvas.style.display = "block";
    pdfContainer.appendChild(pdfCanvas);

    // 手書きキャンバスもリサイズ
    drawCanvas.width = pdfCanvas.width;
    drawCanvas.height = pdfCanvas.height;

    await page.render({ canvasContext: pctx, viewport }).promise;

    // ベクターストロークを再描画
    redrawStrokes();

    // UI
    pageInfo.textContent = `${pageNum} / ${totalPages}`;
    btnPrev.disabled = (pageNum <= 1);
    btnNext.disabled = (pageNum >= totalPages);
    zoomLabel.textContent = Math.round(zoom*100) + "%";
    btnZoomOut.disabled = (zoom <= ZOOM_MIN);
    btnZoomIn.disabled  = (zoom >= ZOOM_MAX);
  }

  function redrawStrokes(){
    dctx.clearRect(0,0,drawCanvas.width, drawCanvas.height);
    const strokes = getPageStrokes(currentPage);
    for (const s of strokes){
      dctx.save();
      dctx.lineCap = "round";
      dctx.lineJoin = "round";
      dctx.globalCompositeOperation = (s.mode === "eraser") ? "destination-out" : "source-over";
      dctx.strokeStyle = (s.mode === "eraser") ? "#000" : s.color;
      // 見た目の太さをズームに合わせて自然に：size は基準 1.0 として zoom を掛ける
      dctx.lineWidth = s.size * zoom;

      dctx.beginPath();
      for (let i=0;i<s.points.length;i++){
        const px = s.points[i].xN * drawCanvas.width;
        const py = s.points[i].yN * drawCanvas.height;
        if (i===0) dctx.moveTo(px,py); else dctx.lineTo(px,py);
      }
      dctx.stroke();
      dctx.restore();
    }
  }

  // ==== ファイル選択 ====
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try{
      pdfDoc = await pdfjsLib.getDocument(url).promise;
      totalPages = pdfDoc.numPages;
      currentPage = 1; zoom = 1.0;
      await renderPage(currentPage);
      stage.scrollTo({left:0, top:0, behavior:"instant"});
    } catch(err){
      console.error(err);
      alert("PDFの読み込みに失敗しました。別のPDFをお試しください。");
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // ==== ページ送り ====
  btnPrev.addEventListener("click", async () => {
    if (!pdfDoc || currentPage<=1) return;
    currentPage--; await renderPage(currentPage);
    stage.scrollTo({left:0, top:0, behavior:"instant"});
  });
  btnNext.addEventListener("click", async () => {
    if (!pdfDoc || currentPage>=totalPages) return;
    currentPage++; await renderPage(currentPage);
    stage.scrollTo({left:0, top:0, behavior:"instant"});
  });

  // ==== ズーム ====
  btnZoomOut.addEventListener("click", async () => {
    if (!pdfDoc) return;
    zoom = Math.max(ZOOM_MIN, Math.round((zoom - ZOOM_STEP)*10)/10);
    await renderPage(currentPage);
  });
  btnZoomIn.addEventListener("click", async () => {
    if (!pdfDoc) return;
    zoom = Math.min(ZOOM_MAX, Math.round((zoom + ZOOM_STEP)*10)/10);
    await renderPage(currentPage);
  });

  // ==== ツール選択（優先） ====
  function setTool(tool){
    currentTool = tool;
    toolPen.classList.toggle("active", tool==="pen");
    toolEraser.classList.toggle("active", tool==="eraser");
    toolHand.classList.toggle("active", tool==="hand");
    body.classList.toggle("hand-mode", tool==="hand");
  }
  toolPen   .addEventListener("click", () => setTool("pen"));
  toolEraser.addEventListener("click", () => setTool("eraser"));
  toolHand  .addEventListener("click", () => setTool("hand"));
  setTool("pen");

  clearBtn.addEventListener("click", () => {
    strokesByPage.set(currentPage, []);
    redrawStrokes();
  });

  // ==== 手書き（ベクター記録） ====
  let drawing = false;
  let currentStroke = null;

  function normPoint(ev){
    const rect = drawCanvas.getBoundingClientRect();
    const t = ev.touches?.[0];
    const x = (t ? t.clientX : ev.clientX) - rect.left;
    const y = (t ? t.clientY : ev.clientY) - rect.top;
    return { xN: Math.max(0,Math.min(1, x / drawCanvas.width)),
             yN: Math.max(0,Math.min(1, y / drawCanvas.height)) };
  }

  function startDraw(ev){
    if (!pdfDoc) return;
    if (currentTool==="hand") return;      // 手のひら中は描かない
    drawing = true;
    currentStroke = {
      mode: currentTool, // 'pen' or 'eraser'
      color: colorPicker.value,
      size: Number(sizePicker.value),
      points: []
    };
    currentStroke.points.push(normPoint(ev));
    ev.preventDefault?.();
  }
  function moveDraw(ev){
    if (!drawing || !currentStroke) return;
    currentStroke.points.push(normPoint(ev));
    redrawStrokesWithPreview(currentStroke); // プレビュー高速化
    ev.preventDefault?.();
  }
  function endDraw(){
    if (!drawing || !currentStroke) { drawing=false; return; }
    const strokes = getPageStrokes(currentPage);
    strokes.push(currentStroke);
    currentStroke = null;
    drawing = false;
    redrawStrokes();
  }

  function redrawStrokesWithPreview(previewStroke){
    dctx.clearRect(0,0,drawCanvas.width, drawCanvas.height);
    const strokes = getPageStrokes(currentPage);
    // 既存
    for (const s of strokes){ drawOneStroke(s); }
    // プレビュー
    if (previewStroke) drawOneStroke(previewStroke);
  }
  function drawOneStroke(s){
    dctx.save();
    dctx.lineCap = "round"; dctx.lineJoin = "round";
    dctx.globalCompositeOperation = (s.mode === "eraser") ? "destination-out" : "source-over";
    dctx.strokeStyle = (s.mode === "eraser") ? "#000" : s.color;
    dctx.lineWidth = s.size * zoom;
    dctx.beginPath();
    for (let i=0;i<s.points.length;i++){
      const px = s.points[i].xN * drawCanvas.width;
      const py = s.points[i].yN * drawCanvas.height;
      if (i===0) dctx.moveTo(px,py); else dctx.lineTo(px,py);
    }
    dctx.stroke();
    dctx.restore();
  }

  drawCanvas.addEventListener("mousedown", startDraw);
  drawCanvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", endDraw);
  drawCanvas.addEventListener("touchstart", startDraw, {passive:false});
  drawCanvas.addEventListener("touchmove",  moveDraw,   {passive:false});
  drawCanvas.addEventListener("touchend",   endDraw);

  // 色/太さ変更 → 以後の線に反映
  colorPicker.addEventListener("change", ()=>{ /* no-op: 次のstrokeから適用 */ });
  sizePicker .addEventListener("input",  ()=>{ /* no-op */ });

  // ==== PNG書き出し ====
  exportBtn.addEventListener("click", () => {
    if (!pdfDoc) { alert("先にPDFを表示してください。"); return; }
    const pdfCanvas = pdfContainer.querySelector("canvas");
    if (!pdfCanvas) return;
    const out = document.createElement("canvas");
    out.width = pdfCanvas.width; out.height = pdfCanvas.height;
    const octx = out.getContext("2d");
    octx.drawImage(pdfCanvas,0,0);
    octx.drawImage(drawCanvas,0,0);
    const a = document.createElement("a");
    a.download = `pascal-whiteboard-page${currentPage}.png`;
    a.href = out.toDataURL("image/png");
    a.click();
  });

  // ==== サイドバー ====
  function setSidebar(open){
    sidebar.classList.toggle("open", open);
    edgeToggle.textContent = open ? "▶" : "◀";
  }
  menuToggle.addEventListener("click", () => setSidebar(!sidebar.classList.contains("open")));
  edgeToggle.addEventListener("click", () => setSidebar(!sidebar.classList.contains("open")));
  setSidebar(false);

  // ==== 手のひら（パン）: stage をドラッグでスクロール ====
  let pan = { active:false, startX:0, startY:0, left:0, top:0 };
  stage.addEventListener("mousedown", (ev)=>{
    if (currentTool!=="hand") return;
    pan.active = true; body.classList.add("hand-dragging");
    pan.startX = ev.clientX; pan.startY = ev.clientY;
    pan.left = stage.scrollLeft; pan.top = stage.scrollTop;
  });
  stage.addEventListener("mousemove", (ev)=>{
    if (!pan.active) return;
    stage.scrollLeft = pan.left - (ev.clientX - pan.startX);
    stage.scrollTop  = pan.top  - (ev.clientY - pan.startY);
  });
  window.addEventListener("mouseup", ()=>{ pan.active=false; body.classList.remove("hand-dragging"); });

  stage.addEventListener("touchstart",(ev)=>{
    if (currentTool!=="hand") return;
    pan.active = true; body.classList.add("hand-dragging");
    const t=ev.touches[0]; pan.startX=t.clientX; pan.startY=t.clientY;
    pan.left=stage.scrollLeft; pan.top=stage.scrollTop;
  },{passive:true});
  stage.addEventListener("touchmove",(ev)=>{
    if (!pan.active) return;
    const t=ev.touches[0];
    stage.scrollLeft = pan.left - (t.clientX - pan.startX);
    stage.scrollTop  = pan.top  - (t.clientY - pan.startY);
  },{passive:true});
  stage.addEventListener("touchend", ()=>{ pan.active=false; body.classList.remove("hand-dragging"); });

  // ==== ピンチズーム（手のひら以外でも有効） ====
  let pinch = { active:false, startDist:0, startZoom:1 };
  function dist2(ts){ const [a,b]=ts; return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY); }
  stage.addEventListener("touchstart", async (ev)=>{
    if (ev.touches.length===2){
      pinch.active=true; pinch.startDist=dist2(ev.touches); pinch.startZoom=zoom;
      ev.preventDefault();
    }
  },{passive:false});
  stage.addEventListener("touchmove", async (ev)=>{
    if (pinch.active && ev.touches.length===2){
      const ratio = dist2(ev.touches)/(pinch.startDist||1);
      zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(pinch.startZoom*ratio).toFixed(2)));
      await renderPage(currentPage);
      ev.preventDefault();
    }
  },{passive:false});
  stage.addEventListener("touchend", ()=>{ pinch.active=false; });

  // ==== スワイプページ送り（ドラッグ可視 + フリック判定） ====
  let swipe = { tracking:false, x0:0, t0:0, dx:0 };
  const MAX_DRAG = 120;      // プレビューの最大ずらし
  const DIST_TH  = 80;       // 距離しきい値
  const VEL_TH   = 0.6;      // 速度(px/ms)しきい値（瞬間的なフリック）

  stage.addEventListener("touchstart", (ev)=>{
    // 手のひらやズーム中は無効。ペンでの誤作動を防ぐため手書き中も無効。
    if (currentTool==="hand" || zoom>1.05 || drawing) { swipe.tracking=false; return; }
    if (ev.touches.length!==1){ swipe.tracking=false; return; }
    swipe.tracking=true;
    swipe.x0=ev.touches[0].clientX; swipe.t0=performance.now(); swipe.dx=0;
    pageLayer.style.transition="none";
  },{passive:true});

  stage.addEventListener("touchmove", (ev)=>{
    if (!swipe.tracking) return;
    const dx = ev.touches[0].clientX - swipe.x0;
    swipe.dx = dx;
    // 横にずらしてプレビュー（PDFと手書きを一緒に）
    pageLayer.style.transform = `translateX(${Math.max(-MAX_DRAG, Math.min(MAX_DRAG, dx))}px)`;
  },{passive:true});

  stage.addEventListener("touchend", async (ev)=>{
    if (!swipe.tracking) return;
    swipe.tracking=false;
    const dt = Math.max(1, performance.now()-swipe.t0);
    const v = Math.abs(swipe.dx)/dt; // px/ms
    const goNext = (swipe.dx < 0) && ((Math.abs(swipe.dx) > DIST_TH) || v > VEL_TH);
    const goPrev = (swipe.dx > 0) && ((Math.abs(swipe.dx) > DIST_TH) || v > VEL_TH);

    pageLayer.style.transition="transform .18s ease";
    pageLayer.style.transform="translateX(0)";

    if (goNext && currentPage<totalPages){ currentPage++; await renderPage(currentPage); }
    else if (goPrev && currentPage>1){ currentPage--; await renderPage(currentPage); }
  },{passive:true});

});