// ---------- shamir.test.mjs ----------
// 執行：node --test code/shamir.test.mjs
//
// 這份測試驗證「零件級」的正確性：
//   T1 係數生成  makePolynomial
//   T2 多項式求值 evalPolynomial（對照獨立實作 + 手算已知值）
//   T3 組裝      generateShares（x 從 1 開始、索引對齊、長度）
//   T4 邊界與真 GF（真 GF 那組在 GF_IS_REAL 為 false 時 skip）
//
// 「拆完再還原 = 原值」的端對端測試要等 reconstructPixel + 真的 GF28 都有。

import test from "node:test";
import assert from "node:assert/strict";

import {
  generateShares,
  makePolynomial,
  evalPolynomial,
  GF_IS_REAL,
} from "./shamir.js";

// ===== 測試用的 oracle：獨立實作，走跟 shamir.js 不同的路徑 =====================

/** 用位元迴圈算 GF(2^8) 乘法（多項式 x^8+x^4+x^3+x+1，約簡常數 0x1b）。 */
function oracleGfMul(a, b) {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) r ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return r;
}

/**
 * 獨立的 Horner 實作（另一條程式路徑），用來當 evalPolynomial 的預期值。
 * 乘法用 oracleGfMul，不碰 shamir.js 的 gf。
 *
 * 為什麼墊檔狀態不拿它跟 evalPolynomial 比數值？
 * 因為墊檔的 mul 是普通乘法，跟 XOR 加法混用會破壞分配律／結合律：
 *   真 GF：Horner 與「冪次累積」都得到 24（等價）
 *   墊檔：Horner 得到 64、冪次累積得到 60（不等價 → 沒有客觀的「正確答案」）
 * 所以在接上真的 GF28 之前，只驗結構性質，數值正確性一律留給 T5（真 GF）。
 */
function oracleRealGfEval(coeffs, x) {
  let y = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    y = oracleGfMul(y, x) ^ coeffs[i];
  }
  return y;
}

/** 固定序列的 randomFn；用完就 throw，避免偷偷多抽。 */
function seq(values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error("randomFn 被呼叫太多次");
    return values[i++];
  };
}

/**
 * 真 GF 相關測試的 skip 條件。
 * 安 的 gf28.js 接上之前，數值正確性無法客觀驗證（見 oracleRealGfEval 說明），
 * 所以這些測試先 skip；接上後 `GF_IS_REAL` 變 true，會自動開始跑。
 */
const skipReason = GF_IS_REAL ? false : "GF28 尚未接上，仍在墊檔狀態";

// ===== T1 係數生成 ============================================================

test("T1 makePolynomial：a0 === value，a1.. 取自 randomFn", () => {
  const a = makePolynomial(5, 3, seq([2, 7]));
  assert.deepEqual(a, [5, 2, 7]);
});

test("T1 makePolynomial：k = 1 時沒有隨機係數，也不呼叫 randomFn", () => {
  const boom = () => {
    throw new Error("k = 1 不該呼叫 randomFn");
  };
  assert.deepEqual(makePolynomial(255, 1, boom), [255]);
});

test("T1 makePolynomial：長度等於 k，所有係數都在 0–255", () => {
  for (const k of [1, 2, 3, 8, 255]) {
    const a = makePolynomial(123, k);
    assert.equal(a.length, k);
    for (const c of a) {
      assert.ok(Number.isInteger(c) && c >= 0 && c <= 255, `係數 ${c} 超出範圍`);
    }
  }
});

test("T1 makePolynomial：value / k 不合法要 throw RangeError", () => {
  for (const v of [-1, 256, 1.5, NaN, "5", null, undefined]) {
    assert.throws(() => makePolynomial(v, 2), RangeError, `value=${String(v)}`);
  }
  for (const k of [0, -1, 256, 1.5, NaN, "3"]) {
    assert.throws(() => makePolynomial(10, k), RangeError, `k=${String(k)}`);
  }
});

