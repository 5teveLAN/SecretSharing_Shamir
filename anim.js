/*!
 * anim.js — 投影片的「頁內 step（子頁）」播放器（各章節與 index.html 共用）
 * ---------------------------------------------------------------------------
 * 分工：deck.js 只認 .slide 與 .is-active，負責「翻頁」；這裡負責「同一頁往前／
 *      往後走幾步」。沒載入 anim.js 時，deck.js 的行為與原本完全相同。
 *
 * 一頁有幾步、每步長什麼樣，都由章節作者寫在「那一頁的 <section class="slide"> 內」：
 *
 *   <section class="slide">
 *     …內容…
 *     <style> .slide[data-step="2"] .xxx { … } </style>
 *     <script>
 *       window.SlideAnim = {
 *         steps: 8,                                  // 總步數（含第 0 步）
 *         init: function (root) { … },               // 只需建一次的東西
 *         enter: function (step, prev, root) { … },  // 每次換步時呼叫
 *       };
 *     </script>
 *   </section>
 *
 * 寫在 .slide 之外會被丟棄：index.html 用 importNode(slide, true) 搬投影片，
 * 只會連同 section 的子節點一起搬；<head> 或 </main> 之後的 <style>、<script> 收不到。
 *
 * 隔離：每一頁第一次用到時，才把內容搬進 attachShadow({ mode: "open" })，
 *      讓各頁自己的 <style>、<script>、SVG id 互不干擾。deck.js 只看 host 的
 *      .is-active，所以不影響翻頁。步驟：
 *        1. 複製一份 style.css（一般選擇器穿不過 shadow boundary；不帶進來 .h2、
 *           .callout 這類共用樣式會全部失效），同時移除只屬於文件層的規則。
 *        2. 補 :host 與 .rise 的規則（.rise 的進場原本綁在 .slide.is-active 上，
 *           搬進 shadow 之後要改看宿主元素）。
 *        3. 搬移原本的子節點，再重建 <script> 讓它執行（搬過去的 script 不會自動跑）。
 *
 * 按鍵：由 deck.js 統一處理（它換頁／換步前會問這一頁還有沒有下一步）。
 *      章節檔與 index.html 的載入順序固定：deck.js 先、anim.js 後。
 */
