// ---------- shamir.js（蕭） ----------

// 數學運算全部交給 安 的 gf28.js（本原多項式 0x11d，x^8+x^4+x^3+x^2+1）。
// 這裡只透過 gf.add / gf.mul / gf.div 操作 0–255 的位元組，不碰 Canvas。
import { GF28 as gf } from "./gf28.js";
import { lagrangeInterpolateAtZero } from "./Lagrange.js";
import { gaussianSolveAtZero } from "./Gaussian.js";
import { determinantSolveAtZero } from "./Determinant.js";

/**
 * 還原秘密時可選的解法。
 * 三種方法在數學上等價，差在「怎麼解出多項式的常數項 a0」：
 *   lagrange     拉格朗日插值（直接代 x = 0）
 *   determinant  行列式 + 克拉瑪公式（a0 = Δ0 / Δ）
 *   gaussian     高斯消去（消成上三角後取 a0 = R[0][k] / R[0][0]）
 */
export const RECONSTRUCT_METHODS = Object.freeze({
  LAGRANGE: "lagrange",
  DETERMINANT: "determinant",
  GAUSSIAN: "gaussian",
});

/** UI 下拉／勾選用的預設解法。 */
export const DEFAULT_RECONSTRUCT_METHOD = RECONSTRUCT_METHODS.LAGRANGE;

/** 是否為支援的解法名稱。 */
export function isReconstructMethod(method) {
  return Object.values(RECONSTRUCT_METHODS).includes(method);
}

/**
 * 真 GF(2^8) 是否已接上。
 * 墊檔時期測試用這個決定要不要 skip 數值正確性的檢查；現在恆為 true，
 * 等測試與 BDD 的 skip 機制清掉之後就可以連這個常數一起刪。
 */
export const GF_IS_REAL = true;

// ===== 小工具 =================================================================
/** 取得 0–255 的密碼學真隨機位元組。 */
function randomByte() {
  return crypto.getRandomValues(new Uint8Array(1))[0];
}

/** 檢查是否為 0–255 的整數，不是就 throw。 */
function assertByte(v, name) {
  if (!Number.isInteger(v) || v < 0 || v > 255)
    throw new RangeError(`${name} 必須是 0–255 的整數，收到 ${v}`);
}

/** 檢查 k、n：1 ≤ k ≤ n ≤ 255。 */
function assertThreshold(k, n) {
  if (!Number.isInteger(k) || !Number.isInteger(n))
    throw new RangeError(`k、n 必須是整數，收到 k=${k}, n=${n}`);
  if (k < 1 || n > 255 || k > n)
    throw new RangeError(`必須 1 ≤ k ≤ n ≤ 255，收到 k=${k}, n=${n}`);
}

/**
 * 產生多項式 f(x) = a0 + a1·x + ... + a_{k-1}·x^{k-1} 的係數。
 * a0 就是秘密 value，a1..a_{k-1} 是隨機係數。
 * UI 之後若想顯示方程式，呼叫這個拿係數即可，不需要改 generateShares 的回傳型別。
 * @param {number} value 0–255
 * @param {number} k 門檻（規格裡的 r），也就是多項式次數 + 1
 * @param {() => number} [randomFn] 取得 0–255 隨機位元組的函式，測試時可注入固定序列
 * @returns {number[]} 長度 k 的係數 [a0, a1, ..., a_{k-1}]，每項 0–255
 */
export function makePolynomial(value, k, randomFn = randomByte) {
  assertByte(value, "value");
  if (!Number.isInteger(k) || k < 1 || k > 255)
    throw new RangeError(`k 必須是 1–255 的整數，收到 ${k}`);

  const a = new Array(k);
  a[0] = value;
  for (let i = 1; i < k; i++) {
    const c = randomFn();
    if (!Number.isInteger(c) || c < 0 || c > 255)
      throw new RangeError(`randomFn 必須回傳 0–255 的整數，收到 ${c}`);
    a[i] = c;
  }
  return a;
}

/**
 * 用 Horner 法求多項式的值：a0 + a1·x + ... + a_{k-1}·x^{k-1}。
 * 從最高次係數往 a0 收，每次只做一次乘加，不需要 pow。
 * @param {number[]} coeffs [a0, a1, ..., a_{k-1}]，每項 0–255
 * @param {number} x 代入值（share 編號 1..n）
 * @returns {number} 0–255
 */
export function evalPolynomial(coeffs, x) {
  let y = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) y = gf.add(gf.mul(y, x), coeffs[i]);
  return y;
}

/**
 * @param {number} value 0–255
 * @param {number} k 門檻（規格裡的 r）
 * @param {number} n 張數，k ≤ n ≤ 255
 * @param {() => number} [randomFn] 取得 0–255 隨機位元組的函式，測試時可注入固定序列
 * @returns {number[]} 長度 n，索引 0..n-1 對應第 1..n 張 share，每項 0–255
 */
export function generateShares(value, k, n, randomFn = randomByte) {
  assertByte(value, "value");
  assertThreshold(k, n);

  const a = makePolynomial(value, k, randomFn);

  // x 用 1..n（不用 0：f(0) = a0 就是秘密本身）。
  const shares = new Array(n);
  for (let i = 0; i < n; i++) shares[i] = evalPolynomial(a, i + 1);
  return shares;
}

/**
 * 從 k 個點還原單一像素通道的秘密值（多項式的常數項 a0）。
 *
 * @param {{x:number, y:number}[]} points x ∈ [1,n]，至少 k 個
 * @param {number} k 門檻（多項式次數 + 1）
 * @param {string} [method] 用哪種方法解：'lagrange' | 'determinant' | 'gaussian'
 *   省略時預設 'lagrange'（行為與舊版相同）。
 * @returns {number} 0–255
 * @throws {RangeError} 點數不足、門檻不合法、x 重複，或 method 不認識
 */
export function reconstructPixel(points, k, method = DEFAULT_RECONSTRUCT_METHOD) {
  if (method === RECONSTRUCT_METHODS.LAGRANGE) {
    return lagrangeInterpolateAtZero(points, k);
  } else if (method === RECONSTRUCT_METHODS.DETERMINANT) {
    return determinantSolveAtZero(points, k);
  } else if (method === RECONSTRUCT_METHODS.GAUSSIAN) {
    return gaussianSolveAtZero(points, k);
  }

  throw new RangeError(
    `不認識的還原方法 "${method}"，可用：${Object.values(RECONSTRUCT_METHODS).join(" / ")}`
  );
}