test("T1 makePolynomial：randomFn 回傳不合法的值要 throw RangeError", () => {
  for (const bad of [256, -1, 1.5, NaN, "7", null]) {
    assert.throws(
      () => makePolynomial(10, 2, () => bad),
      RangeError,
      `randomFn 回傳 ${String(bad)}`
    );
  }
});

// ===== T2 多項式求值 ==========================================================
//
// 墊檔狀態（GF_IS_REAL = false）能驗的不變量：
//   - k = 1 時任何 x 都回 a0
//   - x = 0 時回 a0
//   - 回傳 0–255 整數
//   - 同輸入同輸出（純函式）
// 數值正確性驗不了（見 oracleRealGfEval 的說明），一律留給 T5。

test("T2 evalPolynomial：k = 1（常數多項式）任何 x 都是 value", () => {
  for (const x of [0, 1, 2, 100, 255]) {
    assert.equal(evalPolynomial([42], x), 42);
  }
});

test("T2 evalPolynomial：x = 0 時結果是 a0（秘密本身）", () => {
  for (const v of [0, 1, 128, 255]) {
    for (const rest of [[], [99], [99, 200], [1, 2, 3, 4, 5, 6, 7]]) {
      assert.equal(evalPolynomial([v, ...rest], 0), v, `coeffs=[${[v, ...rest]}]`);
    }
  }
});

test(
  "T2 evalPolynomial：回傳 0–255 的整數、且是純函式",
  { skip: skipReason },
  () => {
    const cases = [
      { coeffs: [5, 2, 7], x: 3 },
      { coeffs: [173, 99, 0, 255], x: 5 },
      { coeffs: [1, 2, 3, 4, 5, 6, 7, 8], x: 9 },
    ];
    for (const { coeffs, x } of cases) {
      const a = evalPolynomial(coeffs, x);
      const b = evalPolynomial(coeffs, x);
      assert.equal(a, b, "同輸入應同輸出");
      assert.ok(Number.isInteger(a), `不是整數: ${a}`);
      assert.ok(a >= 0 && a <= 255, `超出 0–255: ${a}`);
    }
  }
);

test("T2 evalPolynomial：不改動傳入的係數陣列", () => {
  const coeffs = [5, 2, 7];
  const copy = [...coeffs];
  evalPolynomial(coeffs, 9);
  assert.deepEqual(coeffs, copy);
});

test(
  "T2 evalPolynomial：與獨立 Horner 實作一致（真 GF 時才有意義）",
  { skip: skipReason },
  () => {
    const cases = [
      { coeffs: [5, 2], x: 1 },
      { coeffs: [5, 2, 7], x: 3 },
      { coeffs: [173, 99, 0, 255], x: 5 },
      { coeffs: [1, 2, 3, 4, 5, 6, 7, 8], x: 255 },
    ];
    for (const { coeffs, x } of cases) {
      assert.equal(
        evalPolynomial(coeffs, x),
        oracleRealGfEval(coeffs, x),
        `coeffs=[${coeffs}] x=${x}`
      );
    }
  }
);

// ===== T3 generateShares 組裝 =================================================

test("T3 generateShares：k = 1 時所有 share 都等於 value", () => {
  for (const v of [0, 42, 255]) {
    const s = generateShares(v, 1, 7);
    assert.equal(s.length, 7);
    for (const y of s) assert.equal(y, v);
  }
});

test("T3 generateShares：shares[i] === evalPolynomial(coeffs, i + 1)", () => {
  const fixed = [2, 7]; // a1, a2
  const n = 6;
  const k = 3;

  // 驗「組裝」而非「數值」：用同一組係數走兩條不同的呼叫路徑
  const shares = generateShares(5, k, n, seq(fixed));
  const expected = Array.from({ length: n }, (_, i) =>
    evalPolynomial([5, ...fixed], i + 1)
  );

  assert.equal(shares.length, n);
  assert.deepEqual(shares, expected, "shares[i] 應該等於 f(i+1)");
  // 確認 generateShares 內部用的係數就是 makePolynomial 產生的那組
  assert.deepEqual(makePolynomial(5, k, seq(fixed)), [5, ...fixed]);
});

