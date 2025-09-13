// main.js - Pascal Whiteboard (MVP) PDF表示＋手書き描画

window.addEventListener("DOMContentLoaded", () => {
  // ===== 要素取得 =====
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

  // ===== 描画設定 =====
  let drawing = false;
  let mode = "pen"; // "pen" or "eraser"
  let pdfCanvas = null; // PDF が描画されるキャンバス

  // ===== pdf.js 設定 =====
  if (window["pdfjsLib"]) {
    // ここを CDN のフルURLに修正
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  } else {
    console.warn("pdf.js が読み込まれていません。index.html の <script> を確認してください。");
  }

  // ===== PDF読み込み＋描画 =====
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    try {
      const pdf = await pdfjsLib.getDocument(url).promise;
      const page = await pdf.getPage(1);

      const scale = 1.5;
      const viewport = page.getViewport({ scale });

      // PDF用キャンバスを生成
      pdfContainer.innerHTML = "";
      pdfCanvas = document.createElement("canvas");
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;
      pdfContainer.appendChild(pdfCanvas);

      // 手書きレイヤーの大きさを合わせる
      drawCanvas.width = viewport.width;
      drawCanvas.height = viewport.height;

      const pdfCtx = pdfCanvas.getContext("2d");
      const renderContext = {
        canvasContext: pdfCtx,
        viewport: viewport,
      };
      await page.render(renderContext).promise;
    } catch (err) {
      console.error("PDFの読み込みエラー:", err);
    }
  });

  // ===== 描画処理 =====
  drawCanvas.addEventListener("mousedown", (e) => {
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(e.offsetX, e.offsetY);
  });

  drawCanvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    ctx.strokeStyle = mode === "pen" ? colorPicker.value : "#FFFFFF";
    ctx.lineWidth = sizePicker.value;
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
  });

  drawCanvas.addEventListener("mouseup", () => {
    drawing = false;
    ctx.closePath();
  });

  drawCanvas.addEventListener("mouseleave", () => {
    drawing = false;
    ctx.closePath();
  });

  // ===== ボタン動作 =====
  penBtn.addEventListener("click", () => (mode = "pen"));
  eraserBtn.addEventListener("click", () => (mode = "eraser"));
  clearBtn.addEventListener("click", () => {
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  });

  // PNG書き出し
  exportBtn.addEventListener("click", () => {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = drawCanvas.width;
    exportCanvas.height = drawCanvas.height;
    const exportCtx = exportCanvas.getContext("2d");

    // PDF + 手書きの合成
    if (pdfCanvas) {
      exportCtx.drawImage(pdfCanvas, 0, 0);
    }
    exportCtx.drawImage(drawCanvas, 0, 0);

    const link = document.createElement("a");
    link.download = "export.png";
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  });
});
