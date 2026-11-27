> 11/20 (Fri) 要討論的東西。每條規格都要能回答三件事：**函式叫什麼／輸入長什麼樣／輸出長什麼樣**。回答不出來的就不是規格，是願望。

---

## 1. 先搞清楚：介面規格 ≠ UML

| | UML / 類別圖 | 介面規格（這裡要的） |
| --- | --- | --- |
| 給誰看 | 人，畫設計 | 人 + 程式 |
| 內容 | class、繼承、關係 | 函式名、參數、回傳值、錯誤行為 |
| 少了會怎樣 | 設計不夠漂亮 | **三個人寫的東西接不起來** |
| 必須嗎 | 不一定 | 必須 |

### 三種寫法，效果一樣，選一種就好

```js
// 寫法 1：純函式 + 物件（推薦，最少坑）
const GF28 = {
  add(a, b) { return a ^ b; },
  mul(a, b) { /* ... */ },
};
export { GF28 };

// 寫法 2：class 的 static method（喜歡 C++ 感覺就用這個）
class GF28 {
  static add(a, b) { return a ^ b; }
}

// 寫法 3：export 一堆函式
export function gfAdd(a, b) { return a ^ b; }
```

三種在**呼叫端**長得都一樣：`GF28.add(a, b)`。所以「介面規格」只寫 `GF28.add(a, b) → number`，底層用哪種寫法讓 安 自己決定，不影響其他人。

---

## 3. 這個專案真正的介面（可以直接抄進程式）

三個模組的邊界只有 **4 個函式**。先講好這 4 個，其他都自由發揮。

### A `gf28.js` — 數學庫（安）

```js
// 全部輸入輸出都是 0–255 的整數
GF28.add(a, b)        // → number   就是 a ^ b
GF28.sub(a, b)        // → number   同 add（GF(2^8) 裡加等於減）
GF28.mul(a, b)        // → number   查表法
GF28.div(a, b)        // → number   b ≠ 0，b = 0 要 throw
GF28.pow(a, e)        // → number   可選，做拉格朗日會用到
GF28.init()           // → void     建 log/exp 表；模組載入時自動呼叫一次即可
```

如果 蕭 需要更快的版本，可以另開但不強迫：`GF28.mulRow(coeff, Uint8Array)`。

### B `shamir.js` — 核心演算法（蕭）

```js
// 單一像素值
generateShares(value, k, n)   // → number[]，長度 n，索引 0..n-1 對應第 1..n 張 share

// 用「座標 + 值」還原，座標就是 share 的編號
reconstructPixel(points, k, method)  // points: [{x, y}, ...] 至少 k 個 → number
//   method 可省略，預設 'lagrange'；可選 'lagrange' | 'determinant' | 'gaussian'
```

- `value` 和回傳的每個元素都是 **0–255**。
- `x` 座標用 `1..n`（**不要用 0**，$f(0)=a_0$ 是秘密本身）。
- `k, n`：`1 ≤ k ≤ n ≤ 255`。
- 不要傳整張圖進來。整張圖的迴圈由誰跑？——**由 ui 跑**（見 §3 的資料流）。

### C `ui.js` — 畫面 + Canvas（妡）

```js
// 妡只呼叫這兩個（內部自己 for 每個像素）
generateSharesAll(imageData, k, n)   // → ImageData[]  長度 n，每張尺寸 = 原圖
reconstructAll(imageDataList, k)     // → ImageData    尺寸 = 第一張的分享圖
```

`generateSharesAll` 內部對每個像素每個通道做：

```
r = generateShares(R, k, n)    // 第 i 張分享圖的這個像素 = r[i]
g = generateShares(G, k, n)
b = generateShares(B, k, n)
```

`reconstructAll` 則是把第 i 張分享圖的 R 通道配上 `{x: i+1, y: R}` 丟進 `reconstructPixel`，三通道各一次，alpha 直接複製。

> [!note] 為什麼迴圈放 ui 不放 shamir？
> 因為「哪張圖是第幾號 share」是 UI 的概念。shamir 只認得數字，不知道什麼叫「圖片」。這樣 蕭 寫的 `shamir.js` 可以完全不碰 Canvas。


