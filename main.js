// main.js  — Pascal Whiteboard (MVP) PDF表示 + 手書き描画
// 必要: index.html に pdf.min.js と pdf.worker.min.js を読み込み済み

window.addEventListener("DOMContentLoaded", () => {
  // ====== 要素参照 ======
  const fileInput = document.getElementById("file-input");
  const pdfContainer = document.getElementById("pdf-container");
  const drawCanvas = document.getElementById("draw-layer");
  const ctx = drawCanvas.getContext("2d");

  const penBtn = document.getElementById("pen");
  const eraserBtn = document.getElementById("eraser");
  const clearBtn = document.getElementById("clear");
  const colorPicker = document.getElementById("color-picker");
  const sizePicker = document.getElementById("size-picker");
  const exportBtn = document.getElementById("export");

  // ====== 描画状態 ======
  let drawing = false;
  let mode = "pen"; // "pen" or "eraser"
  let pdfCanvas = null; // pdf.js が描画するキャンバス
  let scale = 1.2; // PDFの表示倍率（必要に応じて変えてOK）

  // ====== pdf.js 設定（CDNを使う場合はworkerSrcの指定は不要だが、明示してもOK） ======
  if (window["pdfjsLib"]) {
    // 参考: pdfjsLib.GlobalWorkerOptions.workerSrc = '.../pdf.worker.min.js';
  } else {
    console.warn("pdf.js が読み込まれていません。index.htmlの <script> を確認してください。");
  }

  // ====== PDF読み込み → 1ページ目を描画 ======
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    try {
      const pdf = await pdfjsLib.getDocument(url).promise;
      const page = await pdf.getPage(1);

      const viewport = page.getViewport({ scale });

      // 既存のPDFキャンバスを消して作り直し
      pdfContainer.innerHTML = "";
      pdfCanvas = document.createElement("canvas");
      const pdfCtx = pdfCanvas.getContext("2d");
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;
      pdfCanvas.style.display = "block";
      pdfContainer.appendChild(pdfCanvas);

      // レンダリング
      await page.render({ canvasContext: pdfCtx, viewport }).promise;

      // 手書きキャンバスをPDFにぴったり重ねる
      fitDrawCanvasToPdf();

    } catch (err) {
      console.error(err);
      alert("PDFの読み込みに失敗しました。別のファイルでお試しください。");
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // ====== 手書きキャンバスのサイズ調整 ======
  function fitDrawCanvasToPdf() {
    if (!pdfCanvas) return;
    drawCanvas.width = pdfCanvas.width;
    drawCanvas.height = pdfCanvas.height;

    // PDFキャンバスの上に重ねる（index.cssで position:absolute 指定済み）
    const pdfRect = pdfCanvas.getBoundingClientRect();
    const containerRect = pdfContainer.getBoundingClientRect();
    drawCanvas.style.left = (pdfCanvas.offsetLeft || 0) + "px";
    drawCanvas.style.top = (pdfCanvas.offsetTop || 0) + "px";

    // 描画スタイル初期化
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = Number(sizePicker.value);
    ctx.globalCompositeOperation = "source-over";
  }

  // 画面サイズが変わってもPDFキャンバスのCSS位置は変わり得るので追従
  window.addEventListener("resize", () => {
    // PDF自体のピクセルサイズは固定。位置合わせのみ再計算。
    fitDrawCanvasToPdf();
  });

  // ====== ツール ======
  penBtn.addEventListener("click", () => {
    mode = "pen";
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = Number(sizePicker.value);
  });

  eraserBtn.addEventListener("click", () => {
    mode = "eraser";
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = Number(sizePicker.value) * 2;
  });

  clearBtn.addEventListener("click", () => {
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  });

  colorPicker.addEventListener("change", () => {
    if (mode === "pen") ctx.strokeStyle = colorPicker.value;
  });

  sizePicker.addEventListener("input", () => {
    const w = Number(sizePicker.value);
    ctx.lineWidth = mode === "eraser" ? w * 2 : w;
  });

  // ====== 手書きイベント（マウス/タッチ/ペン） ======
  function pointFromEvent(ev) {
    const rect = drawCanvas.getBoundingClientRect();
    let clientX, clientY;
    if (ev.touches && ev.touches[0]) {
      clientX = ev.touches[0].clientX;
      clientY = ev.touches[0].clientY;
    } else {
      clientX = ev.clientX;
      clientY = ev.clientY;
    }
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDraw(ev) {
    if (!pdfCanvas) return; // PDF未表示のときは無視
    drawing = true;
    const p = pointFromEvent(ev);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ev.preventDefault();
  }

  function moveDraw(ev) {
    if (!drawing) return;
    const p = pointFromEvent(ev);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ev.preventDefault();
  }

  function endDraw() {
    drawing = false;
  }

  // マウス
  drawCanvas.addEventListener("mousedown", startDraw);
  drawCanvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", endDraw);
  // タッチ
  drawCanvas.addEventListener("touchstart", startDraw, { passive: false });
  drawCanvas.addEventListener("touchmove", moveDraw, { passive: false });
  drawCanvas.addEventListener("touchend", endDraw);

  // ====== PNG書き出し（PDF+手書きの合成画像） ======
  exportBtn.addEventListener("click", () => {
    if (!pdfCanvas) {
      alert("先にPDFを表示してください。");
      return;
    }
    const out = document.createElement("canvas");
    out.width = pdfCanvas.width;
    out.height = pdfCanvas.height;
    const octx = out.getContext("2d");
    // PDF → 手書き の順で合成
    octx.drawImage(pdfCanvas, 0, 0);
    octx.drawImage(drawCanvas, 0, 0);

    const a = document.createElement("a");
    a.href = out.toDataURL("image/png");
    a.download = "pascal-whiteboard.png";
    a.click();
  });

  // 初期ツールはペン
  penBtn.click();
});
