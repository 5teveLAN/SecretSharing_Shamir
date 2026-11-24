// ---------- gf28.js（安） ----------
// 本原多項式 P(x) = x^8 + x^4 + x^3 + x^2 + 1 (0x11d)，生成元 alpha = 2
const PRIMITIVE_POLY = 0x11d;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= PRIMITIVE_POLY;
    }
  }
  LOG[0] = 0;
})();

export const GF28 = {
  add(a, b) {
    return a ^ b;
  },

  sub(a, b) {
    return a ^ b;
  },

  mul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  },

  div(a, b) {
    if (b === 0) {
      throw new RangeError("Division by zero in GF(2^8)");
    }
    if (a === 0) return 0;
    return EXP[LOG[a] - LOG[b] + 255];
  },

  inv(a) {
    if (a === 0) {
      throw new RangeError("Zero has no multiplicative inverse in GF(2^8)");
    }
    return EXP[255 - LOG[a]];
  },

  EXP,
  LOG,
};
