# 投影片動畫規格書（給 AI coding 用）

> 版本：1.0　·　適用檔案：`style.css`、`deck.js`、`anim.js`、`index.html`、`chapterN.html`
> 一句話：**每一頁（`.slide`）自己決定有幾個 step、每個 step 長什麼樣；共用播放器只負責「翻頁」與「頁內前進／後退」。**

---

## 0. 給 AI 的執行規則（先讀這段）

1. **不要改既有視覺語言**：顏色、字體、圓角、陰影一律沿用 `style.css` 的 `:root` 變數，禁止在章節 HTML 內新增色碼字面值（`#fff`、`red` 等）。
2. **不要改 `deck.js` 的翻頁職責**：`deck.js` 只認 `.slide` 與 `.is-active`。step 的處理全部放 `anim.js`；`deck.js` 只允許「通知目前頁」這一個接管點（見 §4.3）。
3. **章節檔必須能各自獨立開啟**：`chapterN.html` 直接雙擊也要能播（`deck.js` 自動初始化）。
4. **合併播放**：`index.html` 只 import `.slide`，因此**動畫必須寫在 `.slide` 之內**（見 §2.1）。寫在 `<head>`／`</main>` 之後的 `<style>`、`<script>` 在合併時會遺失。
5. **每一步都要能跑**：改完用 §8 的驗收清單自測，不可留下 `console.error`。
6. **實作以現有程式為準**：§3.1（`:host(...)` 寫法）、§4.3（`SlideSteps` 完整介面與
   `deck.js` 的 `stepOrPage`）、§4.4（按鍵只留在 `deck.js`）、§11 已是修正後版本。
   若文件與 `anim.js`／`deck.js` 的實際行為不一致，**以程式為準**並回頭修文件。

---

## 1. 名詞

| 名詞 | 定義 |
|---|---|
| **頁 / slide** | 一個 `<section class="slide">`，是最小翻頁單位 |
| **step / 子頁** | 一頁內部的狀態，0 起算。`0` 是進場狀態，`steps - 1` 是最終狀態 |
| **靜態頁** | 沒有設定 `window.SlideAnim` 的頁，`steps = 1`，按一下前進就翻頁 |
| **共用端** | `style.css`、`deck.js`、`anim.js`、`index.html` |
| **章節端** | `chapterN.html`，由各章作者維護，內容與動畫都在裡面 |

---

## 2. 章節作者契約（最重要）

### 2.1 動畫必須寫在 `.slide` 內

```html
<section class="slide" aria-label="一次多項式分鏡">
  <!-- 內容：可用共用樣式（.h2 / .callout / .figure …） -->
  <div class="slide__body">
    <div class="stage">…</div>
  </div>

  <!-- 這一頁自己的樣式 -->
  <style>
    .stage { position: relative; height: 100%; }
    .stage__line { stroke: var(--brand); }
  </style>

  <!-- 這一頁自己的動畫程式 -->
  <script>
    window.SlideAnim = { steps: 8, init: function (root) { /* … */ } };
  </script>
</section>
```

**理由**：`index.html` 用 `document.importNode(slide, true)` 深層複製 `.slide`，子節點的 `<style>`／`<script>` 會一起被搬過去；寫在 `.slide` 之外則會被丟棄。

### 2.2 動畫腳本的三條規矩

1. **只透過 `root` 找元素**：`root.querySelector(...)`。禁止 `document.getElementById`、`document.querySelector`（合併後會抓到別章）。
2. **不要汙染全域**：除了 `window.SlideAnim` 之外不新增全域變數；私有狀態放閉包或 `init` 內。
3. **可重複初始化**：`init(root)` 可能被呼叫多次（重新載入章節、重新啟動），必須冪等，或回傳 `{ dispose: function () {} }` 供清理。

### 2.3 一頁一個動畫單元

一頁只設一次 `window.SlideAnim`；`init` 內可操作多個元件（左圖右公式）。若需要「各自獨立的 step 序列」，拆成兩頁。


---

## 3. `window.SlideAnim` 介面規格

寫在 `.slide` 內的 `<script>`，**同步賦值**（不要包在 `DOMContentLoaded` 裡；播放器會依序執行）：

