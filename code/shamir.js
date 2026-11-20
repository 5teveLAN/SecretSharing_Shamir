// ---------- shamir.js（蕭） ----------
/**
 * @param {number} value 0–255
 * @param {number} k 門檻
 * @param {number} n 張數，k ≤ n ≤ 255
 * @returns {number[]} 長度 n，0–255
 */
export function generateShares(value, k, n) {}

/**
 * @param {{x:number, y:number}[]} points x ∈ [1,n]，至少 k 個
 * @param {number} k
 * @returns {number} 0–255
 */
export function reconstructPixel(points, k) {}
