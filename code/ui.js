// ---------- ui.js（妡） ----------
import {
  generateShares,
  reconstructPixel,
  RECONSTRUCT_METHODS,
  DEFAULT_RECONSTRUCT_METHOD,
  isReconstructMethod
} from './shamir.js';

/**
 * =========================================================================
 * 1. GF(2^8) 有限體運算與 Shamir 機密分享的內建 Fallback / Mock
 *    依作業規格：「在 shamir.js 還沒完全寫好前，你可以先寫一個假的 generateShares /
 *    reconstructPixel 先把流程跑通。」
 *    此處實現了標準 GF(2^8) 數學運算（不可約多項式 x^8 + x^4 + x^3 + x + 1，即 0x11b），
 *    當隊友蕭的 shamir.js 尚未完成（回傳 undefined）或拋錯時無縫接管，保證
 *    圖片拆分與還原能 100% 真正運作；一旦隊友實作好 shamir.js，將自動優先使用隊友模組。
 * =========================================================================
 */
const GF28_EXP = new Uint8Array(512);
const GF28_LOG = new Uint8Array(256);

(function initGF28() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF28_EXP[i] = x;
    GF28_EXP[i + 255] = x;
    GF28_LOG[x] = i;
    let x2 = (x << 1);
    if (x & 0x80) x2 ^= 0x11b;
    x = x2 ^ x; // generator = 3 (0x03)
  }
  GF28_LOG[0] = 0;
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF28_EXP[GF28_LOG[a] + GF28_LOG[b]];
}

function gfDiv(a, b) {
  if (b === 0) throw new RangeError('GF(2^8) 除以零錯誤');
  if (a === 0) return 0;
  return GF28_EXP[(GF28_LOG[a] - GF28_LOG[b] + 255) % 255];
}

function gfInv(a) {
  if (a === 0) throw new RangeError('GF(2^8) 中 0 沒有乘法反元素');
  return GF28_EXP[255 - GF28_LOG[a]];
}

/** 內建 Mock/Fallback: 拆分單一像素通道值 (0~255) */
function mockGenerateShares(value, k, n) {
  const coeffs = new Uint8Array(k);
  coeffs[0] = value & 0xff; // 常數項 a0 為機密本身
  for (let c = 1; c < k; c++) {
    coeffs[c] = Math.floor(Math.random() * 256);
  }
  const shares = new Array(n);
  for (let x = 1; x <= n; x++) {
    let y = 0;
    // Horner's method 計算 f(x)
    for (let c = k - 1; c >= 0; c--) {
      y = gfMul(y, x) ^ coeffs[c];
    }
    shares[x - 1] = y;
  }
  return shares;
}

/** 內建 Mock/Fallback: 從 k 個點還原像素常數項 a0 */
function mockReconstructPixel(points, k) {
  if (!points || points.length < k) {
    throw new Error(`還原點數不足：需要至少 ${k} 個點，目前僅有 ${points ? points.length : 0} 個`);
  }
  let secret = 0;
  for (let i = 0; i < k; i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    let li = 1;
    for (let j = 0; j < k; j++) {
      if (i === j) continue;
      const xj = points[j].x;
      const num = xj;
      const den = xi ^ xj; // 特徵為 2，減法即為 XOR
      if (den === 0) {
        throw new Error(`還原錯誤：出現重複的 x 座標 (${xi})`);
      }
      li = gfMul(li, gfDiv(num, den));
    }
    secret ^= gfMul(yi, li);
  }
  return secret;
}

/**
 * 內建 Mock/Fallback: 高斯消去法（只在 shamir.js 拋錯時兜底用）。
 * 前向消去 + 回代，最後取常數項 a[0] 當秘密。
 */
function mockGaussianPixel(points, k) {
  if (!points || points.length < k) {
    throw new Error(`還原點數不足：需要至少 ${k} 個點，目前僅有 ${points ? points.length : 0} 個`);
  }
  const m = [];
  for (let i = 0; i < k; i++) {
    const row = new Array(k + 1);
    let p = 1;
    for (let j = 0; j < k; j++) {
      row[j] = p;
      p = gfMul(p, points[i].x);
    }
    row[k] = points[i].y;
    m.push(row);
  }
  for (let col = 0; col < k; col++) {
    let pivot = col;
    while (pivot < k && m[pivot][col] === 0) pivot++;
    if (pivot === k) throw new Error('矩陣奇異，請檢查是否有重複的 x 座標');
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const invPivot = gfInv(m[col][col]);
    for (let r = col + 1; r < k; r++) {
      if (m[r][col] === 0) continue;
      const scale = gfMul(m[r][col], invPivot);
      for (let c = col; c <= k; c++) m[r][c] ^= gfMul(scale, m[col][c]);
    }
  }
  // 回代（GF 裡減法 = XOR）
  const a = new Array(k);
  for (let row = k - 1; row >= 0; row--) {
    let sum = m[row][k];
    for (let c = row + 1; c < k; c++) sum ^= gfMul(m[row][c], a[c]);
    a[row] = gfDiv(sum, m[row][row]);
  }
  return a[0];
}

/** 內建 Mock/Fallback: 行列式 + 克拉瑪公式（只在 shamir.js 拋錯時兜底用） */
function mockDeterminantPixel(points, k) {
  if (!points || points.length < k) {
    throw new Error(`還原點數不足：需要至少 ${k} 個點，目前僅有 ${points ? points.length : 0} 個`);
  }
  const buildV = () => {
    const v = [];
    for (let i = 0; i < k; i++) {
      const row = new Array(k);
      let p = 1;
      for (let j = 0; j < k; j++) {
        row[j] = p;
        p = gfMul(p, points[i].x);
      }
      v.push(row);
    }
    return v;
  };
  const det = (matrix) => {
    const n = matrix.length;
    const a = matrix.map((row) => row.slice());
    let d = 1;
    for (let col = 0; col < n; col++) {
      let pivot = col;
      while (pivot < n && a[pivot][col] === 0) pivot++;
      if (pivot === n) return 0;
      if (pivot !== col) {
        const tmp = a[col];
        a[col] = a[pivot];
        a[pivot] = tmp;
      }
      d = gfMul(d, a[col][col]);
      const invPivot = gfInv(a[col][col]);
      for (let r = col + 1; r < n; r++) {
        if (a[r][col] === 0) continue;
        const scale = gfMul(a[r][col], invPivot);
        for (let c = col; c < n; c++) a[r][c] ^= gfMul(scale, a[col][c]);
      }
    }
    return d;
  };
  const v = buildV();
  const v0 = buildV();
  for (let i = 0; i < k; i++) v0[i][0] = points[i].y;
  const delta = det(v);
  if (delta === 0) throw new Error('det(V) = 0，矩陣奇異，請檢查是否有重複的 x 座標');
  return gfDiv(det(v0), delta);
}