test("T3 generateShares：x 從 1 開始，不是從 0", () => {
  // 自己算 f(1..n) 當預期，並確認 f(0) 不等於 f(1) 才能區分起點
  const coeffs = [9, 200, 17];
  const shares = generateShares(9, 3, 5, seq([200, 17]));
  assert.equal(shares.length, 5);
  assert.notEqual(
    evalPolynomial(coeffs, 0),
    evalPolynomial(coeffs, 1),
    "係數挑得不好，無法區分 x 起點"
  );
  for (let i = 0; i < 5; i++) {
    assert.equal(shares[i], evalPolynomial(coeffs, i + 1), `第 ${i} 張應為 f(${i + 1})`);
  }
});

test("T3 generateShares：同固定係數得到相同結果（可重現）", () => {
  const a = generateShares(77, 3, 8, seq([10, 20]));
  const b = generateShares(77, 3, 8, seq([10, 20]));
  assert.deepEqual(a, b);
});

test("T3 generateShares：用真隨機時，兩次結果不同（k >= 2）", () => {
  const a = generateShares(7, 2, 16);
  const b = generateShares(7, 2, 16);
  assert.notDeepEqual(a, b);
});

test("T3 generateShares：n = 255 能正常跑", () => {
  const s = generateShares(1, 5, 255, seq([1, 2, 3, 4]));
  assert.equal(s.length, 255);
});

// ===== T4 邊界 ================================================================

test("T4 generateShares：value 不合法要 throw RangeError", () => {
  for (const v of [-1, 256, 1.5, NaN, "5", null, undefined]) {
    assert.throws(() => generateShares(v, 2, 5), RangeError, `value=${String(v)}`);
  }
});

test("T4 generateShares：k / n 不合法要 throw RangeError", () => {
  const bad = [
    [0, 0], [0, 5], [-1, 5], [3, 2], [5, 4], [1, 256], [256, 256],
    [1.5, 5], [2, 5.5], [NaN, 5], [2, NaN], [2, "5"], [null, 3],
  ];
  for (const [k, n] of bad) {
    assert.throws(
      () => generateShares(10, k, n),
      RangeError,
      `k=${String(k)}, n=${String(n)}`
    );
  }
});

test("T4 generateShares：每次回傳新陣列，不共用", () => {
  const a = generateShares(1, 1, 3);
  const b = generateShares(1, 1, 3);
  assert.notEqual(a, b, "兩次呼叫不該共用同一個陣列");
});

// ===== T5 真 GF(2^8)：安交件前自動 skip =======================================

test(
  "T5 真 GF：已知乘積 0x57 × 0x83 = 0xc1（AES 教科書例子）",
  { skip: skipReason },
  () => {
    // 驗 evalPolynomial 底層用的乘法是否為真的 GF(2^8)
    assert.equal(evalPolynomial([0, 0x57], 0x83), 0xc1);
  }
);

test(
  "T5 真 GF：拆完再用拉格朗日（x=0）還原要等於原值",
  { skip: skipReason },
  () => {
    const secret = 173;
    const k = 3;
    const shares = generateShares(secret, k, 5, seq([99, 200]));

    // 取前 k 點做拉格朗日插值，算 x = 0 的值
    const pts = shares.slice(0, k).map((y, i) => ({ x: i + 1, y }));
    let out = 0;
    for (let i = 0; i < k; i++) {
      let num = 1;
      let den = 1;
      for (let j = 0; j < k; j++) {
        if (i === j) continue;
        num = oracleGfMul(num, pts[j].x);
        den = oracleGfMul(den, pts[i].x ^ pts[j].x);
      }
      out ^= oracleGfMul(pts[i].y, oracleGfDiv(num, den));
    }
    assert.equal(out, secret);
  }
);

function oracleGfDiv(a, b) {
  if (b === 0) throw new RangeError("除以 0");
  return oracleGfMul(a, oracleGfPow(b, 254));
}

function oracleGfPow(a, e) {
  let r = 1;
  for (let i = 0; i < e; i++) r = oracleGfMul(r, a);
  return r;
}

