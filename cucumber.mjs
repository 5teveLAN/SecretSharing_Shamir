export default {
  // Gherkin 規格檔（人看的）
  paths: ["code/features/**/*.feature"],
  // 步驟定義（把中文句子接到 shamir.js 的函式）
  import: ["code/features/steps/**/*.mjs"],
  format: ["progress"],
};
