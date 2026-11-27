// ---------- Determinant.js ----------
// 行列式（克拉瑪公式）解秘密多項式的常數項 a0。
//
// 把 k 個點寫成凡德蒙矩陣 V（第 i 列 = [1, x_i, x_i², ..., x_i^{k-1}]），方程組 V·a = y：
//   Δ    = det(V)                      係數矩陣的行列式
//   Δ0   = det(V 的第 0 欄換成 y)       也就是把常數項那一欄換成 y
//   a0   = Δ0 / Δ                      克拉瑪公式
//
// 行列式計算：先做高斯消去把矩陣化成上三角，
//   - 列交換只會讓 det 變號；GF(2^8) 的特徵是 2，1 = -1，所以變不變號都一樣
//   - 上三角矩陣的 det = 對角線乘積
// 因此 det 不需要 O(k!) 的展開，也不用事先求出完整的逆矩陣。
import { GF28 as gf } from "./gf28.js";

/**
 * 複製一個 k×k 方陣（GF(2^8) 元素）。
 * @param {number[][]} matrix
 * @returns {number[][]}
 */
function cloneMatrix(matrix) {
  return matrix.map((row) => row.slice());
}

/**
 * 高斯消去求行列式。
 * @param {number[][]} matrix k×k 方陣，元素 0–255
 * @param {string} [name] 錯誤訊息用的名稱
 * @returns {number} 行列式值，0–255（0 代表矩陣奇異）
 */
export function gfDeterminant(matrix, name = "matrix") {
  const n = Array.isArray(matrix) ? matrix.length : 0;
  if (n > 0 && !matrix.every((row) => Array.isArray(row) && row.length === n)) {
    throw new RangeError(`${name} 必須是 n×n 方陣`);
  }
  if (n === 0) return 1; // 空矩陣的 det 定義為 1

  const m = cloneMatrix(matrix);
  let det = 1; // 上三角化之後的對角線乘積

  for (let col = 0; col < n; col++) {
    let pivot = col;
    while (pivot < n && m[pivot][col] === 0) pivot++;
    if (pivot === n) return 0; // 整欄都是 0 → 奇異 → det = 0
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
      // 列交換讓 det 變號；GF(2^8) 裡 -1 = 1，所以異或不異或結果相同。
    }

    const pivotValue = m[col][col];
    det = gf.mul(det, pivotValue);

    const invPivot = gf.inv(pivotValue);
    for (let r = col + 1; r < n; r++) {
      if (m[r][col] === 0) continue;
      const scale = gf.mul(m[r][col], invPivot);
      for (let c = col; c < n; c++) {
        m[r][c] = gf.sub(m[r][c], gf.mul(scale, m[col][c]));
      }
    }
  }

  return det;
}

/**
 * 用克拉瑪公式求 a0（秘密）。
 * 回傳物件裡同時附上 Δ 與 Δ0，方便 UI / 簡報顯示中間結果。
 * @param {{x: number, y: number}[]} points 至少 k 個點
 * @param {number} k 門檻
 * @returns {{value: number, delta: number, delta0: number, k: number}}
 */
export function cramerSolveAtZero(points, k) {
  if (!Array.isArray(points) || points.length < k) {
    throw new RangeError(
      `點的數量不足以還原，至少需要 ${k} 個點，收到 ${Array.isArray(points) ? points.length : 0} 個`
    );
  }
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`k 必須是 ≥ 1 的整數，收到 ${k}`);
  }

  // 凡德蒙矩陣 V：第 i 列 = [1, x_i, x_i², ..., x_i^{k-1}]
  const v = new Array(k);
  for (let i = 0; i < k; i++) {
    const { x } = points[i];
    const row = new Array(k);
    let p = 1;
    for (let j = 0; j < k; j++) {
      row[j] = p;
      p = gf.mul(p, x);
    }
    v[i] = row;
  }

  // Δ0：把 a0 那一欄（第 0 欄）換成 y，其餘不變
  const v0 = cloneMatrix(v);
  for (let i = 0; i < k; i++) v0[i][0] = points[i].y;

  const delta = gfDeterminant(v, "V");
  if (delta === 0) {
    throw new RangeError(
      "克拉瑪公式失敗：det(V) = 0，矩陣奇異，請檢查是否有重複的 x 座標"
    );
  }
  const delta0 = gfDeterminant(v0, "V0");

  return { value: gf.div(delta0, delta), delta, delta0, k };
}

/**
 * 只取秘密值（給 reconstructPixel 用；要中間結果時呼叫 cramerSolveAtZero）。
 * @param {{x: number, y: number}[]} points
 * @param {number} k
 * @returns {number} 0–255
 */
export function determinantSolveAtZero(points, k) {
  return cramerSolveAtZero(points, k).value;
}