(function (global) {
  "use strict";

  var DEFAULT_AUTO_DELAY = 1200; // window.SlideAnim 沒給 autoDelay 時的預設
  var SWIPE_MIN = 48; // 頁內滑動的位移門檻（px），與 deck.js 的翻頁門檻一致
  var LOG = "[anim.js] "; // 頁內腳本的錯誤／警告都加這個前綴，方便分辨來源

  var current = null; // 目前這頁的控制器
  var printing = false; // 列印期間不跑頁內腳本，直接呈現最後一步

  /* ===========================================================================
     內建的 :host 規則
     ===========================================================================
     style.css 的 .slide 版面、.rise 進場與 .flow__stream 動畫都是「文件層」選擇器，
     進到 shadow root 之後看不到裡面的元素，所以用 :host() 以宿主元素（= .slide）
     的狀態補回：
       1. 版面值與 style.css 的 .slide 相同，改版面時兩邊要一起改。
       2. .rise 取補償後的 --step-k：補償值在 shadow 內以極高權重宣告，
          style.css 的「.slide.is-active .rise:nth-child(1..5) { transition-delay }」
          蓋不掉它，進場動畫才不會被頁內 step 一起拖慢。
       3. 列印時（主樣式表自己也有 @media print 區塊）一樣把這幾條套回：
          :host 的 specificity 高於文件層的 .slide，不這樣做列印會掉版。 */

  /* 實作與設計規格（slides_SPEC.md）的差異，寫給之後維護的人：
     1. 改用「延遲啟動」：第一次翻到某一頁才建立 shadow root、執行頁內腳本。
        index.html 一次合併很多章，啟動時不必把所有頁搬一輪。
     2. 按鍵只留在 deck.js（stepOrPage）：它換頁／換步前會問這一頁還有沒有
        下一步，所以不必兩支腳本搶 window 的 keydown（capture 的順序在不同
        瀏覽器不一定照註冊順序，實測 Chrome 就相反）。
     3. 純 CSS 的 step 用 :host(.slide[data-step="n"])：shadow root 內的
        「.slide[data-step]」只看得到內層元素，不是自己所在的 section。
     4. style.css 用 CSSOM 讀進來再逐條挑（@media 裡面的規則照留），
        取不到才退回 <link> + 內建規則；file:// 需要瀏覽器允許讀同目錄檔案
        （Firefox 預設可以，Chrome 要 --allow-file-access-from-files），
        否則該頁只有 :host 與章節自己的樣式。 */

  var HOST_CSS =
    ":host{--s2:var(--step-shift,0s);--step-k:calc(var(--step-delay,0.45s) + var(--s2));" +
    "position:static;inset:auto;display:grid;grid-template-rows:auto 1fr;" +
    "gap:var(--gap-row);padding:var(--pad-y) var(--pad-x);color:var(--ink-900);" +
    "background-color:var(--paper);" +
    "background-image:radial-gradient(rgba(47,87,214,.1) 1px,transparent 1px);" +
    "background-size:28px 28px;background-position:14px 14px;" +
    "opacity:1;visibility:visible;transform:none;transition:none}\n" +
    ":host(.slide:not(.is-active)){opacity:0;visibility:hidden;" +
    "transform:translateY(14px) scale(0.995);" +
    "transition:opacity 0.45s ease,transform 0.45s ease,visibility 0.45s linear}\n" +
    ".rise{--step-k:calc(var(--step-delay,0.45s) + var(--s2)) !important}\n" +
    ":host(.slide.is-active) .rise{opacity:1;transform:none}\n" +
    ":host(.slide:not(.is-active)) .rise{opacity:0;transform:translateY(16px);" +
    "transition:none !important}\n" +
    ":host(.slide.is-active) .flow__stream{animation:flow-dash 1.8s linear infinite}\n";

  var PRINT_CSS =
    "@media print{" +
    ":host{--s2:0s}" +
    ":host{width:1280px;height:720px;opacity:1 !important;" +
    "visibility:visible !important;transform:none !important;break-after:page}" +
    ".rise{opacity:1 !important;transform:none !important}" +
    ":host(.slide:not(.is-active)){break-after:auto !important}" +
    "}\n";

  function warn(message) {
    if (global.console && console.warn) console.warn(LOG + message);
  }

  function reduceMotion() {
    return !!(global.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* ===========================================================================
     style.css 的 shadow root 版本
     ===========================================================================
     來源是 <link rel="stylesheet" href="style.css"> 的實際內容（file:// 也能讀：
     CSS 規則不受跨來源限制）。只留下「看得到內容」的規則：文件層外框
     （html / body / .deck / .slide / .hud / 列印 / :root）一律不要，
     :host 也由自己的規則負責，避免與頁面或章節的樣式互相蓋台。 */

  var DROP_RULE = /^(?:html\b|body\b|\.deck\b|\.slide\b|\.hud\b|@page\b|:root\b|:host\b)/i;
  // @media 裡面的規則：.slide.is-active .rise 這種仍要帶進 shadow root（文件層的
  // 「>.slide」在 :host 的自我參照下剛好對應到宿主元素），只去掉外框
  var DROP_INNER = /^(?:html\b|body\b|\.deck\b|\.hud\b|@page\b|:root\b|:host\b)/i;

  /* 沒有 CSSOM（極少數環境）時的備援：以字串掃出每條規則，套用同一套過濾。
     @media 區塊裡面的規則也會被過濾，只剩留下來的區塊會重新包回 @media。 */
  function scanCss(text) {
    var stack = [];
    var buf = "";
    var quote = null;
    var out = "";

    function append(piece) {
      if (stack.length) stack[stack.length - 1].body += piece;
      else out += piece;
    }

    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);

      if (quote) {
        append(ch);
        if (ch === "\\" && i + 1 < text.length) append(text.charAt(++i));
        else if (ch === quote) quote = null;
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        append(ch);
      } else if (ch === "/" && text.charAt(i + 1) === "*") {
        var end = text.indexOf("*/", i + 2);
        i = end < 0 ? text.length : end + 1;
      } else if (ch === "\\") {
        append(ch);
        if (i + 1 < text.length) append(text.charAt(++i));
      } else if (ch === "{") {
        var parent = stack[stack.length - 1];
        var head = buf.trim();
        buf = "";
        var outer = parent && parent.dropped; // 外層是否已被整個丟掉
        stack.push({
          head: head,
          body: "",
          // 文件層規則只在最上層擋掉；@media 裡面的規則照留（.deck 這類再個別處理）
          dropped: outer || (!parent && DROP_RULE.test(head)),
          dropInner: outer || DROP_INNER.test(head),
        });
      } else if (ch === "}") {
        var frame = stack.pop();
        if (!frame) continue;
        if (!frame.dropped && !frame.dropInner) {
          var piece = frame.head + "{" + frame.body + "}";
          if (stack.length) stack[stack.length - 1].body += piece;
          else out += piece;
        }
        buf = "";
      } else {
        buf += ch;
      }
    }

    return out;
  }

  function sanitizeCss(text) {
    var sheet = null;
    var out = "";
    try {
      sheet = new CSSStyleSheet(); // 交給瀏覽器解析語法
      sheet.replaceSync(text);
    } catch (error) {
      sheet = null;
    }
    if (!sheet) return scanCss(text);

    function selectorOf(rule) {
      return rule.selectorText === undefined ? "" : rule.selectorText.trim();
    }

    function visit(rules, depth) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (rule.selectorText !== undefined) {
          // 最上層只保留「看得到內容」的規則；@media 裡面的規則照留
          // （.deck／.hud 這種外框在 shadow root 內也選不到東西，留著無害）
          var drop = depth ? DROP_INNER : DROP_RULE;
          if (!drop.test(selectorOf(rule))) out += rule.cssText + "\n";
        } else if (rule.cssRules && rule.media) {
          var before = out.length;
          visit(rule.cssRules, depth + 1);
          var inner = out.slice(before);
          out = out.slice(0, before);
          if (inner) out += "@media " + rule.conditionText + "{\n" + inner + "}\n";
        } else if (rule.cssRules) {
          visit(rule.cssRules, depth + 1); // 其他 at-rule（@supports …）直接攤平
        } else {
          out += rule.cssText + "\n";
        }
      }
    }

    visit(sheet.cssRules, 0);
    return out;
  }

  /* style.css 只讀一次：所有頁共用同一份字串 */
  var shared = { text: "", state: "idle", waiting: [] };
  var warnedNoStyle = false; // 讀不到 style.css 只提醒一次，不洗版

  function styleHref() {
    var link = document.querySelector('link[rel~="stylesheet"][href*="style.css"]');
    return link ? link.href : "";
  }

  function settleStyle(text) {
    shared.text = text || "";
    shared.state = "ready";
    var waiting = shared.waiting;
    shared.waiting = [];
    for (var i = 0; i < waiting.length; i++) waiting[i](shared.text);
  }

  // 優先用已經載入的樣式表（CSSOM）；讀不到就去找 style.css 的原始文字：
  // file:// 不能用 fetch（會出現 console 錯誤），XHR 可以；<link> 是跨來源時則改抓
  // index.html 的內容（每次部署都是 index 與 style.css 一起更新）。
  function requestStyle(done) {
    var href = styleHref();
    if (shared.state === "ready" || !href) {
      done(shared.text);
      return;
    }
    if (shared.state === "loading") {
      shared.waiting.push(done);
      return;
    }
    shared.state = "loading";
    shared.waiting.push(done);

    var link = document.querySelector('link[rel~="stylesheet"][href*="style.css"]');
    var text = "";
    try {
      var sheet = link && link.sheet;
      if (sheet && sheet.cssRules) {
        for (var i = 0; i < sheet.cssRules.length; i++) text += sheet.cssRules[i].cssText + "\n";
      }
    } catch (error) {
      text = ""; // 跨來源的樣式表讀不到，改用下面的備援
    }
    if (text) {
      settleStyle(sanitizeCss(text));
      return;
    }

    var finish = function (body) {
      if (body) {
        settleStyle(sanitizeCss(body));
        return;
      }
      if (warnedNoStyle) return;
      warnedNoStyle = true;
      warn(
        "讀不到 style.css 的內容（file:// 下瀏覽器可能禁止讀同目錄檔案），" +
          "有動畫的那幾頁只剩 :host 與章節自己的樣式；用本機伺服器開啟即可正常。"
      );
      settleStyle("");
    };

    var read = function (url, onText) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.onload = function () {
        onText(xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300) ? xhr.responseText : "");
      };
      xhr.onerror = function () {
        onText("");
      };
      xhr.send();
    };

    read(href, function (body) {
      if (body) {
        finish(body);
        return;
      }
      // 跨來源（例如原本用 <link> 從 CDN 載入）：改讀 index.html，取出內嵌的 style.css
      if (!/(^|:)\/\/[^/]*index\.html/.test(location.href)) {
        finish("");
        return;
      }
      read("index.html", function (html) {
        var start = html.search(/<style[^>]*data-source="style\.css"[^>]*>/i);
        if (start < 0) {
          finish("");
          return;
        }
        start = html.indexOf(">", start) + 1;
        var end = html.toLowerCase().indexOf("</style>", start);
        finish(end < 0 ? "" : html.slice(start, end));
      });
    });
  }

  /* 把 style.css 與自己的規則放進 shadow root。
     注入的 <style> 是 shadow root 的第一個子節點：章節自己的 <style>／<link> 排在後面，
     同 specificity 時仍然是章節的贏；而 :host 規則不受影響（文件層規則蓋不到 channel）。 */
  function injectStyles(root) {
    var style = document.createElement("style");
    style.setAttribute("data-slide-steps", "base");
    root.appendChild(style);
    requestStyle(function (text) {
      style.textContent = (text ? text + "\n" : "") + HOST_CSS + PRINT_CSS;
    });
  }

  /* ===========================================================================
     啟動：掃描 .slide、建立 shadow root、設定控制器
     =========================================================================== */

  // 第一次用到這一頁才搬內容（index 可能合併很多章，不必在啟動時全部搬）
  function prepare(slide) {
    if (slide.__animState !== undefined) return slide.__animState;
    if (!slide.attachShadow || slide.shadowRoot) {
      slide.__animState = null; // 不支援 shadow DOM：直接在文件層跑（外觀不會壞）
      return null;
    }
    var root = slide.attachShadow({ mode: "open" });
    injectStyles(root);
    while (slide.firstChild) root.appendChild(slide.firstChild);
    slide.__animState = { slide: slide, root: root };
    return slide.__animState;
  }

  // 搬進 shadow root 的 <script> 不會自動執行，要重建一次（複製屬性與內容）
  function runScripts(root) {
    var scripts = root.querySelectorAll("script");
    for (var i = 0; i < scripts.length; i++) {
      var source = scripts[i];
      var copy = document.createElement("script");
      for (var a = 0; a < source.attributes.length; a++) {
        copy.setAttribute(source.attributes[a].name, source.attributes[a].value);
      }
      copy.textContent = source.textContent;
      source.parentNode.replaceChild(copy, source);
    }
  }

  // 讀 window.SlideAnim；讀完立刻刪掉，避免下一頁誤用上一頁的設定。
  // dead = true 代表這一頁沒有自己的動畫（靜態頁）：沒有 step，按一下前進就翻頁。
  function readConfig(host) {
    var raw = global.SlideAnim || null;
    if (raw) delete global.SlideAnim;
    var steps = raw ? Number(raw.steps) : 1;
    if (!isFinite(steps) || steps < 1) steps = 1;
    return { source: raw, steps: Math.floor(steps), dead: !raw };
  }

  function setStep(host, step) {
    var value = String(step);
    if (host.getAttribute("data-step") !== value) host.setAttribute("data-step", value);
  }

  function activate(slide) {
    if (slide.__anim) return slide.__anim;
    var state = prepare(slide);
    if (state) runScripts(state.root);
    slide.__anim = buildController(slide, state);
    return slide.__anim;
  }

  /* ===========================================================================
     每個控制器：step 狀態機
     =========================================================================== */

  function buildController(host, state) {
    var root = state ? state.root : host;
    var scope = { config: null, step: 0, prev: 0, stack: [], timer: null };

    function dispose() {
      stopAuto();
      while (scope.stack.length) {
        var fn = scope.stack.pop();
        try {
          if (typeof fn === "function") fn();
        } catch (error) {
          warn("dispose 失敗：" + error.message);
        }
      }
      if (scope.config) scope.config.dead = true;
    }

    function stopAuto() {
      if (!scope.timer) return;
      clearInterval(scope.timer);
      scope.timer = null;
      host.removeAttribute("data-playing");
      var play = root.querySelector('[data-step-nav="play"]');
      if (play) play.setAttribute("aria-pressed", "false");
    }

    function runInit() {
      var config = scope.config;
      if (!config || config.dead || config.steps < 2) return;
      try {
        var ret = typeof config.source.init === "function" ? config.source.init(root, host) : null;
        if (ret && typeof ret.dispose === "function") scope.stack.push(ret.dispose);
      } catch (error) {
        console.error(LOG + "這一頁的 init 失敗，退化為靜態頁。", error);
        config.dead = true;
        stopAuto();
      }
    }

    function syncCounts() {
      var config = scope.config;
      if (!config || config.steps < 2) return;
      var text = scope.step + 1 + " / " + config.steps;
      var list = root.querySelectorAll("[data-step-count]");
      for (var i = 0; i < list.length; i++) {
        if (list[i].textContent !== text) list[i].textContent = text;
      }
    }

    function enter(step) {
      var config = scope.config;
      var prev = scope.prev;
      scope.prev = scope.step;
      scope.step = step;
      setStep(host, step);
      syncCounts();
      if (!config || config.dead || config.steps < 2 || printing) return;
      var fn = config.source.enter;
      if (typeof fn !== "function") return;
      try {
        fn.call(config.source, step, prev, root);
      } catch (error) {
        console.error(LOG + "這一頁的 enter 失敗，這一頁不再有 step。", error);
        config.dead = true;
        stopAuto();
      }
    }

    var api = {
      slide: host,
      state: state,
      independent: !state, // true：沒有 shadow root，章節要自己處理全域樣式
      config: null, // 目前這一頁的設定物件（SlideSteps.isStatic 會看 .dead）
      static: function () {
        return !scope.config || scope.config.dead;
      },
      steps: function () {
        return scope.config ? scope.config.steps : 1;
      },
      index: function () {
        return scope.step;
      },
      enter: enter,
      syncCounts: syncCounts,
      canAdvance: function () {
        return !api.static() && api.steps() > 1 && scope.step < api.steps() - 1;
      },
      canReverse: function () {
        return !api.static() && api.steps() > 1 && scope.step > 0;
      },
      // 回傳 true = 這一步已由頁內處理；false = 沒步數了，交回 deck.js 翻頁
      advance: function () {
        if (!api.canAdvance()) return false;
        enter(scope.step + 1);
        return true;
      },
      reverse: function () {
        if (!api.canReverse()) return false;
        enter(scope.step - 1);
        return true;
      },
      stopAuto: stopAuto,
      play: function () {
        var config = scope.config;
        if (!config || config.dead || config.steps < 2 || api.index() >= config.steps - 1) return;
        stopAuto();
        var delay = Number(config.source.autoDelay);
        if (!(delay > 0)) delay = DEFAULT_AUTO_DELAY;
        var play = root.querySelector('[data-step-nav="play"]');
        if (play) play.setAttribute("aria-pressed", "true");
        host.setAttribute("data-playing", "");
        scope.timer = setInterval(function () {
          if (!api.advance()) stopAuto(); // 走到最後一步就停，不自動翻頁
        }, delay);
      },
      playing: function () {
        return !!scope.timer;
      },
      // 重新讀取設定：可傳入新的設定物件（沒傳就重讀 window.SlideAnim）
      reinit: function (incoming) {
        dispose();
        if (incoming) global.SlideAnim = incoming;
        scope.config = readConfig(host);
        api.config = scope.config;
        scope.prev = 0;
        runInit();
        enter(0);
      },
      dispose: dispose,
    };

    scope.config = readConfig(host);
    api.config = scope.config; // 給 SlideSteps.isStatic()／除錯用
    setStep(host, 0);
    runInit();
    syncCounts();
    bindPlay(root, api);
    bindSwipe(root, api);
    return api;
  }

  function bindPlay(root, api) {
    var play = root.querySelector('[data-step-nav="play"]');
    if (!play || play.__slideStepsBound) return;
    play.__slideStepsBound = true;
    play.setAttribute("aria-pressed", "false");
    play.addEventListener("click", function () {
      if (api.playing()) api.stopAuto();
      else api.play();
    });
  }

  // 頁內左右滑動：只在「這一頁還有步數」時接手那一筆，其餘照常交給 deck.js 翻頁
  // （deck.js 的 touchend 是 document 上的非 capture listener，window 的 bubble 先跑；
  //   但 deck.js 改用 stepOrPage 之後，這裡其實只是備援，不是必要路徑）
  function bindSwipe(root, api) {
    var startX = null;
    var startY = null;

    root.addEventListener(
      "touchstart",
      function (e) {
        startX = e.touches.length === 1 ? e.touches[0].clientX : null;
        startY = e.touches.length === 1 ? e.touches[0].clientY : null;
      },
      { passive: true }
    );

    root.addEventListener(
      "touchend",
      function (e) {
        if (startX === null || !e.changedTouches.length) return;
        var dx = e.changedTouches[0].clientX - startX;
        var dy = e.changedTouches[0].clientY - startY;
        startX = null;
        startY = null;
        if (Math.abs(dx) <= SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return;
        if (dx < 0 ? api.advance() : api.reverse()) e.stopPropagation();
      },
      { passive: true }
    );
  }

  /* ===========================================================================
     列印：先把每一頁推進到最後一步（完整內容），列印完再還原
     =========================================================================== */

  var activeBeforePrint = null;
  // 只有已經啟動（有控制器）的頁面才需要換步；靜態頁直接呈現。
  // 換步一律「先歸零再走到最後一步」：enter 只給「前進」方向，
  // 章節寫成 step >= n 的顯示規則也不會因為從中間跳過去而卡住。
  function seedPrintStates() {
    var slides = document.querySelectorAll(".slide");
    for (var i = 0; i < slides.length; i++) {
      var controller = slides[i].__anim;
      if (!controller) continue;
      controller.stopAuto();
      controller.enter(0);
      for (var s = 1; s < controller.steps(); s++) controller.enter(s);
    }
  }

  function setShift(on) {
    var slides = document.querySelectorAll(".slide");
    for (var i = 0; i < slides.length; i++) {
      if (on) slides[i].style.setProperty("--step-shift", "10s");
      else slides[i].style.removeProperty("--step-shift");
    }
  }

  function beforePrint() {
    if (printing) return;
    printing = true;
    // .rise 的 transition-delay 加上極大的補償值 → 螢幕上等於沒有延遲；
    // 列印輸出取的是已套用的樣式，.rise 就不會停在 opacity:0 漏印。
    setShift(true);
    activeBeforePrint = document.querySelector(".slide.is-active");
    seedPrintStates();
  }

  function afterPrint() {
    if (!printing) return;
    printing = false;
    setShift(false);
    // 以「目前作用中的頁」為準還原（列印不是由 P 鍵觸發時，deck.js 也會同步活動頁）
    var active = document.querySelector(".slide.is-active") || activeBeforePrint;
    activeBeforePrint = null;
    if (active && active.__anim) onSlideChange(active);
  }

  /* ===========================================================================
     對外介面：window.SlideSteps
     =========================================================================== */

  function onSlideChange(slide) {
    var controller = null;
    if (slide) {
      discardPendingConfig();
      if (current && current.slide !== slide) current.stopAuto();
      controller = activate(slide);
      if (controller) {
        controller.slide.removeAttribute("aria-hidden"); // 移除：讓 shadow 內的螢幕閱讀器也能讀
        controller.stopAuto();
        controller.enter(0); // 翻到這一頁（或重新啟用）一律回到第 0 步
      }
    } else if (current) {
      current.stopAuto();
    }
    current = controller; // 沒有 deck.js 時不會被翻頁通知，這裡就是唯一的「目前頁」
    return controller;
  }

  function canAdvance(slide) {
    var target = slide || current;
    return !!target && !!target.__anim && target.__anim.canAdvance();
  }

  function isStatic(slide) {
    var target = slide || current;
    if (!target) return true;
    // 還沒建立控制器（例如 index 剛合併、anim.js 根本沒載入）：一律當靜態頁，
    // deck.js 照舊翻頁；有控制器之後由它判斷（讀完 window.SlideAnim 的結果）
    if (!target.__anim) return true;
    return target.__anim.static();
  }

  // 備援掛勾：deck.js 目前不會呼叫（頁內 step 由 deck.js 的 stepOrPage 負責）。
  // 保留介面，讓未來若要「anim.js 先處理鍵盤」時不必改 deck.js 的其他部分。
  function handlesKey() {
    return false;
  }

  function boot() {
    var slides = document.querySelectorAll(".slide");
    var active = document.querySelector(".slide.is-active");
    for (var i = 0; i < slides.length; i++) {
      if (slides[i] !== active) activate(slides[i]);
    }
    // 依序啟動時，每頁的 init 都會執行一次；最後執行的是「目前頁」的那支腳本，
    // 所以 window.SlideAnim 的內容也必須是「目前頁」的。從目前頁開始跑，
    // 殘留的設定才不會被別的頁（例如先啟動的封面）讀走。
    if (active) onSlideChange(active);
    for (var j = 0; j < slides.length; j++) {
      if (slides[j] !== active) activate(slides[j]);
    }
  }

  // deck.js 換頁後的通知：先把殘留的 window.SlideAnim 清掉。
  // 沒有這段的話，最後一次「啟動頁面」留在全域的設定會被下一頁的 activate 讀走，
  // 讓沒有動畫的頁面（封面…）變成有 step 的頁，第一下前進只換步、不翻頁。
  function discardPendingConfig() {
    if (global.SlideAnim) delete global.SlideAnim;
  }

  global.SlideSteps = {
    boot: boot, // 掃描並啟動所有尚未處理的 .slide（可重複呼叫）
    onSlideChange: onSlideChange, // deck.js 換頁後通知；回傳這一頁的控制器（或 null）
    canAdvance: canAdvance, // 這一頁還有下一步？
    isStatic: isStatic, // 這一頁沒有動畫（沒有 window.SlideAnim）？
    // 確保這一頁已經啟動（第一次用到才搬進 shadow root、執行頁內腳本）；
    // deck.js 按下前進時呼叫，避免「剛換到這一頁、按鍵先到」時漏掉第一次的 step。
    activate: function (slide) {
      if (!slide || slide.__anim || slide.__animState === null) return slide ? slide.__anim || null : null;
      return activate(slide);
    },
    handlesKey: handlesKey,
    play: function (slide) {
      var controller = slide ? slide.__anim : current;
      if (controller) controller.play();
    },
    stop: function () {
      if (current) current.stopAuto();
    },
    // 章節作者要在啟動後換掉這一頁的設定時：window.SlideSteps.reinit()、
    // 或 window.SlideSteps.reinit(slide, { steps, init, enter })
    reinit: function (slide, config) {
      var target = slide || document.querySelector(".slide.is-active");
      if (!target) return null;
      var controller = target.__anim || activate(target);
      if (controller) controller.reinit(config || null);
      return controller;
    },
  };

  // 鍵盤不需要 anim.js 處理：deck.js 的 stepOrPage 已經會先問這一頁有沒有下一步，
  // 所以 deck.js 可以是唯一處理按鍵的地方（Home／End／F／P 與輸入法保護都留在原處）。
  if ("onbeforeprint" in window && "onafterprint" in window) {
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
  } else if (global.matchMedia) {
    // 沒有 beforeprint 事件（例如某些 Safari）：用 media query 偵測列印
    var media = matchMedia("print");
    var onPrintMedia = function (e) {
      if (e.matches) beforePrint();
      else if (printing) afterPrint();
    };
    if (media.addEventListener) media.addEventListener("change", onPrintMedia);
    else if (media.addListener) media.addListener(onPrintMedia);
  }

  // 章節檔（有 #deck 與 .hud）：等 DOM 就緒後自動開始；index.html 自己呼叫 boot()
  function autoStart() {
    if (document.getElementById("deck") && document.querySelector(".hud")) boot();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoStart);
  } else {
    autoStart();
  }
})(window);


