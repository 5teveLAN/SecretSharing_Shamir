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
  reconstructPixel,
  RECONSTRUCT_METHODS,
  DEFAULT_RECONSTRUCT_METHOD,
  isReconstructMethod,
  GF_IS_REAL,
} from "./shamir.js";
import { gaussianSolveAtZero } from "./Gaussian.js";
import { gfDeterminant, cramerSolveAtZero } from "./Determinant.js";

// ===== 測試用的 oracle：獨立實作，走跟 shamir.js 不同的路徑 =====================

/** 用位元迴圈算 GF(2^8) 乘法（多項式 x^8+x^4+x^3+x^2+1，約簡常數 0x1d）。 */
function oracleGfMul(a, b) {
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

/**
 * 獨立的 Horner 實作（另一條程式路徑），用來當 evalPolynomial 的預期值。
 * 乘法用 oracleGfMul，不碰 shamir.js 的 gf。
 *
 * 為什麼墊檔狀態不拿它跟 evalPolynomial 比數值？
 * 因為墊檔的 mul 是普通乘法，跟 XOR 加法混用會破壞分配律／結合律：
 *   真 GF：Horner 與「冪次累積」都等價
 *   墊檔：兩者不等價 → 沒有客觀的「正確答案」
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

/** T6 之後測試裡用的短別名（就是 oracleGfMul，同一份獨立實作）。 */
const gfMul = oracleGfMul;

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

// ===== T5 真 GF(2^8)：本原多項式 0x11d ========================================

test(
  "T5 真 GF：已知乘積 0x57 × 0x83 = 0x31（0x11d 下）",
  { skip: skipReason },
  () => {
    // 驗 evalPolynomial 底層用的乘法是否為真的 GF(2^8)
    assert.equal(evalPolynomial([0, 0x57], 0x83), 0x31);
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


// ===== T6 reconstructPixel：三種解法（拉格朗日 / 行列式 / 高斯）=================

const ALL_METHODS = Object.values(RECONSTRUCT_METHODS);

/** 把 shares 的前 count 張轉成 points（x 從 1 開始）。 */
function toPoints(shares, count) {
  return shares.slice(0, count).map((y, i) => ({ x: i + 1, y }));
}

/** 用 T5 的 oracle 造出一組「保證來自 k-1 次多項式」的點，不需要 randomFn。 */
function pointsFromCoeffs(coeffs) {
  return coeffs.map((_, i) => ({ x: i + 1, y: oracleRealGfEval(coeffs, i + 1) }));
}

const HARNESS_COEFFS = {
  [RECONSTRUCT_METHODS.LAGRANGE]: [5, 2, 7],
  [RECONSTRUCT_METHODS.DETERMINANT]: [173, 99, 200],
  [RECONSTRUCT_METHODS.GAUSSIAN]: [9, 200, 17],
};

/**
 * 用固定係數產生點：第 i 個點是 (x0 + i, f(x0 + i))，f 就是傳入的係數。
 * 係數長度 = 要幾個點（超過 k 個時，多出來的點仍在同一條多項式上）。
 * @param {number[]} coeffs [a0, a1, ..., a_{k-1}]
 * @param {number} [x0] 起始 x
 */
function makePoints(coeffs, x0 = 1) {
  return coeffs.map((_, i) => ({ x: x0 + i, y: oracleRealGfEval(coeffs, x0 + i) }));
}

test("T6 RECONSTRUCT_METHODS：三種方法名稱固定，預設是拉格朗日", () => {
  assert.deepEqual(ALL_METHODS.slice().sort(), ["determinant", "gaussian", "lagrange"]);
  assert.equal(DEFAULT_RECONSTRUCT_METHOD, RECONSTRUCT_METHODS.LAGRANGE);
  for (const m of ALL_METHODS) assert.ok(isReconstructMethod(m), m);
  for (const bad of ["Lagrange", "", null, undefined, 0, {}]) {
    assert.equal(isReconstructMethod(bad), false, `method=${String(bad)}`);
  }
});

test("T6 三種解法在 k=1（常數多項式）都回傳秘密本身", () => {
  for (const method of ALL_METHODS) {
    assert.equal(reconstructPixel([{ x: 7, y: 42 }], 1, method), 42, method);
  }
});

test("T6 三種解法在 k=2、k=3（已知係數）都得到 a0", () => {
  const cases = [
    { coeffs: [173, 99], k: 2 },
    { coeffs: [5, 2, 7], k: 3 },
    { coeffs: [9, 200, 17, 255], k: 4 },
  ];
  for (const { coeffs, k } of cases) {
    const pts = makePoints(coeffs);
    for (const method of ALL_METHODS) {
      assert.equal(
        reconstructPixel(pts, k, method),
        coeffs[0],
        `coeffs=[${coeffs}] method=${method}`
      );
    }
  }
});

test("T6 三種解法對「拆完再還原」的結果完全一致（多組隨機秘密）", () => {
  for (const method of ALL_METHODS) {
    for (const secret of [0, 1, 87, 173, 255]) {
      const shares = generateShares(secret, 4, 6);
      const pts = toPoints(shares, 4);
      assert.equal(reconstructPixel(pts, 4, method), secret, `secret=${secret} method=${method}`);
    }
  }
});

test("T6 三種解法在同一組點上給出同一個答案", () => {
  for (const method of ALL_METHODS) {
    const pts = makePoints(HARNESS_COEFFS[method]);
    const expected = HARNESS_COEFFS[method][0];
    for (const other of ALL_METHODS) {
      assert.equal(reconstructPixel(pts, pts.length, other), expected, `${method} 點 / ${other} 解法`);
    }
  }
});

test("T6 省略 method 時等同拉格朗日（與舊版行為相容）", () => {
  const pts = makePoints([123, 45, 67]);
  assert.equal(reconstructPixel(pts, 3), reconstructPixel(pts, 3, RECONSTRUCT_METHODS.LAGRANGE));
  assert.equal(reconstructPixel(pts, 3), 123);
});

test("T6 reconstructPixel：不認識的 method 要 throw RangeError", () => {
  const pts = toPoints([10, 20, 30], 3);
  for (const bad of ["newton", "", null, 3]) {
    assert.throws(() => reconstructPixel(pts, 3, bad), RangeError, `method=${String(bad)}`);
  }
});

test("T6 三種解法：點數不足 k 都要 throw RangeError", () => {
  const pts = makePoints([10, 20, 30]);
  for (const method of ALL_METHODS) {
    assert.throws(() => reconstructPixel(pts.slice(0, 2), 3, method), RangeError, method);
  }
});

test("T6 三種解法：x 座標重複都要 throw RangeError", () => {
  const pts = [
    { x: 1, y: 10 },
    { x: 1, y: 20 },
    { x: 3, y: 30 },
  ];
  for (const method of ALL_METHODS) {
    assert.throws(() => reconstructPixel(pts, 3, method), RangeError, method);
  }
});

test("T6 高斯消去：多給的點不影響結果（只取前 k 個）", () => {
  // 同一條多項式的 8 個點（用 generateShares 保證是同一條），k = 3
  const pts = toPoints(generateShares(200, 3, 8), 8);
  assert.equal(gaussianSolveAtZero(pts, 3), 200);
  assert.equal(gaussianSolveAtZero(pts.slice(0, 3), 3), 200);
});

test("T6 高斯消去：與拉格朗日 / 行列式在三種 k 上都一致", () => {
  for (const k of [2, 3, 5]) {
    const pts = toPoints(generateShares(171, k, 8), k);
    const expected = reconstructPixel(pts, k, RECONSTRUCT_METHODS.LAGRANGE);
    assert.equal(reconstructPixel(pts, k, RECONSTRUCT_METHODS.GAUSSIAN), expected, `k=${k}`);
    assert.equal(reconstructPixel(pts, k, RECONSTRUCT_METHODS.DETERMINANT), expected, `k=${k}`);
  }
});

test("T6 高斯消去：增廣矩陣不是方陣… k 不合法要 throw RangeError", () => {
  const pts = toPoints([1, 2, 3], 3);
  for (const k of [0, -1, 1.5, NaN, "3"]) {
    assert.throws(() => gaussianSolveAtZero(pts, k), RangeError, `k=${String(k)}`);
  }
  assert.throws(() => gaussianSolveAtZero(null, 3), RangeError);
});

test("T6 行列式：單位矩陣 det = 1、三角矩陣 det = 對角線乘積", () => {
  assert.equal(gfDeterminant([[1]]), 1);
  assert.equal(gfDeterminant([[1, 0], [0, 1]]), 1);
  assert.equal(
    gfDeterminant([[2, 0, 0], [5, 3, 0], [9, 4, 7]]),
    gfMul(gfMul(2, 3), 7)
  );
});

test("T6 行列式：兩列相同或差一個倍數 → det = 0", () => {
  // 兩列完全相同（第一個 x 重複，實務上就是 share 選了同一張）
  assert.equal(gfDeterminant([[1, 3], [1, 3]]), 0);
  // 第三列 = 第一列 XOR 第二列 → 線性相依
  const r1 = [1, 2, 3];
  const r2 = [4, 5, 6];
  const r3 = r1.map((v, i) => v ^ r2[i]);
  assert.equal(gfDeterminant([r1, r2, r3]), 0);
  // 整個零列
  assert.equal(gfDeterminant([[1, 2], [0, 0]]), 0);
});

test("T6 行列式：列交換在 GF(2^8) 不影響 det（-1 = 1）", () => {
  const a = [[3, 17, 9], [0, 1, 4], [2, 2, 200]];
  const b = [a[1], a[0], a[2]];
  assert.equal(gfDeterminant(a), gfDeterminant(b));
});

test("T6 行列式：det 與 oracle 的遞迴展開一致（2×2、3×3）", () => {
  // 2×2：ad - bc，GF 裡減法就是 XOR
  const two = [[0x57, 0x83], [0x40, 0x02]];
  assert.equal(
    gfDeterminant(two),
    gfMul(0x57, 0x02) ^ gfMul(0x83, 0x40)
  );

  // 3×3：用餘因子展開獨立算一次
  const m = [
    [17, 3, 200],
    [5, 88, 1],
    [9, 42, 7],
  ];
  const exp = (r0, r1) => gfMul(r0[0], r1[1]) ^ gfMul(r0[1], r1[0]);
  const det3 =
    gfMul(m[0][0], exp([m[1][1], m[1][2]], [m[2][1], m[2][2]])) ^
    gfMul(m[0][1], exp([m[1][0], m[1][2]], [m[2][0], m[2][2]])) ^
    gfMul(m[0][2], exp([m[1][0], m[1][1]], [m[2][0], m[2][1]]));
  assert.equal(gfDeterminant(m), det3);
});

test("T6 克拉瑪公式：Δ、Δ0 的比值等於秘密", () => {
  const secret = 173;
  const shares = generateShares(secret, 3, 5, seq([99, 200]));
  const pts = toPoints(shares, 3);
  const { value, delta, delta0, k } = cramerSolveAtZero(pts, 3);
  assert.equal(value, secret);
  assert.equal(k, 3);
  assert.notEqual(delta, 0);
  assert.equal(oracleGfDiv(delta0, delta), secret);
});

test("T6 克拉瑪公式：x 重複 → det(V) = 0 → throw RangeError", () => {
  const pts = [
    { x: 2, y: 1 },
    { x: 2, y: 9 },
  ];
  assert.throws(() => cramerSolveAtZero(pts, 2), RangeError);
});

test("T6 凡德蒙行列式 = Π_{i<j}(x_j - x_i)", () => {
  const xs = [3, 1, 15, 7];
  const v = xs.map((x) => [1, x, gfMul(x, x), gfMul(gfMul(x, x), x)]);
  let expected = 1;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      expected = gfMul(expected, xs[i] ^ xs[j]);
    }
  }
  assert.equal(gfDeterminant(v), expected);
});
