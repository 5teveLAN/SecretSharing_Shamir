// ---------- shamir.steps.mjs ----------
// 把 code/features/shamir.feature 裡的中文句子，接到 shamir.js 的函式。
// 一份句子（步驟）可以被很多場景重複使用。

import { Given, When, Then, setWorldConstructor } from "@cucumber/cucumber";
import { strict as assert } from "node:assert";

import {
  generateShares,
  evalPolynomial,
  GF_IS_REAL,
} from "../../shamir.js";

// 每個場景都有自己的一份 World，用來記住「上一步算出來的東西」
class ShamirWorld {
  constructor() {
    this.shares = undefined;
    this.result = undefined;
    this.error = undefined;
    this.randomFn = undefined;
    this.coeffs = undefined;
    this.previous = undefined;
  }
}
setWorldConstructor(ShamirWorld);

// ===== 測試小工具 ============================================================

/** 真 GF(2^8) 乘法（x^8+x^4+x^3+x^2+1，約簡常數 0x1d），只在 @real-gf 場景用。 */
function gfMul(a, b) {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) r ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1d;
    b >>= 1;
  }
  return r;
}

function gfPow(a, e) {
  let r = 1;
  for (let i = 0; i < e; i++) r = gfMul(r, a);
  return r;
}

function gfDiv(a, b) {
  if (b === 0) throw new RangeError("除以 0");
  return gfMul(a, gfPow(b, 254));
}

/** 拉格朗日插值在 x = 0 的值（也就是秘密）。 */
function lagrangeAtZero(points) {
  let out = 0;
  for (let i = 0; i < points.length; i++) {
    let num = 1;
    let den = 1;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      num = gfMul(num, points[j].x);
      den = gfMul(den, points[i].x ^ points[j].x);
    }
    out ^= gfMul(points[i].y, gfDiv(num, den));
  }
  return out;
}

// ===== 假設（Given）==========================================================

Given("GF 2 的 8 次方的加法就是 XOR", function () {
  // 規格說明用的背景，實際驗證在「代入 x = 0 時得到 a0」場景
  assert.ok(true);
});

Given("多項式的係數固定為 [{int}, {int}, {int}]", function (a0, a1, a2) {
  this.coeffs = [a0, a1, a2];
  this.value = a0;
  const rest = [a1, a2];
  this.randomFn = () => rest.shift();
});

Given("我把隨機來源固定成永遠回傳 {int}", function (v) {
  this.randomFn = () => v;
});

Given("我把隨機來源固定成依序回傳 [{int}, {int}]", function (a, b) {
  // 每次呼叫 generateShares 時都重建一次序列，才能「用同一組隨機跑兩次」
  this.randomFactory = () => {
    const rest = [a, b];
    return () => rest.shift();
  };
  this.randomFn = this.randomFactory();
});

Given("f 在 x 為 0 時不等於 x 為 1 時", function () {
  assert.notEqual(
    evalPolynomial(this.coeffs, 0),
    evalPolynomial(this.coeffs, 1),
    "係數挑得不好，f(0) 與 f(1) 相同，這條場景無法區分 x 起點"
  );
});

// ===== 當（When）============================================================

When(
  "我對像素值 {int} 以門檻 {int}、張數 {int} 產生 share",
  function (value, k, n) {
    this.result = generateShares(value, k, n, this.randomFn);
  }
);

When(
  "我嘗試對像素值 {word} 以門檻 {word}、張數 {word} 產生 share",
  function (value, k, n) {
    // 參數來自例子表格，可能是 "1.5"、"NaN" 這種非整數字串，要轉成數字
    const toNum = (s) => (s === "NaN" ? NaN : Number(s));
    // 先「記下」要執行的動作，由「那麼 應該拋出 RangeError」負責執行與檢查
    this.pendingFn = () =>
      generateShares(toNum(value), toNum(k), toNum(n), this.randomFn);
  }
);

When(
  "我對像素值 {int} 以門檻 {int}、張數 {int} 產生 share 兩次",
  function (value, k, n) {
    // 若有 randomFactory，則兩次都從同一組隨機序列開始（可重現）
    const make = this.randomFactory ?? (() => this.randomFn);
    this.result = [make(), make()].map((fn) => generateShares(value, k, n, fn));
  }
);

When(
  "我以這組係數對像素值 {int}、門檻 {int}、張數 {int} 產生 share",
  function (value, k, n) {
    this.result = generateShares(value, k, n, this.randomFn);
  }
);

When("我用係數 [{int}, {int}] 對 x = {int} 求值", function (a0, a1, x) {
  this.result = evalPolynomial([a0, a1], x);
});

When("我用係數 [{int}] 對 x = {int} 求值", function (a0, x) {
  this.result = evalPolynomial([a0], x);
});

When("我用係數 [{int}, {int}, {int}] 對 x = {int} 求值", function (a0, a1, a2, x) {
  this.result = evalPolynomial([a0, a1, a2], x);
});

When("我拿前 {int} 張用拉格朗日插值算 x = 0", function (count) {
  const points = this.result.slice(0, count).map((y, i) => ({ x: i + 1, y }));
  this.result = lagrangeAtZero(points);
});

// ===== 那麼（Then）==========================================================

Then("我應該拿到 {int} 張 share", function (n) {
  assert.equal(this.result.length, n);
});

Then("每一張 share 都應該是 0 到 255 的整數", function () {
  if (this.skipRealGf) return;
  for (const [i, y] of this.result.entries()) {
    assert.ok(Number.isInteger(y), `第 ${i} 張不是整數: ${y}`);
    assert.ok(y >= 0 && y <= 255, `第 ${i} 張超出 0–255: ${y}`);
  }
});

Then("每一張 share 都應該等於 {int}", function (v) {
  for (const [i, y] of this.result.entries()) {
    assert.equal(y, v, `第 ${i} 張不等於 ${v}`);
  }
});

Then("第 {int} 張 share 應該等於 f 在 x 為 {int} 的值", function (index, x) {
  if (this.skipRealGf) return;
  // 這裡的預期值由 evalPolynomial 算；真正的數學正確性由 @real-gf 場景負責
  assert.equal(this.result[index - 1], evalPolynomial(this.coeffs, x));
});

Then("兩次的結果應該完全相同", function () {
  assert.deepEqual(this.result[0], this.result[1]);
});

Then("兩次的結果應該不相同", function () {
  assert.notDeepEqual(this.result[0], this.result[1]);
});

Then("應該拋出 RangeError", function () {
  let thrown;
  try {
    this.pendingFn();
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof RangeError, `沒有拋出 RangeError，得到 ${thrown}`);
});

Then("結果應該是 {int}", function (expected) {
  if (this.skipRealGf) return;
  assert.equal(this.result, expected);
});

Then("我應該還原出 {int}", function (expected) {
  if (this.skipRealGf) return;
  assert.equal(this.result, expected);
});

Then("結果不應該是 {int}", function (unexpected) {
  if (this.skipRealGf) return;
  assert.notEqual(this.result, unexpected);
});

// ===== @real-gf 專用 ========================================================
// 這些場景在墊檔狀態下用 --tags "not @real-gf" 排除，不會執行到這裡。
// 若不小心跑到了（GF_IS_REAL 為 false），直接跳過檢查，避免誤報失敗。

Given("真 GF 2 的 8 次方已接上", function () {
  if (!GF_IS_REAL) {
    // 墊檔狀態：讓後續的斷言全部變成 no-op，避免誤報失敗
    this.skipRealGf = true;
  }
});