```js
window.SlideAnim = {
  /** 總步數（含第 0 步）。>= 1 的整數。省略時視為 1。 */
  steps: 8,

  /**
   * 啟動時呼叫一次。可能被呼叫多次，必須冪等。
   * @param {ShadowRoot} root 這一頁的隔離根（§4.2）。所有查詢都從這裡開始。
   * @returns {void | { dispose?: function (): void }}
   */
  init: function (root) {},

  /**
   * 每次 step 改變時呼叫（含歸零、前進、後退）。
   * @param {number} step 目前步數，0 <= step < steps
   * @param {number} prev 上一步；歸零時 prev 會大於 step
   * @param {ShadowRoot} root
   */
  enter: function (step, prev, root) {},

  /** 選用：自動播放間隔（毫秒），預設 1200。 */
  autoDelay: 1200,
};
```

- **必要**：`init`（省略時視為靜態；`steps` 仍可 > 1，外觀全靠 CSS）。
- **選用**：`enter`、`autoDelay`、`init` 回傳的 `dispose`。

### 3.1 純 CSS 的 step（推薦）

> ⚠️ **shadow root 內要寫 `:host(...)`，不能寫 `.slide[data-step="N"]`。**
> 每一頁的內容都住在自己的 shadow root 裡，而 `section.slide` 本身在**外面**；
> shadow root 裡的 `.slide[data-step="N"] .pt` 只能選到「內層的」`.slide`，
> 永遠匹配不到自己這一頁 → 規則看起來寫了卻完全沒作用。
> `:host(...)` 則是「比對宿主元素（= 自己這顆 `section.slide`）」，才對。

```css
.pt { opacity: 0; transition: opacity 0.5s ease; }                     /* 預設隱藏 */

:host(.slide[data-step="3"]) .pt,
:host(.slide[data-step="4"]) .pt { opacity: 1; }                        /* >=3 才顯示 */
```

播放器保證：
1. 目前頁的 `data-step` 永遠等於目前步數（同一個 frame 內更新），寫在 `section.slide` 上；
2. 頁面被翻走再翻回來，`data-step` 歸零（§4.4）。

> 不想列舉 `[data-step="N"]` 組合時，可在 `enter` 切 class：
> `root.host.classList.toggle("is-past-3", step >= 3)`，CSS 寫 `.is-past-3 .pt { opacity: 1 }`。
> （`.is-past-3` 在 shadow root 內層元素上，用一般選擇器即可。）

---

## 4. 共用端規格

### 4.1 檔案職責（不可混用）

| 檔案 | 職責 | 本次異動 |
|---|---|---|
| `style.css` | 全站視覺：變數、字體、版面、元件、列印 | 只新增 step 通用規則（§4.6） |
| `deck.js` | 翻頁、頁碼、進度條、全螢幕、觸控、深層連結 | 只新增「通知目前頁」接管點（§4.3） |
| `anim.js`（新增） | 掃描 `.slide` → 建立 ShadowRoot → 注入樣式 → 執行頁內腳本 → step 狀態機 | 全新 |
| `index.html` | 章節合併、章節切換、深層連結 | 只加 `<script src="anim.js">` 與 `SlideSteps.boot()` |
| `chapterN.html` | 內容與該頁動畫 | 第 1 章新增分鏡頁 |

### 4.2 `anim.js`：Shadow DOM 隔離

**目的**：每頁的 `<style>`、`<script>`、SVG `id` 互不干擾（第 6 章已有 `#grid6`、`#hatch6a`，未來必撞名）。

```
activate(slide):
  1. slide.__animRoot 已存在 → return（冪等）
  2. root = slide.attachShadow({ mode: "open" })        // open 方便除錯
  3. 注入共用樣式：root 內放 <link rel="stylesheet" href="style.css"> + :host 規則
  4. 搬移原有子節點：Array.from(slide.childNodes).forEach(n => root.appendChild(n))
  5. 執行 root 內的 <script>（§4.5）
  6. 讀取設定 → slide.__animConfig
  7. slide.__anim = makeController(slide, slide.__animConfig, root)
  8. 若 slide 有 is-active → enter(0)
```