/** 統一調用隊友函式，若未實作則優雅降級至 Mock */
let hasLoggedShamirMode = false;
function callGenerateShares(val, k, n) {
  if (typeof generateShares === 'function') {
    try {
      const res = generateShares(val, k, n);
      if (Array.isArray(res) && res.length === n && typeof res[0] === 'number') {
        if (!hasLoggedShamirMode) {
          console.info('[ui.js] 偵測到隊友 shamir.js 已實作，優先使用隊友的 generateShares！');
          hasLoggedShamirMode = true;
        }
        return res;
      }
    } catch (err) {
      console.warn('[ui.js] 隊友 generateShares 執行拋出異常，切換至內建演算法:', err);
    }
  }
  return mockGenerateShares(val, k, n);
}

function callReconstructPixel(points, k, method = DEFAULT_RECONSTRUCT_METHOD) {
  // 用哪種解法就逃到哪個 mock，避免隊友模組壞掉時整個流程掛掉
  const mockByMethod = method === RECONSTRUCT_METHODS.GAUSSIAN
    ? mockGaussianPixel
    : method === RECONSTRUCT_METHODS.DETERMINANT
      ? mockDeterminantPixel
      : mockReconstructPixel;

  if (typeof reconstructPixel === 'function') {
    try {
      const res = reconstructPixel(points, k, method);
      if (typeof res === 'number' && !isNaN(res)) {
        return Math.max(0, Math.min(255, Math.round(res)));
      }
    } catch (err) {
      console.warn(`[ui.js] 隊友 reconstructPixel（${method}）執行拋出異常，切換至內建演算法:`, err);
    }
  }
  return mockByMethod(points, k);
}

function createImageDataSafe(width, height) {
  if (typeof ImageData !== 'undefined') {
    try {
      return new ImageData(width, height);
    } catch (_) {}
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx && ctx.createImageData) {
      return ctx.createImageData(width, height);
    }
  }
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4)
  };
}


/**
 * =========================================================================
 * 2. 核心規格函式：generateSharesAll & reconstructAll
 * =========================================================================
 */

/**
 * 拆分整張影像為 n 張分享圖
 * @param {ImageData} imageData 原始圖片的 ImageData 物件（不可修改原圖）
 * @param {number} k 門檻值（1 ≤ k ≤ n ≤ 255）
 * @param {number} n 分享圖總張數（k ≤ n ≤ 255）
 * @returns {ImageData[]} 長度為 n 的新 ImageData 陣列，不更動原圖
 */
export function generateSharesAll(imageData, k, n) {
  // 1. 防呆檢查
  if (!imageData || typeof imageData !== 'object' || !imageData.data || typeof imageData.width !== 'number' || typeof imageData.height !== 'number') {
    throw new TypeError('generateSharesAll 錯誤：第一個參數必須為合法的 ImageData 物件');
  }
  const width = imageData.width;
  const height = imageData.height;
  if (width <= 0 || height <= 0) {
    throw new RangeError(`generateSharesAll 錯誤：圖片尺寸無效 (${width}x${height})`);
  }

  k = Math.floor(Number(k));
  n = Math.floor(Number(n));
  if (!Number.isInteger(k) || !Number.isInteger(n)) {
    throw new TypeError('generateSharesAll 錯誤：門檻 k 與張數 n 必須為整數');
  }
  if (k < 1) {
    throw new RangeError(`generateSharesAll 錯誤：門檻 k 必須 ≥ 1 (傳入值: ${k})`);
  }
  if (n < k) {
    throw new RangeError(`generateSharesAll 錯誤：總張數 n (${n}) 不能小於門檻 k (${k})`);
  }
  if (n > 255) {
    throw new RangeError(`generateSharesAll 錯誤：總張數 n (${n}) 超過 GF(2^8) 上限 255`);
  }

  // 2. 建立 n 份新的 ImageData 物件（確保不改動原圖）
  const shares = new Array(n);
  for (let s = 0; s < n; s++) {
    const shareImg = createImageDataSafe(width, height);
    // 記錄 x 座標 (x 從 1 開始: 1 ... n)
    shareImg.shareX = s + 1;
    shares[s] = shareImg;
  }

  // 3. 走訪每個像素 i (共 width * height 個)
  const numPixels = width * height;
  const src = imageData.data;

  for (let i = 0; i < numPixels; i++) {
    const offset = i * 4;
    const r = src[offset];
    const g = src[offset + 1];
    const b = src[offset + 2];
    const a = src[offset + 3];

    // 對 R, G, B 分別呼叫 generateShares
    const rShares = callGenerateShares(r, k, n);
    const gShares = callGenerateShares(g, k, n);
    const bShares = callGenerateShares(b, k, n);

    // 第 s 張分享圖的第 i 個像素，填入各通道分量
    for (let s = 0; s < n; s++) {
      const dest = shares[s].data;
      dest[offset] = rShares[s];
      dest[offset + 1] = gShares[s];
      dest[offset + 2] = bShares[s];
      dest[offset + 3] = a; // A（透明度）通道複製原圖
    }
  }

  return shares;
}