### 資料格式：四個決定，選建議的

| 項目 | 選項 | 建議 |
| --- | --- | --- |
| 像素表示 | `[R,G,B]` 陣列 / `ImageData.data` / `Uint8ClampedArray` | **`ImageData`**（Canvas 原生，`ctx.getImageData()` 直接就是它，不用轉換、不用複製） |
| share 標記 | 改檔名 / 塞在像素裡 / 每張圖附一個 index | **函式參數傳 index**，不要在像素裡藏東西 |
| 逐通道還是一起 | 每個通道獨立做一次 / 三通道一起 | **獨立做三次** |
| 失敗怎麼辦 | 回 0 / 回 null / throw | **throw**（`k` 不夠時要讓畫面顯示錯誤，不能默默生一張錯的圖） |

`ImageData` 的結構：`data` 是 `[R0,G0,B0,A0, R1,G1,B1,A1, ...]`，**每 4 個一組，index 4i+0/1/2/3**。

---

## 4. 「好介面」的檢查清單

拿到 組員的交出來的規格，直接拿這幾條打勾：

- [ ] **每個函式都有名字、參數型別、回傳型別**（`generateShares(value: number, k: number, n: number) → number[]`）
- [ ] **輸入值的範圍寫死**（0–255、`k ≤ n`、`x ≥ 1`）
- [ ] **邊界情況有定義**：`div(a, 0)`、`k > n`、`k` 不夠張、全黑圖、1×1 圖
- [ ] **誰改輸入、誰負責複製**：例「`generateShares` 不改輸入」「`generateSharesAll` 回傳新 ImageData，不動原圖」
- [ ] **假資料（mock）可以互換**：蕭 在 安 還沒寫好前，可以用假的 `GF28` 先跑；妡 可以用假的 `generateShares` 先做畫面
- [ ] **每個模組都能單獨測試**：`gf28` 用幾組已知答案（例如 $x^8+x^4+x^3+x+1$ 下的乘積表）、`shamir` 用「拆完再還原要等於原值」
- [ ] **錯誤不沉默**：throw 什麼型別的錯誤、UI 怎麼顯示
- [ ] **檔案／匯出名稱** 對齊：`gf28.js` 匯出 `GF28`，`shamir.js` 匯出 `generateShares` / `reconstructPixel`

### 需要 assertByte 的理由

```js
const assertByte = (v) => {
  if (!Number.isInteger(v) || v < 0 || v > 255)
    throw new RangeError(`byte 必須是 0–255 的整數，收到 ${v}`);
};
```

加在每個 `GF28.*` 和 `generateShares` 開頭。開發期抓得到 bug，正式版可以留著（成本很低）。


---

## 7. 介面草稿（可以直接貼給組員）

```js
// ---------- gf28.js（安） ----------
export const GF28 = {
  add(a, b) {},      // a ^ b，a, b ∈ [0,255]
  sub(a, b) {},      // 同 add
  mul(a, b) {},      // 查表，a, b ∈ [0,255]
  div(a, b) {},      // b !== 0，否則 throw RangeError
};

// ---------- shamir.js（蕭） ----------
/**
 * @param {number} value 0–255
 * @param {number} k 門檻
 * @param {number} n 張數，k ≤ n ≤ 255
 * @returns {number[]} 長度 n，0–255
 */
export function generateShares(value, k, n) {}

/**
 * @param {{x:number, y:number}[]} points x ∈ [1,n]，至少 k 個
 * @param {number} k
 * @param {'lagrange'|'determinant'|'gaussian'} [method] 預設 'lagrange'
 * @returns {number} 0–255
 */
export function reconstructPixel(points, k, method = "lagrange") {}

// ---------- ui.js（妡） ----------
/** @returns {ImageData[]} 長度 n，不動原圖 */
export function generateSharesAll(imageData, k, n) {}
/** @param {ImageData[]} imageDataList 至少 k 張 @returns {ImageData} */
export function reconstructAll(imageDataList, k) {}
```