**實作決定（必須照做）**：

- **host（`.slide`）負責**：`position`、尺寸、`opacity`／`visibility`／`transform`、背景 → 仍由文件層 `style.css` 的 `.slide`、`.slide.is-active` 控制。
- **shadow root 內注入**：`style.css` 全檔（文件層一般選擇器無法穿透 shadow boundary，不注入會讓 `.h2`、`.callout` 全部失效）。
- 注入內容之後再補一段 `<style>`：

```css
/* anim.js 注入：維持 .slide 原本的版面（數值需與 style.css 的 .slide 同步） */
:host {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: var(--gap-row);
  padding: var(--pad-y) var(--pad-x);
  color: var(--ink-900);
  background-color: var(--paper);
  background-image: radial-gradient(rgba(47, 87, 214, 0.1) 1px, transparent 1px);
  background-size: 28px 28px;
  background-position: 14px 14px;
}
```

> `:root` 的自訂變數會穿透 shadow boundary，`var(--brand)` 等可直接使用。

### 4.3 `deck.js` 的接管點（唯一允許的修改）

`show()` 更新完 `index`、頁碼、進度條之後，通知 step 控制器：

```js
// deck.js：show() 內，"if (onChange) onChange(pageNo);" 之後
if (window.SlideSteps) window.SlideSteps.onSlideChange(slides[next]);
```

**`anim.js` 對外介面（全域唯一）**：

```js
window.SlideSteps = {
  boot: function () {},                           // 掃描並啟動所有 .slide（可重複呼叫）
  onSlideChange: function (slide) {},             // deck.js 換頁後通知；回傳該頁控制器或 null
  activate: function (slide) {},                  // 確保某頁已啟動；回傳控制器或 null
  isStatic: function (slide) { return true; },    // 這一頁沒有動畫（沒有 window.SlideAnim）？
  canAdvance: function (slide) { return false; }, // 這一頁還有下一步？
  handlesKey: function (e) { return false; },     // 備援掛勾，目前永遠 false（見下）
  play: function (slide) {},                      // 開始自動播放（省略 slide = 目前這頁）
  stop: function () {},                           // 停止目前這頁的自動播放
  reinit: function (slide, config) {},            // 換掉某頁設定並重新開始（省略 slide = 目前這頁）
};
```

- `slide` 參數省略時，指「目前這一頁」。
- `deck.js` 實際**只需要** `onSlideChange`、`activate`、`isStatic`（見下方 `stepOrPage`）；
  其餘函式是給章節作者／除錯用的，章節裡不必呼叫任何一支就能有動畫。

**`deck.js` 的接法（按鍵只留在這裡**，`anim.js` 不掛 `keydown`）：

```js
function stepOrPage(delta) {
  if (window.SlideSteps) {
    var steps = window.SlideSteps;
    var active = slides[index];
    if (active) {
      var controller = steps.activate(active);          // 第一次用到才啟動
      if (steps.isStatic(active) === false && controller) {
        if (delta > 0 ? controller.advance() : controller.reverse()) return; // 換步，不翻頁
      }
    }
  }
  step(delta);                                          // 沒步數了 → 原本的翻頁
}
```

`→`／`↓`／`PageDown`／`Space`／`Enter` 走 `stepOrPage(1)`，`←`／`↑`／`PageUp`／
`Backspace` 走 `stepOrPage(-1)`；左右鍵、按鈕、觸控滑動全部改成呼叫它。
`Home`／`End`／`F`／`P` 完全不動。

**相容性（硬性要求）**：

- `deck.js` 對 `SlideSteps` 的所有呼叫都必須有 `if (window.SlideSteps)` 保護。
- `anim.js` 未載入時，`deck.js` 行為必須與現在**完全相同**（就能全部翻頁）。
- `End` 鍵：跳到最後一頁的 `step 0`（不自動跑到最後一步）。

### 4.4 step 狀態機（必要行為）

