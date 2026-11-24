// ---------- shamir.js（蕭） ----------

// 數學運算全部交給 安 的 gf28.js（本原多項式 0x11d，x^8+x^4+x^3+x^2+1）。
// 這裡只透過 gf.add / gf.mul / gf.div 操作 0–255 的位元組，不碰 Canvas。
import { GF28 as gf } from "./gf28.js";
import { lagrangeInterpolateAtZero } from "./Lagrange.js";

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
 * @param {{x:number, y:number}[]} points x ∈ [1,n]，至少 k 個
 * @param {number} k
 * @returns {number} 0–255
 */
export function reconstructPixel(points, k) {
  return lagrangeInterpolateAtZero(points, k);
}