/**
 * 吃進分享圖清單（至少 k 張）與門檻 k，還原出原始影像
 * @param {ImageData[]} imageDataList 分享圖清單（至少 k 張）
 * @param {number} k 門檻值
 * @param {string} [method] 還原時用哪種解法：'lagrange' | 'determinant' | 'gaussian'
 *   省略時預設 'lagrange'（行為與舊版相同）。
 * @returns {ImageData} 還原後的單一 ImageData 物件（尺寸對齊第一張分享圖）
 */
export function reconstructAll(imageDataList, k, method = DEFAULT_RECONSTRUCT_METHOD) {
  // 1. 防呆檢查
  if (!Array.isArray(imageDataList) || imageDataList.length === 0) {
    throw new TypeError('reconstructAll 錯誤：imageDataList 必須為非空的 ImageData 陣列');
  }

  if (!isReconstructMethod(method)) {
    throw new RangeError(
      `reconstructAll 錯誤：不認識的還原方法 "${method}"，可用：${Object.values(RECONSTRUCT_METHODS).join(' / ')}`
    );
  }

  k = Math.floor(Number(k));
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`reconstructAll 錯誤：門檻 k 必須為正整數且 ≥ 1 (傳入值: ${k})`);
  }
  if (imageDataList.length < k) {
    throw new Error(`reconstructAll 錯誤：分享圖張數不足！門檻 k 為 ${k}，但目前僅提供 ${imageDataList.length} 張`);
  }

  const baseImg = imageDataList[0];
  if (!baseImg || typeof baseImg.width !== 'number' || typeof baseImg.height !== 'number' || !baseImg.data) {
    throw new TypeError('reconstructAll 錯誤：第一張分享圖不是合法的 ImageData 物件');
  }
  const width = baseImg.width;
  const height = baseImg.height;
  if (width <= 0 || height <= 0) {
    throw new RangeError(`reconstructAll 錯誤：圖片尺寸無效 (${width}x${height})`);
  }

  // 驗證前 k 張分享圖尺寸是否完全對齊
  for (let s = 0; s < k; s++) {
    const img = imageDataList[s];
    if (!img || !img.data || img.width !== width || img.height !== height) {
      throw new Error(`reconstructAll 錯誤：第 ${s + 1} 張分享圖格式不正確或尺寸不一致 (預期 ${width}x${height}，實際 ${img ? img.width + 'x' + img.height : '無效'})`);
    }
  }

  // 2. 取得前 k 張分享圖的 x 座標（優先取 shareX，預設為 index + 1）
  const xCoords = new Array(k);
  const seenX = new Set();
  for (let s = 0; s < k; s++) {
    const item = imageDataList[s];
    let x = (item && (item.shareX || item._x)) ? Number(item.shareX || item._x) : (s + 1);
    if (!Number.isInteger(x) || x < 1 || x > 255) {
      x = s + 1;
    }
    if (seenX.has(x)) {
      throw new Error(`reconstructAll 錯誤：選取的分享圖存在重複的 x 座標 (${x})，無法還原！請確認每一張分享圖來自不同的份數。`);
    }
    seenX.add(x);
    xCoords[s] = x;
  }

  // 3. 建立目標 ImageData 物件
  const result = createImageDataSafe(width, height);
  const resData = result.data;
  const numPixels = width * height;

  // 預先建立 points 陣列以降低記憶體配置開銷
  const rPoints = new Array(k);
  const gPoints = new Array(k);
  const bPoints = new Array(k);
  for (let s = 0; s < k; s++) {
    rPoints[s] = { x: xCoords[s], y: 0 };
    gPoints[s] = { x: xCoords[s], y: 0 };
    bPoints[s] = { x: xCoords[s], y: 0 };
  }

  // 4. 走訪每個像素 i 進行通道還原
  for (let i = 0; i < numPixels; i++) {
    const offset = i * 4;

    for (let s = 0; s < k; s++) {
      const sData = imageDataList[s].data;
      rPoints[s].y = sData[offset];
      gPoints[s].y = sData[offset + 1];
      bPoints[s].y = sData[offset + 2];
    }

    resData[offset] = callReconstructPixel(rPoints, k, method);
    resData[offset + 1] = callReconstructPixel(gPoints, k, method);
    resData[offset + 2] = callReconstructPixel(bPoints, k, method);
    resData[offset + 3] = baseImg.data[offset + 3]; // A 通道直接複製
  }

  return result;
}


/**
 * =========================================================================
 * 3. 輔助函式：檔案讀取、Canvas 轉換與無損 PNG 下載
 * =========================================================================
 */
export function fileToImageData(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      return reject(new Error('請選擇圖片格式檔案（PNG, JPG, BMP 等）'));
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ imageData: imgData, width: canvas.width, height: canvas.height, name: file.name });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`無法讀取圖片檔案「${file.name}」，可能檔案已損壞或格式不支援`));
    };
    img.src = url;
  });
}

export function imageDataToCanvas(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function downloadImageDataAsPng(imageData, filename = 'share.png') {
  const canvas = imageDataToCanvas(imageData);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }, 'image/png');
}

/** 產生測試用小圖（供快速邊界案例測試） */
export function createTestPattern(type = 'color', size = 32) {
  const imgData = createImageDataSafe(size, size);
  const data = imgData.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      if (type === 'black') {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      } else if (type === '1x1') {
        data[idx] = 255;
        data[idx + 1] = 64;
        data[idx + 2] = 128;
        data[idx + 3] = 255;
      } else {
        // 彩色漸層圖
        data[idx] = Math.floor((x / size) * 255);
        data[idx + 1] = Math.floor((y / size) * 255);
        data[idx + 2] = Math.floor(((x + y) / (size * 2)) * 255);
        data[idx + 3] = 255;
      }
    }
  }
  return imgData;
}


/**
 * =========================================================================
 * 4. 網頁操作介面 (HTML/CSS & DOM 互動事件)
 *    只要在任何頁面載入 ui.js，便會自動掛載美觀、直覺且具備完整錯誤提示的現代介面！
 * =========================================================================
 */