| 事件 | 行為 |
|---|---|
| 本頁變成 `is-active` | `goto(0)`，並設 `data-step="0"` |
| 本頁失去 `is-active` | 停止自動播放；`data-step` 停在原值（下次進入時歸零） |
| 前進且 `step < steps - 1` | `goto(step + 1)`，**不翻頁** |
| 前進且 `step === steps - 1` | 由 `deck.js` 翻下一頁 |
| 後退且 `step > 0` | `goto(step - 1)`，**不翻頁** |
| 後退且 `step === 0` | 由 `deck.js` 翻上一頁 |
| 靜態頁（`steps` 未設定或 `= 1`） | 與現有行為完全相同（立即翻頁） |
| 本頁有 `[data-step-count]` | 自動填入 `n / steps`（1 起算顯示） |

**鍵位（不得改變既有鍵位）**：

| 鍵 | 頁內 step 未到底 | 已在最後一步 |
|---|---|---|
| `→` `↓` `PageDown` `Space` `Enter` | 頁內下一步 | 翻下一頁 |
| `←` `↑` `PageUp` `Backspace` | 頁內上一步 | 翻上一頁 |
| `Home` / `End` / `F` / `P` | 不變（`End` → 最後一頁第 0 步） | 同左 |

**實作方式**：按鍵**只**由 `deck.js` 的 `onKeyDown` 處理（見 §4.3 的 `stepOrPage`），
`anim.js` **不要**再掛 `window` 的 `keydown` listener。

> 為什麼不是「兩支腳本搶 capture」：`window` 上同一個階段的 listener，執行順序
> 在瀏覽器之間**不一致**（Chrome 實測是「後註冊者先執行」，與部分文件寫的相反）。
> 兩支都掛 capture 時，誰先跑會變成看載入順序的巧合，很容易出現「按一下跳兩頁」。
> 由 `deck.js` 一支負責、遇到有 step 的頁面先問 `isStatic`／`advance`，結果就完全可預測。
> 載入順序仍固定 **`deck.js` 先、`anim.js` 後**（§5.1、§5.2），只是不再是正確性的前提。

`handlesKey` 因此保留為空實作（永遠回傳 `false`），僅作為「未來若真的需要
`anim.js` 先處理按鍵」時的掛勾，`deck.js` 目前不會呼叫它。

**觸控**：`deck.js` 現有左右滑動改走 `stepOrPage`，所以有 step 的頁面會先換步、到底才翻頁（`anim.js` 另外在 shadow root 內掛了同樣的 touch 判斷當備援，兩者不會重複觸發）。

**自動播放（選用）**：頁面若在該頁內放 `<button data-step-nav="play">`，`anim.js` 自動綁定：
每 `autoDelay` 毫秒前進一步，到最後一步**停止**（不會自動翻頁）；翻頁時一併停止。
按鈕的 `aria-pressed` 會跟著變化，播放中 `section.slide` 上會有 `data-playing` 屬性，
CSS 可用它做提示。也可以直接呼叫 `window.SlideSteps.play()`／`stop()`。

`Space` 一律等於「前進」（不觸發自動播放），自動播放只靠按鈕或 API。

### 4.5 頁內腳本的執行

`importNode`／`appendChild` 搬移的 `<script>` **不會自動執行**，因此 `anim.js` 必須：

1. 先搬移所有子節點（含 `<style>`、`<script>`）；
2. `root.querySelectorAll("script")` 逐一以 `document.createElement("script")` 重建（複製屬性與 `textContent`）並 `root.appendChild`；
3. 讀取 `window.SlideAnim` 後**立刻刪除**，避免跨頁污染：

```js
delete window.SlideAnim;
runScripts(root);                 // 頁內腳本在此設定 window.SlideAnim
var config = window.SlideAnim || null;
slide.__animConfig = config;
delete window.SlideAnim;
```

- `type="module"` 支援非必要；**不建議**章節作者使用（非同步，會與 step 初始化競態）。
- 頁內腳本錯誤應 `console.error` 並讓該頁退化為靜態頁（`steps = 1`），**不得讓整個播放器停擺**。

