import { GF28 as gf } from "./gf28.js";

/**
 * 拉格朗日插值求 f(0)（即常數項秘密 a0）
 * 公式：
 *   f(0) = Σ_{i=0}^{k-1} y_i * l_i(0)
 *   l_i(0) = Π_{j ≠ i} (0 - x_j) / (x_i - x_j)
 * 在 GF(2^8) 中，加法與減法皆為異或 (XOR)，所以 -x 等於 x：
 *   l_i(0) = Π_{j ≠ i} x_j / (x_i ^ x_j)
 *
 * @param {{x: number, y: number}[]} points 包含 x 與 y 座標的點陣列
 * @param {number} k 門檻值（只取前 k 個點進行還原）
 * @returns {number} 0–255 還原出的秘密
 */
export function lagrangeInterpolateAtZero(points, k) {
  if (!points || points.length < k) {
    throw new RangeError(`點的數量不足以還原，至少需要 ${k} 個點`);
  }

  const selected = points.slice(0, k);
  let secret = 0;

  for (let i = 0; i < k; i++) {
    const xi = selected[i].x;
    const yi = selected[i].y;

    let li = 1;
    for (let j = 0; j < k; j++) {
      if (i === j) continue;
      const xj = selected[j].x;
      const denom = gf.sub(xi, xj); // 即 xi ^ xj
      if (denom === 0) {
        throw new RangeError(`存在重複的 x 座標: ${xi}`);
      }
      // li *= (xj / (xi - xj))
      const term = gf.div(xj, denom);
      li = gf.mul(li, term);
    }

    // secret ^= yi * li
    secret = gf.add(secret, gf.mul(yi, li));
  }

  return secret;
}