const CSS_STYLES = `
.sss-app {
  max-width: 1200px;
  margin: 24px auto;
  padding: 24px 20px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: #1e2433;
  background: #ffffff;
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
}
.sss-header {
  border-bottom: 2px solid #eef2f7;
  padding-bottom: 16px;
  margin-bottom: 24px;
}
.sss-header h1 {
  font-size: 26px;
  margin: 0 0 8px 0;
  color: #1a2b6b;
  display: flex;
  align-items: center;
  gap: 10px;
}
.sss-header p {
  margin: 0;
  color: #64748b;
  font-size: 14px;
}
.sss-alert {
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 14px;
  display: none;
  animation: sssFadeIn 0.2s ease-in;
}
.sss-alert--error {
  display: block;
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
}
.sss-alert--success {
  display: block;
  background: #f0fdf4;
  color: #166534;
  border: 1px solid #bbf7d0;
}
.sss-alert--info {
  display: block;
  background: #eff6ff;
  color: #1e40af;
  border: 1px solid #bfdbfe;
}
.sss-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
@media (max-width: 900px) {
  .sss-grid { grid-template-columns: 1fr; }
}
.sss-panel {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
}
.sss-panel__title {
  font-size: 18px;
  font-weight: 700;
  margin: 0 0 16px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #0f172a;
}
.sss-badge {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  background: #e2e8f0;
  color: #475569;
}
.sss-badge--brand { background: #dbeafe; color: #1e40af; }
.sss-badge--success { background: #dcfce7; color: #15803d; }
.sss-form-group {
  margin-bottom: 16px;
}
.sss-form-group label {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 6px;
}
.sss-input-row {
  display: flex;
  gap: 12px;
}
.sss-input-row > div {
  flex: 1;
}
.sss-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 14px;
  background: #ffffff;
}
.sss-input:focus {
  border-color: #2563eb;
  outline: none;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.sss-dropzone {
  border: 2px dashed #cbd5e1;
  border-radius: 10px;
  padding: 16px;
  text-align: center;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.2s;
}
.sss-dropzone:hover, .sss-dropzone.dragover {
  border-color: #2563eb;
  background: #f0f7ff;
}
.sss-dropzone p {
  margin: 6px 0 0 0;
  font-size: 13px;
  color: #64748b;
}
.sss-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: background 0.15s, transform 0.1s;
}
.sss-btn:active { transform: scale(0.98); }
.sss-btn--primary {
  background: #2563eb;
  color: #ffffff;
}
.sss-btn--primary:hover { background: #1d4ed8; }
.sss-btn--success {
  background: #10b981;
  color: #ffffff;
}
.sss-btn--success:hover { background: #059669; }
.sss-btn--secondary {
  background: #e2e8f0;
  color: #1e293b;
}
.sss-btn--secondary:hover { background: #cbd5e1; }
.sss-btn--sm {
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 6px;
}
.sss-preview-box {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.sss-canvas-thumb {
  max-width: 100px;
  max-height: 100px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  image-rendering: pixelated;
  background: repeating-conic-gradient(#f1f5f9 0% 25%, #ffffff 0% 50%) 50% / 16px 16px;
}
.sss-meta-info {
  font-size: 12.5px;
  color: #475569;
  line-height: 1.6;
}
.sss-shares-container {
  margin-top: 16px;
  border-top: 1px solid #e2e8f0;
  padding-top: 16px;
}
.sss-shares-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
  margin-top: 10px;
}
.sss-share-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.sss-share-card canvas {
  width: 100%;
  height: 90px;
  object-fit: contain;
  image-rendering: pixelated;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  background: #fafafa;
}
.sss-share-card__title {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
  margin: 2px 0;
}
.sss-dec-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  margin-top: 10px;
}
.sss-dec-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 6px 10px;
}
.sss-dec-item canvas {
  width: 38px;
  height: 38px;
  border-radius: 4px;
  image-rendering: pixelated;
}
.sss-dec-item__name {
  flex: 1;
  font-size: 13px;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sss-dec-item__x {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #64748b;
}
.sss-dec-item__x input {
  width: 48px;
  padding: 3px 6px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 12px;
  text-align: center;
}
.sss-quick-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.sss-methods {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}
.sss-method {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.sss-method:hover {
  border-color: #93c5fd;
  background: #f8fbff;
}
.sss-method.is-active {
  border-color: #10b981;
  background: #f0fdf4;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
}
.sss-method input {
  margin-top: 3px;
  accent-color: #10b981;
  cursor: pointer;
}
.sss-method__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sss-method__name {
  font-size: 13.5px;
  font-weight: 600;
  color: #1e293b;
}
.sss-method__desc {
  font-size: 12px;
  color: #64748b;
}
@keyframes sssFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

export function mountSecretSharingUI(targetContainer) {
  if (!targetContainer) return;

  // 1. 注入專屬 CSS
  if (!document.getElementById('sss-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'sss-styles';
    styleEl.textContent = CSS_STYLES;
    document.head.appendChild(styleEl);
  }

  // 2. 構建介面 HTML
  targetContainer.innerHTML = `
    <div class="sss-app">
      <header class="sss-header">
        <h1>🔐 Shamir 機密影像分享系統</h1>
        <p>實作 (k, n) 門檻式機密影像分享與還原 · 採用 GF(2⁸) 有限體像素運算</p>
      </header>

      <div class="sss-alert" id="sss-alert-box"></div>

      <div class="sss-grid">
        <!-- 左欄：加密區 -->
        <section class="sss-panel">
          <div class="sss-panel__title">
            <span>📷 【加密區】影像拆分</span>
            <span class="sss-badge sss-badge--brand">Generate Shares</span>
          </div>

          <div class="sss-form-group">
            <label>1. 上傳原圖</label>
            <div class="sss-dropzone" id="sss-enc-dropzone">
              <input type="file" id="sss-enc-file" accept="image/*" style="display:none;" />
              <div><strong>點擊選擇圖片</strong> 或拖曳檔案至此</div>
              <p>支援 PNG / JPG / BMP（推薦無損 PNG 避免失真）</p>
            </div>
            <div class="sss-quick-actions">
              <span style="font-size:12px; color:#64748b; align-self:center;">快速測試：</span>
              <button type="button" class="sss-btn sss-btn--secondary sss-btn--sm" id="sss-btn-sample-gradient">🎨 32×32 漸層圖</button>
              <button type="button" class="sss-btn sss-btn--secondary sss-btn--sm" id="sss-btn-sample-black">⬛ 16×16 全黑圖</button>
              <button type="button" class="sss-btn sss-btn--secondary sss-btn--sm" id="sss-btn-sample-1x1">🔍 1×1 單點圖</button>
            </div>
          </div>

          <div id="sss-enc-preview-area" style="display:none;" class="sss-preview-box">
            <canvas id="sss-enc-preview-canvas" class="sss-canvas-thumb"></canvas>
            <div class="sss-meta-info">
              <div><strong>原圖名稱：</strong><span id="sss-enc-name">-</span></div>
              <div><strong>圖片尺寸：</strong><span id="sss-enc-dim">-</span></div>
              <div><strong>總像素量：</strong><span id="sss-enc-pixels">-</span> 像素</div>
            </div>
          </div>

          <div class="sss-form-group" style="margin-top: 14px;">
            <label>2. 設定門檻參數 (k, n)</label>
            <div class="sss-input-row">
              <div>
                <label style="font-size:12px; font-weight:normal;">門檻值 k (≥ 1)</label>
                <input type="number" id="sss-input-k" class="sss-input" value="3" min="1" max="255" />
              </div>
              <div>
                <label style="font-size:12px; font-weight:normal;">總張數 n (≥ k)</label>
                <input type="number" id="sss-input-n" class="sss-input" value="5" min="1" max="255" />
              </div>
            </div>
            <p style="font-size:12px; color:#64748b; margin:6px 0 0 0;">
              說明：湊齊任意 <strong>k</strong> 張即可還原，少於 k 張在數學上為完全隨機雜訊。
            </p>
          </div>

          <div style="margin-top: auto; padding-top: 14px;">
            <button type="button" class="sss-btn sss-btn--primary" id="sss-btn-generate" style="width:100%;">
              🚀 開始產生分享圖 (generateSharesAll)
            </button>
          </div>

          <!-- 分享圖產生結果區 -->
          <div class="sss-shares-container" id="sss-shares-area" style="display:none;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              <strong>產生的分享影像 (Shares)：</strong>
              <div style="display:flex; gap:6px;">
                <button type="button" class="sss-btn sss-btn--secondary sss-btn--sm" id="sss-btn-send-to-dec">
                  ➡️ 一鍵將前 k 張帶入還原區
                </button>
                <button type="button" class="sss-btn sss-btn--secondary sss-btn--sm" id="sss-btn-download-all">
                  📦 全部下載 (PNG)
                </button>
              </div>
            </div>
            <div class="sss-shares-grid" id="sss-shares-grid"></div>
          </div>
        </section>

        <!-- 右欄：還原區 -->
        <section class="sss-panel">
          <div class="sss-panel__title">
            <span>🔓 【還原區】影像重建</span>
            <span class="sss-badge sss-badge--success">Reconstruct</span>
          </div>

          <div class="sss-form-group">
            <label>1. 上傳分享圖（至少 k 張）</label>
            <div class="sss-dropzone" id="sss-dec-dropzone">
              <input type="file" id="sss-dec-file" accept="image/png,image/*" multiple style="display:none;" />
              <div><strong>點擊選擇分享圖</strong> 或拖曳多張檔案至此</div>
              <p>可按住 Ctrl / Shift 複選多張 PNG 檔案</p>
            </div>
          </div>

          <div class="sss-form-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <label style="margin:0;">目前已載入分享圖清單 (<span id="sss-dec-count">0</span> 張)</label>
              <button type="button" class="sss-btn sss-btn--secondary sss-btn--sm" id="sss-btn-clear-dec" style="display:none;">
                清空清單
              </button>
            </div>
            <div class="sss-dec-list" id="sss-dec-list">
              <div style="font-size:13px; color:#94a3b8; text-align:center; padding:16px;">
                尚未加入任何分享圖，請由上方上傳或自左側加入。
              </div>
            </div>
          </div>

          <div class="sss-form-group">
            <label>2. 設定還原門檻 k</label>
            <input type="number" id="sss-dec-k" class="sss-input" value="3" min="1" max="255" />
            <p style="font-size:12px; color:#64748b; margin:6px 0 0 0;">
              必須與拆分時設定的門檻 k 完全相同。
            </p>
          </div>

          <div class="sss-form-group">
            <label>3. 選擇還原解法（三選一）</label>
            <div class="sss-methods" id="sss-method-group">
              <label class="sss-method" data-method="lagrange">
                <input type="radio" name="sss-reconstruct-method" value="lagrange" />
                <span class="sss-method__text">
                  <span class="sss-method__name">拉格朗日插值（Lagrange）</span>
                  <span class="sss-method__desc">直接算 lᵢ(0) 後加權求和，代一次 x = 0 就得到 a₀</span>
                </span>
              </label>
              <label class="sss-method" data-method="determinant">
                <input type="radio" name="sss-reconstruct-method" value="determinant" />
                <span class="sss-method__text">
                  <span class="sss-method__name">行列式 + 克拉瑪公式（Determinant）</span>
                  <span class="sss-method__desc">a₀ = Δ₀ / Δ，Δ 為凡德蒙行列式，Δ₀ 把 a₀ 欄換成 y</span>
                </span>
              </label>
              <label class="sss-method" data-method="gaussian">
                <input type="radio" name="sss-reconstruct-method" value="gaussian" />
                <span class="sss-method__text">
                  <span class="sss-method__name">高斯消去法（Gaussian Elimination）</span>
                  <span class="sss-method__desc">增廣矩陣消成上三角，直接取 a₀ = R[0][k] / R[0][0]</span>
                </span>
              </label>
            </div>
            <p style="font-size:12px; color:#64748b; margin:6px 0 0 0;">
              三種解法在數學上完全等價，還原結果應逐像素相同。
            </p>
          </div>

          <div style="margin-top:auto; padding-top: 14px;">
            <button type="button" class="sss-btn sss-btn--success" id="sss-btn-reconstruct" style="width:100%;">
              🔓 開始還原原始圖片 (reconstructAll)
            </button>
          </div>

          <!-- 還原結果區 -->
          <div class="sss-shares-container" id="sss-rec-result-area" style="display:none;">
            <strong>還原結果預覽：</strong>
            <div class="sss-preview-box" style="margin-top:8px;">
              <canvas id="sss-rec-canvas" class="sss-canvas-thumb" style="max-width:140px; max-height:140px;"></canvas>
              <div class="sss-meta-info">
                <div><span class="sss-badge sss-badge--success">還原成功！</span></div>
                <div><strong>圖片尺寸：</strong><span id="sss-rec-dim">-</span></div>
                <div><strong>使用解法：</strong><span id="sss-rec-method">-</span></div>
                <div style="margin-top:8px;">
                  <button type="button" class="sss-btn sss-btn--primary sss-btn--sm" id="sss-btn-download-rec">
                    📥 下載還原影像 (PNG)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;

  // 3. 綁定 DOM 元素與狀態管理
  let currentOriginalImageData = null;
  let currentOriginalName = '';
  let generatedSharesList = [];
  let decShareItems = []; // { imageData, name, shareX }

  const alertBox = targetContainer.querySelector('#sss-alert-box');
  const encDropzone = targetContainer.querySelector('#sss-enc-dropzone');
  const encFileInput = targetContainer.querySelector('#sss-enc-file');
  const encPreviewArea = targetContainer.querySelector('#sss-enc-preview-area');
  const encPreviewCanvas = targetContainer.querySelector('#sss-enc-preview-canvas');
  const encNameEl = targetContainer.querySelector('#sss-enc-name');
  const encDimEl = targetContainer.querySelector('#sss-enc-dim');
  const encPixelsEl = targetContainer.querySelector('#sss-enc-pixels');
  const inputK = targetContainer.querySelector('#sss-input-k');
  const inputN = targetContainer.querySelector('#sss-input-n');
  const btnGenerate = targetContainer.querySelector('#sss-btn-generate');
  const sharesArea = targetContainer.querySelector('#sss-shares-area');
  const sharesGrid = targetContainer.querySelector('#sss-shares-grid');
  const btnDownloadAll = targetContainer.querySelector('#sss-btn-download-all');
  const btnSendToDec = targetContainer.querySelector('#sss-btn-send-to-dec');

  const decDropzone = targetContainer.querySelector('#sss-dec-dropzone');
  const decFileInput = targetContainer.querySelector('#sss-dec-file');
  const decCountEl = targetContainer.querySelector('#sss-dec-count');
  const decListEl = targetContainer.querySelector('#sss-dec-list');
  const btnClearDec = targetContainer.querySelector('#sss-btn-clear-dec');
  const decInputK = targetContainer.querySelector('#sss-dec-k');
  const methodGroup = targetContainer.querySelector('#sss-method-group');
  const methodInputs = Array.from(methodGroup.querySelectorAll('input[name="sss-reconstruct-method"]'));
  const btnReconstruct = targetContainer.querySelector('#sss-btn-reconstruct');
  const recResultArea = targetContainer.querySelector('#sss-rec-result-area');
  const recCanvas = targetContainer.querySelector('#sss-rec-canvas');
  const recDimEl = targetContainer.querySelector('#sss-rec-dim');
  const recMethodEl = targetContainer.querySelector('#sss-rec-method');
  const btnDownloadRec = targetContainer.querySelector('#sss-btn-download-rec');
  let currentReconstructedImageData = null;

  // 還原解法：預設拉格朗日，勾選哪個就同步高亮哪個
  const METHOD_LABELS = {
    [RECONSTRUCT_METHODS.LAGRANGE]: '拉格朗日插值（Lagrange）',
    [RECONSTRUCT_METHODS.DETERMINANT]: '行列式 + 克拉瑪公式（Determinant）',
    [RECONSTRUCT_METHODS.GAUSSIAN]: '高斯消去法（Gaussian）'
  };
  let selectedMethod = DEFAULT_RECONSTRUCT_METHOD;

  function setSelectedMethod(method) {
    if (!isReconstructMethod(method)) return;
    selectedMethod = method;
    methodInputs.forEach((input) => {
      const active = input.value === method;
      input.checked = active;
      const card = input.closest('.sss-method');
      if (card) card.classList.toggle('is-active', active);
    });
  }
  methodInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) setSelectedMethod(input.value);
    });
  });
  setSelectedMethod(DEFAULT_RECONSTRUCT_METHOD);

  function showAlert(msg, type = 'info', autoHideMs = 6000) {
    alertBox.className = `sss-alert sss-alert--${type}`;
    alertBox.innerHTML = (type === 'error' ? '❌ ' : type === 'success' ? '✅ ' : 'ℹ️ ') + msg;
    if (autoHideMs > 0) {
      clearTimeout(showAlert._timer);
      showAlert._timer = setTimeout(() => {
        alertBox.style.display = 'none';
      }, autoHideMs);
    }
  }

  function setOriginalImage(imageData, name = 'custom.png') {
    currentOriginalImageData = imageData;
    currentOriginalName = name;
    encPreviewCanvas.width = imageData.width;
    encPreviewCanvas.height = imageData.height;
    const ctx = encPreviewCanvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);

    encNameEl.textContent = name;
    encDimEl.textContent = `${imageData.width} × ${imageData.height}`;
    encPixelsEl.textContent = (imageData.width * imageData.height).toLocaleString();
    encPreviewArea.style.display = 'flex';
  }

  // 快捷測試按鈕
  targetContainer.querySelector('#sss-btn-sample-gradient').addEventListener('click', () => {
    setOriginalImage(createTestPattern('color', 32), 'sample_32x32_gradient.png');
    showAlert('已載入 32×32 彩色漸層測試圖！', 'info');
  });
  targetContainer.querySelector('#sss-btn-sample-black').addEventListener('click', () => {
    setOriginalImage(createTestPattern('black', 16), 'sample_16x16_black.png');
    showAlert('已載入 16×16 全黑測試圖！', 'info');
  });
  targetContainer.querySelector('#sss-btn-sample-1x1').addEventListener('click', () => {
    setOriginalImage(createTestPattern('1x1', 1), 'sample_1x1.png');
    showAlert('已載入 1×1 單點極限邊界測試圖！', 'info');
  });

  // 加密區上傳
  encDropzone.addEventListener('click', () => encFileInput.click());
  encDropzone.addEventListener('dragover', (e) => { e.preventDefault(); encDropzone.classList.add('dragover'); });
  encDropzone.addEventListener('dragleave', () => encDropzone.classList.remove('dragover'));
  encDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    encDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleEncFile(e.dataTransfer.files[0]);
    }
  });
  encFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleEncFile(e.target.files[0]);
    }
  });

  async function handleEncFile(file) {
    try {
      const res = await fileToImageData(file);
      setOriginalImage(res.imageData, res.name);
      showAlert(`成功載入圖片「${res.name}」(${res.width}×${res.height})`, 'success');
    } catch (err) {
      showAlert(err.message, 'error');
    }
  }

  // 產生分享圖事件
  btnGenerate.addEventListener('click', () => {
    if (!currentOriginalImageData) {
      showAlert('請先上傳原始圖片或選擇範例測試圖！', 'error');
      return;
    }
    const k = parseInt(inputK.value, 10);
    const n = parseInt(inputN.value, 10);

    // 基本前端防呆
    if (isNaN(k) || isNaN(n)) {
      showAlert('門檻 k 與總張數 n 必須是整數！', 'error');
      return;
    }
    if (k < 1) {
      showAlert('門檻 k 必須大於或等於 1！', 'error');
      return;
    }
    if (k > n) {
      showAlert(`門檻 k (${k}) 不能大於總張數 n (${n})！`, 'error');
      return;
    }
    if (n > 255) {
      showAlert(`總張數 n (${n}) 超過 GF(2⁸) 限制 255！`, 'error');
      return;
    }

    showAlert('正在拆分像素中，請稍候...', 'info', 0);
    btnGenerate.disabled = true;

    setTimeout(() => {
      try {
        const shares = generateSharesAll(currentOriginalImageData, k, n);
        generatedSharesList = shares;
        renderSharesGrid(shares);
        decInputK.value = k; // 同步預設還原 k
        showAlert(`成功拆分！已生成 ${shares.length} 張無損分享圖 (k=${k}, n=${n})`, 'success');
      } catch (err) {
        showAlert(`拆分發生錯誤：${err.message}`, 'error');
      } finally {
        btnGenerate.disabled = false;
      }
    }, 40);
  });

  function renderSharesGrid(shares) {
    sharesGrid.innerHTML = '';
    sharesArea.style.display = 'block';

    shares.forEach((share, idx) => {
      const x = share.shareX || (idx + 1);
      const card = document.createElement('div');
      card.className = 'sss-share-card';

      const canvas = imageDataToCanvas(share);
      const title = document.createElement('div');
      title.className = 'sss-share-card__title';
      title.textContent = `Share #${x} (x=${x})`;

      const btnDl = document.createElement('button');
      btnDl.type = 'button';
      btnDl.className = 'sss-btn sss-btn--secondary sss-btn--sm';
      btnDl.style.width = '100%';
      btnDl.textContent = '📥 下載 PNG';
      btnDl.onclick = () => downloadImageDataAsPng(share, `share_${x}.png`);

      const btnAdd = document.createElement('button');
      btnAdd.type = 'button';
      btnAdd.className = 'sss-btn sss-btn--primary sss-btn--sm';
      btnAdd.style.width = '100%';
      btnAdd.textContent = '➕ 傳送至還原區';
      btnAdd.onclick = () => {
        addShareToDecList(share, `share_${x}.png`, x);
        showAlert(`已將 Share #${x} 加至還原清單！`, 'info');
      };

      card.appendChild(canvas);
      card.appendChild(title);
      card.appendChild(btnDl);
      card.appendChild(btnAdd);
      sharesGrid.appendChild(card);
    });
  }

  // 全部下載
  btnDownloadAll.addEventListener('click', () => {
    if (!generatedSharesList || generatedSharesList.length === 0) return;
    generatedSharesList.forEach((share, idx) => {
      setTimeout(() => {
        downloadImageDataAsPng(share, `share_${share.shareX || (idx + 1)}.png`);
      }, idx * 180);
    });
  });

  // 一鍵傳送前 k 張
  btnSendToDec.addEventListener('click', () => {
    const k = parseInt(inputK.value, 10);
    if (!generatedSharesList || generatedSharesList.length === 0) return;
    decShareItems = [];
    for (let i = 0; i < Math.min(k, generatedSharesList.length); i++) {
      const s = generatedSharesList[i];
      const x = s.shareX || (i + 1);
      decShareItems.push({ imageData: s, name: `share_${x}.png`, shareX: x });
    }
    renderDecList();
    showAlert(`已將前 ${decShareItems.length} 張分享圖加入還原清單！`, 'success');
  });


  // 還原區檔案上傳
  decDropzone.addEventListener('click', () => decFileInput.click());
  decDropzone.addEventListener('dragover', (e) => { e.preventDefault(); decDropzone.classList.add('dragover'); });
  decDropzone.addEventListener('dragleave', () => decDropzone.classList.remove('dragover'));
  decDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    decDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      handleDecFiles(Array.from(e.dataTransfer.files));
    }
  });
  decFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) {
      handleDecFiles(Array.from(e.target.files));
      decFileInput.value = '';
    }
  });

  async function handleDecFiles(files) {
    showAlert('正在載入分享圖...', 'info', 0);
    let loadedCount = 0;
    for (const f of files) {
      try {
        const res = await fileToImageData(f);
        // 嘗試從檔名解析 x 座標（例如 share_3.png -> x=3）
        let guessedX = null;
        const match = res.name.match(/(?:share[_\-\s]?|#)?(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= 1 && num <= 255) guessedX = num;
        }
        res.imageData.shareX = guessedX || (decShareItems.length + 1);
        decShareItems.push({
          imageData: res.imageData,
          name: res.name,
          shareX: res.imageData.shareX
        });
        loadedCount++;
      } catch (err) {
        showAlert(err.message, 'error');
      }
    }
    renderDecList();
    showAlert(`已成功載入 ${loadedCount} 張分享圖！`, 'success');
  }

  function addShareToDecList(imageData, name, x) {
    // 檢查是否已存在相同的 x
    const exists = decShareItems.find(item => item.shareX === x);
    if (!exists) {
      imageData.shareX = x;
      decShareItems.push({ imageData, name, shareX: x });
      renderDecList();
    }
  }

  function renderDecList() {
    decCountEl.textContent = decShareItems.length;
    btnClearDec.style.display = decShareItems.length > 0 ? 'inline-block' : 'none';

    if (decShareItems.length === 0) {
      decListEl.innerHTML = `
        <div style="font-size:13px; color:#94a3b8; text-align:center; padding:16px;">
          尚未加入任何分享圖，請由上方上傳或自左側加入。
        </div>
      `;
      return;
    }

    decListEl.innerHTML = '';
    decShareItems.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'sss-dec-item';

      const canvas = imageDataToCanvas(item.imageData);

      const nameEl = document.createElement('div');
      nameEl.className = 'sss-dec-item__name';
      nameEl.textContent = `${idx + 1}. ${item.name} (${item.imageData.width}×${item.imageData.height})`;

      const xWrapper = document.createElement('div');
      xWrapper.className = 'sss-dec-item__x';
      xWrapper.innerHTML = `<span>x:</span>`;
      const xInput = document.createElement('input');
      xInput.type = 'number';
      xInput.min = '1';
      xInput.max = '255';
      xInput.value = item.shareX;
      xInput.onchange = () => {
        const val = parseInt(xInput.value, 10);
        if (val >= 1 && val <= 255) {
          item.shareX = val;
          item.imageData.shareX = val;
        } else {
          xInput.value = item.shareX;
        }
      };
      xWrapper.appendChild(xInput);

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'sss-btn sss-btn--secondary sss-btn--sm';
      btnDel.textContent = '✕';
      btnDel.title = '移除此張分享圖';
      btnDel.onclick = () => {
        decShareItems.splice(idx, 1);
        renderDecList();
      };

      row.appendChild(canvas);
      row.appendChild(nameEl);
      row.appendChild(xWrapper);
      row.appendChild(btnDel);
      decListEl.appendChild(row);
    });
  }

  btnClearDec.addEventListener('click', () => {
    decShareItems = [];
    renderDecList();
  });

  // 還原圖片按鈕
  btnReconstruct.addEventListener('click', () => {
    const k = parseInt(decInputK.value, 10);

    // 前端防呆校驗
    if (isNaN(k) || k < 1) {
      showAlert('請輸入合法的門檻值 k (≥ 1)！', 'error');
      return;
    }
    if (decShareItems.length === 0) {
      showAlert('請先上傳或選擇分享圖！', 'error');
      return;
    }
    if (decShareItems.length < k) {
      showAlert(`目前選取的分享圖數量 (${decShareItems.length} 張) 小於門檻值 k (${k})，無法還原！`, 'error');
      return;
    }

    showAlert(`正在用「${METHOD_LABELS[selectedMethod]}」還原像素中，請稍候...`, 'info', 0);
    btnReconstruct.disabled = true;

    setTimeout(() => {
      try {
        const imagesToReconstruct = decShareItems.map(item => item.imageData);
        const reconstructed = reconstructAll(imagesToReconstruct, k, selectedMethod);
        currentReconstructedImageData = reconstructed;

        recCanvas.width = reconstructed.width;
        recCanvas.height = reconstructed.height;
        const ctx = recCanvas.getContext('2d');
        ctx.putImageData(reconstructed, 0, 0);

        recDimEl.textContent = `${reconstructed.width} × ${reconstructed.height}`;
        recMethodEl.textContent = METHOD_LABELS[selectedMethod];
        recResultArea.style.display = 'block';
        showAlert(`🎉 圖片還原成功！尺寸：${reconstructed.width} × ${reconstructed.height}（解法：${METHOD_LABELS[selectedMethod]}）`, 'success');
      } catch (err) {
        showAlert(`還原失敗：${err.message}`, 'error');
      } finally {
        btnReconstruct.disabled = false;
      }
    }, 40);
  });

  // 下載還原圖片
  btnDownloadRec.addEventListener('click', () => {
    if (!currentReconstructedImageData) return;
    downloadImageDataAsPng(currentReconstructedImageData, 'reconstructed_secret.png');
  });
}


/**
 * =========================================================================
 * 5. 自動掛載 (Auto-mount)
 *    若在瀏覽器環境中執行，會自動尋找 #secret-sharing-app 或在 body 尾端建立容器
 * =========================================================================
 */
function autoMount() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let container = document.getElementById('secret-sharing-app') || document.getElementById('app');
  if (!container && document.body) {
    container = document.createElement('div');
    container.id = 'secret-sharing-app';
    document.body.appendChild(container);
  }
  if (container && !container.hasAttribute('data-sss-mounted')) {
    container.setAttribute('data-sss-mounted', 'true');
    mountSecretSharingUI(container);
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
  window.SecretSharingUI = {
    generateSharesAll,
    reconstructAll,
    mountSecretSharingUI,
    createTestPattern,
    RECONSTRUCT_METHODS,
    DEFAULT_RECONSTRUCT_METHOD
  };
}