**啟動時機（本實作）**：不是啟動時就把所有頁搬一輪，而是「第一次翻到某一頁」才建立
shadow root、執行頁內腳本（`activate(slide)`）；`boot()` 只做第一輪與目前頁。
`deck.js` 每次按前進也會先 `SlideSteps.activate()`，所以「剛換到頁面、按鍵先到」不會漏掉第一步。

### 4.6 `style.css` 的唯一新增

```css
/* ── 子頁（step）通用規則 ───────────────────────────────────────────── */
.slide { --step-delay: 0.45s; }   /* 章節可覆寫，供自己的 transition 使用 */

@media (prefers-reduced-motion: reduce) {
  .slide [style*="transition"],
  .slide * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

**列印（必要，由 `anim.js` 實作，不在 CSS 強制顯示）**：
- `beforeprint`：把所有有 `SlideAnim` 的頁設為 `data-step = steps - 1`，呼叫 `enter(last, …)`，並記住原值；
- `afterprint`：還原原值。
- **不得**在 `style.css` 用 `opacity: 1 !important` 顯示所有 step（會導致 PDF 內容重疊）。

### 4.7 無障礙與效能

| 項目 | 要求 |
|---|---|
| 非目前頁 | 由 `deck.js` 設 `aria-hidden="true"` + `inert`（現有行為，不動） |
| 目前步數 | 有 step 的頁面建議提供 `[data-step-count]`，由 `anim.js` 填入 |
| 減少動態 | CSS 過渡在 `prefers-reduced-motion` 下 0.01ms；JS 動畫需 `matchMedia` 判斷並直接跳位 |
| 效能 | `activate()` 只在啟動做一次；step 切換**只改 `data-step` 與必要 class**，不重建 DOM |
| 記憶 | `dispose()` 清除 timer 與事件監聽（保存 handler 參考或 `AbortController`） |


---

## 5. 載入與初始化

### 5.1 章節檔（單獨開啟時要能播）

```html
<!-- head -->
<link rel="stylesheet" href="style.css" />

<!-- body 尾端，順序固定：deck.js 先、anim.js 後 -->
<script src="deck.js"></script>
<script src="anim.js"></script>
```

`anim.js` 載入時若 `document.getElementById("deck")` 與 `.hud` 都存在（章節檔情境），於 DOM ready 後自動 `SlideSteps.boot()`；若不存在（`index.html` 情境），等 `index.html` 明確呼叫。

### 5.2 `index.html`（合併）

```html
<script src="deck.js"></script>
<script src="anim.js"></script>
```

`mount()` 的執行順序（必要）：

```js
// 1. 把所有 .slide 搬進 #deck（importNode(slide, true) 會連同 section 內的
//    <style>、<script> 一起搬，這是「動畫寫在 .slide 內」規則的回報）
// 2. window.SlideDeck.init({ page: target.first, onChange: syncChrome })
// 3. window.SlideSteps.boot()          // ← 新增，必須在 init 之後
```

**完成條件**：用 `?chapter=1#2` 直接開啟時，第 2 頁（含動畫）立即可用、`data-step="0"`。

### 5.3 初始化順序總表

```
deck.js 載入 → anim.js 載入 → DOM ready
  → 章節檔：deck.js 自動 init() → anim.js 自動 boot()
  → index.html：fetch 章節 → 組 #deck → SlideDeck.init() → SlideSteps.boot()
```

`boot()` 必須冪等：重複呼叫只處理尚未建立 shadow root 的 `.slide`。

---

## 6. 第 1 章實作內容（`chapter1.html` 的新增分鏡頁）

在「1-1 一次多項式」那頁**之後新增一頁**（原頁保留），`eyebrow` 用 `1-1 · 分鏡`。

### 6.1 八個 step 的定義（`steps: 8`，0–7）

