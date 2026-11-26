/*!
 * embed.js — 把「實作 Demo」（code/index.html）嵌進簡報裡
 * ---------------------------------------------------------------------------
 * 簡報本身只負責排版，Demo 仍是 code/ 底下那一份真的程式：
 * 直接 <iframe> 載入 code/index.html，不複製任何一行程式碼。
 *
 * 用法：
 *   <iframe class="embed-frame" data-embed src="code/index.html" title="…"></iframe>
 *
 * 載入後會處理三件事：
 *   1. 把 iframe 縮到 1280×720 的版面再等比放到容器大小，內容才不會被裁掉。
 *   2. 把 iframe 內部的按鍵交給簡報：只有「在 iframe 裡打字」時才由 iframe 自己處理，
 *      其餘（← → ↓ ↑ / 空白 / Home / End / F / P）一律轉給簡報翻頁，
 *      滑到 Demo 上按 → 不會卡住。簡報沒載入 deck.js 時（單獨開章節頁之外的場合）就不攔。
 *   3. 頁面一載入就通知 code/index.html 的 Demo 跑「快速測試」按鈕，
 *      觀眾不用先自己畫一張圖；之後要換圖仍可照常操作。
 *
 * 注意：
 *   - 優先用 ?embed 讓 Demo 換成精簡標題（code/index.html 有支援）。
 *   - Demo 是 ES Module，file:// 直接雙擊會被瀏覽器擋（CORS），
 *     要搭配本機伺服器（python3 -m http.server）或 GitHub Pages。
 */
(function () {
  "use strict";

  var BASE_W = 1280;
  var BASE_H = 720;
  // 這些鍵在 iframe 裡打字時可能要用到，不能搶走
  var PASS_KEYS = { Tab: 1, Escape: 1, Backspace: 1 };

  function frames() {
    return Array.prototype.slice.call(document.querySelectorAll("iframe[data-embed]"));
  }

  // 依容器尺寸把 1280×720 的畫面等比縮放（不足 1 倍時不放大，避免模糊）
  function fit(frame) {
    var win = frame.contentWindow;
    var doc = frame.contentDocument;
    if (!win || !doc || !doc.documentElement) return;
    var scale = Math.min(frame.clientWidth / BASE_W, frame.clientHeight / BASE_H);
    if (!(scale > 0)) return;
    var root = doc.documentElement;
    root.style.width = BASE_W + "px";
    root.style.height = BASE_H + "px";
    root.style.transformOrigin = "0 0";
    root.style.transform = "scale(" + scale + ")";
  }

  // 在 iframe 裡「看起來像在操作簡報」的按鍵 → 交給外面的簡報處理
  function relayKey(event) {
    var key = event.key;
    var isNav =
      key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown" ||
      key === "Up" || key === "Down" || key === "PageUp" || key === "PageDown" ||
      key === "Home" || key === "End" || key === "f" || key === "F" || key === "p" || key === "P";
    if (key === " " || key === "Enter") isNav = true;
    if (!isNav || PASS_KEYS[key]) return;
    if (key === "Enter" && event.target && event.target.tagName === "BUTTON") return;
    if (window.event === event) return; // 已經是從最外層文件來的，不再轉第二次
    event.preventDefault();
    event.stopPropagation();
    window.document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: key,
        code: event.code,
        keyCode: event.keyCode,
        which: event.which,
        bubbles: false,
        cancelable: true,
      })
    );
  }

  function wire(frame) {
    if (frame.__embedWired) return;
    frame.__embedWired = true;

    frame.addEventListener("load", function () {
      var doc = frame.contentDocument;
      var win = frame.contentWindow;
      if (!doc || !win) return;

      fit(frame);
      if (typeof win.ResizeObserver === "function") {
        new win.ResizeObserver(function () {
          fit(frame);
        }).observe(doc.body);
      }

      // 簡報有 deck.js（＝有翻頁）時，才把導覽鍵轉出去
      if (window.SlideDeck && doc.addEventListener) {
        doc.addEventListener("keydown", relayKey, true);
      }

      // 讓 Demo 一起步就有東西看：直接按它的「彩色漸層圖」測試按鈕
      var sample = doc.querySelector("#sss-btn-sample-gradient");
      if (sample) sample.click();
    });
  }

  function boot() {
    frames().forEach(wire);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
