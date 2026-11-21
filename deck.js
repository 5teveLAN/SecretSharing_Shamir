/*!
 * deck.js — 簡報播放器（各章節與 index.html 共用）
 * ---------------------------------------------------------------------------
 * 章節檔：把 <script src="deck.js"></script> 放在 <main class="deck"> 與 .hud 之後，
 *         載入時會自動初始化，頁碼是「本章自己的」1–n。
 * index.html：等所有章節的 .slide 都合併進同一個 #deck 之後，再呼叫
 *         SlideDeck.init({ page: 起始頁, onChange: function (page) {} })，
 *         頁碼就是整份簡報合併後的 1–N，換頁完全不會重新載入文件。
 *
 * 舞台固定 1280×720，依視窗大小等比縮放。
 * 操作：← → ↑ ↓ / 空白鍵 / PageUp、PageDown 翻頁，Home、End 跳首尾，
 *       F 全螢幕，P 列印（存成 PDF），支援觸控滑動與 #頁碼 深層連結。
 */
(function (global) {
  var BASE_W = 1280;
  var BASE_H = 720;
  var started = false;

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function init(options) {
    if (started) return;
    started = true;

    options = options || {};

    var deck = document.getElementById("deck");
    var progressBar = document.querySelector(".hud__progress > i");
    var counter = document.querySelector(".hud__count");
    var prevBtn = document.querySelector('[data-nav="prev"]');
    var nextBtn = document.querySelector('[data-nav="next"]');
    var fullBtn = document.querySelector('[data-nav="fullscreen"]');
    if (!deck || !progressBar || !counter || !prevBtn || !nextBtn) return;

    var slides = Array.prototype.slice.call(deck.querySelectorAll(".slide"));
    var onChange = typeof options.onChange === "function" ? options.onChange : null;
    var index = 0;

    function fit() {
      var scale = Math.min(
        window.innerWidth / BASE_W,
        window.innerHeight / BASE_H
      );
      deck.style.setProperty("--deck-scale", Math.max(0.2, scale).toFixed(4));
    }

    function pageFromHash() {
      var n = parseInt(String(location.hash).replace("#", ""), 10);
      return isNaN(n) ? 1 : n;
    }

    function show(target, keepHash) {
      var next = Math.max(0, Math.min(slides.length - 1, target));
      slides.forEach(function (slide, i) {
        var active = i === next;
        slide.classList.toggle("is-active", active);
        slide.setAttribute("aria-hidden", active ? "false" : "true");
        if (active) {
          slide.removeAttribute("inert");
        } else {
          slide.setAttribute("inert", "");
        }
      });
      index = next;

      var pageNo = index + 1;
      counter.textContent = pad2(pageNo) + " / " + pad2(slides.length);
      progressBar.style.width = (pageNo / slides.length) * 100 + "%";
      prevBtn.disabled = index === 0;
      nextBtn.disabled = index === slides.length - 1;
      if (!keepHash && window.history && history.replaceState) {
        history.replaceState(null, "", "#" + pageNo);
      }
      if (onChange) onChange(pageNo);
      // 通知 step 控制器（anim.js）：新頁歸零、舊頁停止自動播放。
      // anim.js 沒載入時完全略過，deck.js 的行為與原本相同。
      if (window.SlideSteps) window.SlideSteps.onSlideChange(slides[next]);
    }

    function step(delta) {
      show(index + delta);
    }

    // 頁內 step（anim.js）：這一頁還有下一步／上一步時只換步、不翻頁。
    // 沒有 anim.js 時 window.SlideSteps 不存在，直接走原本的翻頁。
    function stepOrPage(delta) {
      if (window.SlideSteps) {
        var steps = window.SlideSteps;
        var active = slides[index];
        if (active) {
          var controller = steps.activate(active);
          if (steps.isStatic(active) === false && controller) {
            if (delta > 0 ? controller.advance() : controller.reverse()) return;
          }
        }
      }
      step(delta);
    }

    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(function () {});
        }
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }

    function onKeyDown(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      // 中文輸入法正在選字時，上下鍵屬於輸入法，不搶來翻頁
      if (e.isComposing || e.keyCode === 229) return;
      var tag = (e.target && e.target.tagName) || "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      // 焦點在按鈕或章節連結上時，讓空白鍵／Enter 維持原本的啟用行為
      if ((tag === "BUTTON" || tag === "A") && (e.key === " " || e.key === "Enter")) {
        return;
      }

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "Down":
        case "PageDown":
        case " ":
        case "Enter":
          e.preventDefault();
          stepOrPage(1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "Up":
        case "PageUp":
        case "Backspace":
          e.preventDefault();
          stepOrPage(-1);
          break;
        case "Home":
          e.preventDefault();
          show(0);
          break;
        case "End":
          e.preventDefault();
          show(slides.length - 1);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "p":
        case "P":
          window.print();
          break;
        default:
          break;
      }
    }

    // 用 capture 掛在 window：不論焦點在哪個元素、或頁面上其他 script 先攔截事件，
    // 上下／左右鍵都還是直接翻到下一張、上一張。
    window.addEventListener("keydown", onKeyDown, true);

    prevBtn.addEventListener("click", function () {
      stepOrPage(-1);
    });

    nextBtn.addEventListener("click", function () {
      stepOrPage(1);
    });

    if (fullBtn) fullBtn.addEventListener("click", toggleFullscreen);

    var touchX = null;
    var touchY = null;

    document.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length !== 1) return;
        touchX = e.touches[0].clientX;
        touchY = e.touches[0].clientY;
      },
      { passive: true }
    );

    document.addEventListener(
      "touchend",
      function (e) {
        if (touchX === null || !e.changedTouches.length) return;
        var dx = e.changedTouches[0].clientX - touchX;
        var dy = e.changedTouches[0].clientY - touchY;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
          stepOrPage(dx < 0 ? 1 : -1);
        }
        touchX = null;
        touchY = null;
      },
      { passive: true }
    );

    window.addEventListener("resize", fit);
    window.addEventListener("hashchange", function () {
      show(pageFromHash() - 1, true);
    });

    fit();
    // 起始頁：#頁碼 優先，其次 options.page（index 依章節順序算出來的頁碼）
    show((location.hash ? pageFromHash() : options.page || 1) - 1);
  }

  global.SlideDeck = { init: init };

  // 章節檔：deck.js 放在 .deck 之後，載入時就直接初始化
  if (document.getElementById("deck") && document.querySelector(".hud")) {
    init();
  }
})(window);