| step | 畫面 | 主要手段 | 教學目的 |
|---|---|---|---|
| 0 | `y = ax + b` 置中 | 公式淡入 | 一般式 |
| 1 | `y = 3x + 4` 置中，標出 `a = 3`、`b = 4` | 一般式淡出、具體式淡入 | 係數對應 |
| 2 | 座標軸 + 直線「長出來」，公式縮到右上角 | `stroke-dashoffset` 由線長 → 0 | 不是「上移」，而是從原點長出 |
| 3 | 直線上依次出現點 `(1,7)(2,10)(3,13)(5,19)` | 各點 `opacity` 0→1，間隔 0.12s | 線上點無限多 |
| 4 | 直線淡到 `opacity: 0.08`，只剩 `(1,7)` | 線 `opacity`、其餘點淡出 | 一個點 → 無限多條線 |
| 5 | 穿過 `(1,7)` 的扇形直線散開 | 每條線 `stroke-dashoffset` 進場，交錯 0.1s | 斜率任意 |
| 6 | `(4,16)` 出現，扇形線淡到 `0.12` | 第二點淡入 | 兩點定一線 |
| 7 | 原直線回到 `opacity: 1`，扇形線消失，出現結論 | 收斂 | `r` 個點 |

### 6.2 幾何資料（禁止手寫座標）

```js
var STORY = {
  slope: 3,
  intercept: 4,
  points: [1, 2, 3, 5],   // x 值；y = 3x + 4
  keepX: [1],             // step 4、5 保留的點，也是扇形交點
  secondX: 4,             // step 6 出現的第二個點
  fanLines: 9,            // 扇形線條數
};
```

座標映射（`viewBox="0 0 600 460"`）：

- x：定義域 `[0, 6]` → `px [60, 560]`
- y：值域 `[0, 24]` → `px [430, 40]`（**y 軸反向**，值大往上）
- 直線端點：x 取 `[0.3, 5.6]`，用 `y = 3x + 4` 算
- 扇形線：全部通過 `(keepX[0], 3 * keepX[0] + 4)`（即 `(1, 7)`），斜率均分 `[-3, 15]` 共 `fanLines` 條，端點裁切在繪圖區內
- 所有文字用 `root.querySelector` 建 `<text>`，顏色只靠 class

### 6.3 章節端寫法

```html
<section class="slide" aria-label="一次多項式分鏡">
  <header class="slide__head">
    <p class="eyebrow">1-1 · 分鏡</p>
    <h2 class="h2">一條直線，需要幾個點？</h2>
  </header>

  <div class="slide__body">
    <div class="stage">
      <svg class="stage__plot" viewBox="0 0 600 460" role="img" aria-label="…"></svg>
      <p class="stage__cap step-0">…</p>
      <!-- … -->
      <span class="stage__hud" data-step-count></span>
    </div>
  </div>

  <style>/* 只寫這一頁新增的 .stage__* 與 step 顯示規則 */</style>
  <script>
    window.SlideAnim = {
      steps: 8,
      init: function (root) { /* 依 STORY 產生 SVG */ },
    };
  </script>
</section>
```

### 6.4 `noscript` 與列印

- `<noscript>` 內提供 step 0（置中公式）與 step 7（完整直線＋點）的靜態畫面。
- 列印由 §4.6 的 `beforeprint` 處理（呈現 step 7）。

---

## 7. 檔案異動清單（AI 依序完成，每項都可單獨驗收）

| # | 檔案 | 動作 | 對應驗收 |
|---|---|---|---|
| 1 | `anim.js` | 新增：`SlideSteps` 全域、`activate()`、`buildController()`、`[data-step-count]`、自動播放、`beforeprint`／`afterprint` | §8-1～§8-4 |
| 2 | `deck.js` | `show()` 結尾加 `SlideSteps.onSlideChange()` 通知；`step()` 改走 `stepOrPage()`（§4.3） | §8-5 |
| 3 | `style.css` | 新增 §4.6 的 `--step-delay` 與 reduced-motion 規則（**不加** `!important` 顯示內容） | §8-6 |
| 4 | `chapter1.html` | 新增分鏡頁（含 section 內 `<style>`／`<script>`）；頁尾加 `<script src="anim.js"></script>`；`.hud__count` 初始文字改 `01 / 07` | §8-7 |
| 5 | `index.html` | 加 `<script src="anim.js"></script>`；`mount()` 內 `SlideDeck.init()` 之後呼叫 `SlideSteps.boot()` | §8-8 |
| 6 | `chapter6.html` | 頁尾加 `<script src="anim.js"></script>`（內容不動，驗證「無動畫頁」不受影響） | §8-9 |

