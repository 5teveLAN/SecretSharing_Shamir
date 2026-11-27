// ---------- Gaussian.js ----------
// 高斯消去法（Gaussian elimination）解秘密多項式的常數項 a0。
//
// 收到 k 個點 (x_i, y_i)，要求 f(x) = a0 + a1·x + ... + a_{k-1}·x^{k-1} 的 a0，
// 就是解 k × k 的線性方程組：
//   ┌ 1  x_0  x_0²  ... ┐ ┌ a0 ┐   ┌ y_0 ┐
//   │ 1  x_1  x_1²  ... │ │ a1 │   │ y_1 │
//   │ ...                │ │ .. │ = │ ... │
//   └ 1  x_{k-1} ...    ┘ └ .. ┘   └ y_{k-1} ┘
//
// 前向消去（化為上三角）之後，再做回代（back substitution）解出所有 a，
// 秘密就是 a[0]。為什麼一定要回代？因為化簡後第 0 列的常數項是
//   y' = a0 + a1·x0 + a2·x0² + ...
// a1..a_{k-1} 不為 0 時，直接拿 y' / 1 只會拿到整條多項式在 x0 的值，不是 a0。
//
// 所有運算都在 GF(2^8)（本原多項式 0x11d）上：加法 = 減法 = XOR。
import { GF28 as gf } from "./gf28.js";

/**
 * 用高斯消去法解出常數項 a0（也就是秘密）。
 * @param {{x: number, y: number}[]} points 至少 k 個點，x ∈ [1, 255] 且互不相同
 * @param {number} k 門檻，也就是多項式次數 + 1
 * @returns {number} 0–255 的秘密
 */
export function gaussianSolveAtZero(points, k) {
  if (!Array.isArray(points) || points.length < k) {
    throw new RangeError(
      `點的數量不足以還原，至少需要 ${k} 個點，收到 ${Array.isArray(points) ? points.length : 0} 個`
    );
  }
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`k 必須是 ≥ 1 的整數，收到 ${k}`);
  }

  // 增廣矩陣：k 列 × (k + 1) 行，最後一行放 y
  const m = new Array(k);
  for (let i = 0; i < k; i++) {
    const { x, y } = points[i];
    const row = new Array(k + 1);
    let p = 1; // x^0, x^1, ..., x^{k-1}
    for (let j = 0; j < k; j++) {
      row[j] = p;
      p = gf.mul(p, x);
    }
    row[k] = y;
    m[i] = row;
  }

  // 前向消去：第 col 欄以下全清成 0
  for (let col = 0; col < k; col++) {
    // 挑一個主元非 0 的列（GF 上只有「用不用」的差別，這一步就是 partial pivoting）
    let pivot = col;
    while (pivot < k && m[pivot][col] === 0) pivot++;
    if (pivot === k) {
      throw new RangeError(
        "高斯消去失敗：矩陣奇異（singular），請檢查是否有重複的 x 座標"
      );
    }
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }

    const invPivot = gf.inv(m[col][col]);
    for (let r = col + 1; r < k; r++) {
      const factor = m[r][col];
      if (factor === 0) continue;
      // row_r ^= (row_r[col] / row_col[col]) · row_col
      const scale = gf.mul(factor, invPivot);
      for (let c = col; c <= k; c++) {
        m[r][c] = gf.sub(m[r][c], gf.mul(scale, m[col][c]));
      }
    }
  }

  // 回代：從最後一列往上解，a[row] = (b'[row] + Σ a[c]·R[row][c]) / R[row][row]
  const a = new Array(k);
  for (let row = k - 1; row >= 0; row--) {
    let sum = m[row][k];
    for (let c = row + 1; c < k; c++) sum = gf.sub(sum, gf.mul(m[row][c], a[c]));
    a[row] = gf.div(sum, m[row][row]);
  }

  // 秘密 = 常數項
  return a[0];
}