---

## 8. 驗收清單（全數通過才可提交）

1. **靜態頁不受影響**：封面、第 2～6 頁外觀、`.rise` 進場動畫與目前一致。
2. **單獨開 `chapter1.html`**：分鏡頁按 `→` 走完 8 個 step，第 8 步（step 7）後才翻頁。
3. **歸零**：走完分鏡頁 → 翻下一頁 → 按 `←` 回到分鏡頁，`data-step` 為 `"0"`（不是 `"7"`）。
4. **合併**：開 `index.html`，CH.1 分鏡可操作、CH.6 完全不受影響；章節鈕、頁碼、`?chapter=1#3` 皆正確。
5. **`deck.js` 相容**：暫時移除 `anim.js` 的 `<script>`，整份簡報仍能正常翻頁（只是沒有 step）。
6. **列印**：`P` → 分鏡頁只出一頁，呈現 step 7 完成畫面，無文字重疊。
7. **減少動態**：系統開啟「減少動態」後，step 立即到位、內容正確。
8. **輸入法**：中文選字時按 `↓` 不觸發 step（`e.isComposing || e.keyCode === 229` 保護）；`Home`／`End`／`F`／`P` 行為不變。
9. **零錯誤**：合併與單獨開啟皆無 `console.error`／`warn`。
10. **SVG id 隔離**：在分鏡頁放一個 `id="grid6"` 的 `<pattern>`，不影響 CH.6 圖形（證明 shadow 隔離有效）。
11. **快速連按**：連續快速按 `→` 20 次，不應跳頁錯亂或卡在兩頁之間。

---

## 9. 新增章節的 SOP（給組員）

1. 複製 `chapter1.html` 當骨架，改 `<title>`、`.hud`、封面與內容。
2. 每頁一個 `<section class="slide">`。
3. 要動畫 → 在該 section 內加 `<style>` 與 `<script>`（設定 `window.SlideAnim`）。
   CSS 的顯示規則用 `:host(.slide[data-step="N"]) .xxx`（§3.1），不要用 `.slide[data-step="N"]`。
4. 頁尾保留 `<script src="deck.js"></script><script src="anim.js"></script>`。
5. 在 `index.html` 的 `CHAPTERS` 加一筆：`{ file: "chapterN.html", label: "第 N 章", short: "CH.N", name: "…" }`。
   附錄用 `appendixN.html` 命名，設定 `label: "附錄 N"`、`short: "AN"`（例如附錄 1 是
   `{ file: "appendix1.html", label: "附錄 1", short: "A1", … }`；章節鈕顯示 `short`，不會出現 `CH.N`）。
   目前：`appendix1.html`＝附錄 1 程式實作 Demo（內嵌 `code/index.html`），
   `appendix2.html`＝附錄 2 程式實作介紹。`CHAPTERS` 的 key 只決定頁碼順序（附錄放最後）。
6. **不要**改 `style.css`、`deck.js`、`anim.js`、`index.html` 的其他部分。

---

## 10. 明確不做（避免 AI 過度設計）

- 一頁內多條獨立 step 序列。
- 跨頁共用動畫狀態。
- 自動生成目錄／大綱 UI。
- 改動既有視覺（除 §4.6 的通用規則）。
- 引入框架或外部套件（純 HTML／CSS／JS，章節檔要能在 `file://` 單獨開）。
- 動 `.nojekyll`、`img/`、`code/`。
- 改寫 `deck.js` 以支援「PageUp/Down 走 step」以外的鍵位變更（Enter、Backspace 等保留原行為）。

---

## 11. 已知限制（實作時要寫進註解）

1. `:host` 版面值與 `style.css` 的 `.slide` 重複，改版面時需同步兩處。
2. **`file://` 雙擊開啟的差異（已實測）**：
   - `index.html` 一定得用本機伺服器（`fetch()` 被擋，既有問題）。
   - `chapterN.html`：Firefox 可以直接讀同目錄的 `style.css`，外觀與 http 相同；
     Chrome 會擋（CORS），有動畫的那幾頁只剩 `:host` 版面與章節自己的樣式
     （文字會變小、互相擠在一起），console 會有一個警告指出這件事。
     要保證一致就用 `python3 -m http.server`。
3. 章節作者若把 `<script>` 寫在 `.slide` 外，合併後動畫不會啟動（可在 `index.html` 加一行 `console.warn` 偵測：章節解析後若 `parsed.querySelectorAll("script").length > 0` 但沒有任何 `.slide` 內含 script，提示作者）。
4. 自動播放需頁面自備按鈕 `[data-step-nav="play"]`，否則只用手動前進（或呼叫 `SlideSteps.play()`）。
5. 列印時 `anim.js` 會把每一頁「歸零後逐步走到最後一步」（`enter` 只收到前進方向），
   不是一次跳到 `steps - 1`；`enter` 寫成「累加」風格的動畫才不會卡住。
6. 章節作者若想在啟動後更換某頁設定（例如 index 裡動態產生），用
   `window.SlideSteps.reinit(slide, { steps, init, enter })`。

---

## 附錄 A：給 AI coding 的任務提示詞（直接複製）

```text
請依 SPEC.md 實作「投影片 step 動畫系統」，專案為純 HTML/CSS/JS 的簡報：
- style.css（共用視覺）、deck.js（翻頁）、index.html（章節合併）、chapter1.html、chapter6.html。
- 目前 deck.js 只認 .slide 與 .is-active；index.html 只用 importNode 搬 .slide 與 .hud。

要求（不得偏離 SPEC.md）：
1. 新增 anim.js，實作 window.SlideSteps（boot / onSlideChange / activate / isStatic /
   canAdvance / play / stop / reinit）與每頁的 step 控制器；每頁以
   attachShadow({mode:"open"}) 隔離，注入 style.css（優先讀 CSSOM，讀不到才 <link>）
   與 :host 版面規則，再搬移原內容、重建 <script> 並執行；第一次翻到某頁才啟動。
2. deck.js：show() 結尾通知 onSlideChange；把 step() 改走 stepOrPage()，
   有 step 的頁面先換步、到底才翻頁（§4.3 有現成程式碼）。
   **不要**在 anim.js 另掛 window 的 keydown（capture 順序在瀏覽器之間不一致）。
3. style.css 只新增 --step-delay、prefers-reduced-motion 通用規則，
   以及讓 .rise 在 shadow root 內仍會顯示的最小規則。
4. chapter1.html 在「1-1 一次多項式」之後新增一頁 steps=8 的分鏡頁，
   動畫的 <style> 與 <script> 全部寫在該 <section class="slide"> 內；
   CSS 的顯示規則一律寫 :host(.slide[data-step="N"]) .xxx（見 §3.1）；
   幾何一律由 STORY = {slope:3, intercept:4, points:[1,2,3,5], focusX:2, secondX:5, fanLines:9}
   計算，禁止手寫座標。
5. index.html 在 SlideDeck.init() 之後呼叫 window.SlideSteps.boot()。
6. 每頁的 scripts/style/動畫不得寫在 .slide 之外（合併時會遺失）。
7. 顏色只用 :root 既有變數；不引入任何外部套件；保持既有鍵位。

驗收請依 SPEC.md §8 逐項自測並回報結果（含列印、減少動態、單獨開啟、合併、快速連按）。
```

## 附錄 B：快速對照表

| 我想… | 怎麼做 |
|---|---|
| 一頁要 5 步動畫 | 該 `.slide` 內加 `<script>window.SlideAnim={steps:5, init(root){…}}</script>` |
| 只要 CSS 動畫 | 不上 script（或只寫 `<script>window.SlideAnim={steps:3}</script>`），CSS 用 `:host(.slide[data-step="2"]) .xxx { … }`（**不是** `.slide[data-step="2"]`，見 §3.1） |
| 靜態頁 | 什麼都不加，`steps` 視為 1 |
| 章節合併 | `index.html` 的 `CHAPTERS` 加一筆，無需其他設定 |
| 分享給組員 | 只給 `chapterN.html` 的模板，動畫全部寫在裡面 |

