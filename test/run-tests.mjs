#!/usr/bin/env node
// index.html の純関数レイヤー(PURE:BEGIN〜PURE:END)を抜き出して Node で検証する回帰テスト。
// DOM 依存の parseHtmlTable の実行やビュー描画はブラウザでの手動/headless 確認に委ねる。
// 実行: node test/run-tests.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// PURE ブロックの抽出(BEGIN コメント行の直後 〜 最後の PURE:END 行の直前)
const beginIdx = html.indexOf("PURE:BEGIN");
const endIdx = html.lastIndexOf("PURE:END");
if (beginIdx < 0 || endIdx < 0) throw new Error("PURE マーカーが見つかりません");
const code = html.slice(html.indexOf("\n", beginIdx) + 1, html.lastIndexOf("\n", endIdx));

const exported = ["CONFIG", "decodeBytes", "toHalfWidth", "parseNumber", "normalizeYyyymm",
  "escapeHtml", "fmtNumber", "sniffFormat", "parseCsv", "normalizeSnapshot",
  "mergeDuplicateKeys", "diffSnapshots", "niceTicks"];
const lib = vm.runInNewContext(`${code}\n;({${exported.join(",")}})`, { TextDecoder });

let passed = 0, failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`); }
}
function ok(cond, label) { eq(!!cond, true, label); }

/* ---- decodeBytes ---- */
{
  const cp932 = readFileSync(join(root, "sample-data", "ledger_202506締め.csv"));
  let r = lib.decodeBytes(cp932);
  eq(r.encoding, "CP932", "decodeBytes: CP932ファイルの判定");
  ok(r.text.includes("髙島商事"), "decodeBytes: CP932拡張文字(髙)が読める");

  const utf8 = readFileSync(join(root, "sample-data", "ledger_202506締め_utf8.csv"));
  r = lib.decodeBytes(utf8);
  eq(r.encoding, "UTF-8", "decodeBytes: UTF-8ファイルの判定");
  ok(r.text.includes("販売費および一般管理費"), "decodeBytes: UTF-8本文");

  const bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from("年月,コード\n", "utf8")]);
  r = lib.decodeBytes(bom);
  eq(r.encoding, "UTF-8 (BOM)", "decodeBytes: BOM付きUTF-8の判定");
  ok(r.text.startsWith("年月"), "decodeBytes: BOMが除去される");
}

/* ---- parseNumber ---- */
{
  const p = lib.parseNumber;
  eq(p("1,234,000"), 1234000, "parseNumber: カンマ区切り");
  eq(p("△1,200"), -1200, "parseNumber: △負数");
  eq(p("▲500"), -500, "parseNumber: ▲負数");
  eq(p("(2,500)"), -2500, "parseNumber: 括弧負数");
  eq(p("-42"), -42, "parseNumber: マイナス記号");
  eq(p("¥12,000"), 12000, "parseNumber: 円記号");
  eq(p("1234.5"), 1234.5, "parseNumber: 小数");
  eq(p("123"), 123, "parseNumber: 全角数字");
  eq(p("12.5%"), 12.5, "parseNumber: パーセント");
  eq(p(""), null, "parseNumber: 空文字はnull");
  eq(p("-"), null, "parseNumber: ハイフンのみはnull");
  eq(p("P001"), null, "parseNumber: 文字列はnull");
  eq(p("2025/04"), null, "parseNumber: 日付様式はnull");
}

/* ---- normalizeYyyymm ---- */
{
  const n = lib.normalizeYyyymm;
  eq(n("202504"), "202504", "normalizeYyyymm: 6桁");
  eq(n("2025/4"), "202504", "normalizeYyyymm: スラッシュ1桁月");
  eq(n("2025/04"), "202504", "normalizeYyyymm: スラッシュ2桁月");
  eq(n("2025-12"), "202512", "normalizeYyyymm: ハイフン");
  eq(n("2025年4月"), "202504", "normalizeYyyymm: 和暦風表記");
  eq(n("2025.07"), "202507", "normalizeYyyymm: ドット");
  eq(n("202513"), null, "normalizeYyyymm: 13月はnull");
  eq(n("abc"), null, "normalizeYyyymm: 非数値はnull");
  eq(n("202504"), "202504", "normalizeYyyymm: 全角");
}

/* ---- parseCsv ---- */
{
  const rows = lib.parseCsv('a,"b,c",d\r\n1,"line\nbreak","he said ""hi"""\r\n\r\n');
  eq(rows, [["a", "b,c", "d"], ["1", "line\nbreak", 'he said "hi"']],
    "parseCsv: クォート内カンマ・改行・エスケープ・空行除去");
  eq(lib.parseCsv("x,y\n1,2"), [["x", "y"], ["1", "2"]], "parseCsv: 末尾改行なし");
}

/* ---- sniffFormat ---- */
{
  eq(lib.sniffFormat("年月,コード\n202501,P001"), "csv", "sniffFormat: CSV");
  eq(lib.sniffFormat("<html><body><table>..."), "html", "sniffFormat: HTML");
  eq(lib.sniffFormat("  \n<HTML>..."), "html", "sniffFormat: 前置空白+大文字HTML");
}

/* ---- normalizeSnapshot: 列種別判定と重複キー合算 ---- */
{
  const grid = [
    ["年月", "プロジェクトコード", "プロジェクト名", "部門", "販管費", "営業利益"],
    ["202501", "P001", "案件X", "開発部", "100", "900"],
    ["202501", "Z999", "販管費", "本社", "600", "△600"],
    ["202501", "Z999", "販管費", "共通", "400", "▲400"],
  ];
  const s = lib.normalizeSnapshot(grid, { name: "t", format: "csv", encoding: "UTF-8" });
  eq(s.rows.length, 2, "normalize: 重複キーが合算されて2行になる");
  eq(s.rawRowCount, 3, "normalize: 元行数は3");
  eq(s.mergedKeyCount, 1, "normalize: 合算されたキーは1件");
  const z = s.rows.find(r => r.projectCode === "Z999");
  eq(z.values["販管費"], 1000, "normalize: 数値列が合算される");
  eq(z.values["営業利益"], -1000, "normalize: 負数(△/▲)も正しく合算");
  eq(z.mergedCount, 2, "normalize: mergedCount=2");
  eq(z.dims["部門"], "本社", "normalize: dim列は先勝ち");
  ok(s.warnings.some(w => w.includes("部門")), "normalize: dim食い違いが警告される");
  eq(s.columns.map(c => c.kind), ["dim", "dim", "numeric", "numeric"], "normalize: 列種別の動的判定");
}

/* ---- キー列が見つからない場合のエラー ---- */
{
  let msg = "";
  try { lib.normalizeSnapshot([["月度", "コード"], ["202501", "X"]], { name: "t" }); }
  catch (e) { msg = e.message; }
  ok(msg.includes("CONFIG.keyColumns"), "normalize: キー列未検出でCONFIG誘導のエラー");
}

/* ---- 統合テスト: サンプルCSV 2断面の読み込みと突合 ---- */
{
  const load = f => {
    const { text } = lib.decodeBytes(readFileSync(join(root, "sample-data", f)));
    return lib.normalizeSnapshot(lib.parseCsv(text), { name: f, format: "csv", encoding: "-" });
  };
  const a = load("ledger_202506締め.csv");
  const b = load("ledger_202507締め.csv");
  eq(a.rawRowCount, 42, "統合: 断面Aの元行数42");
  eq(a.rows.length, 36, "統合: 断面AはZ999合算後36行(42-6)");
  eq(b.rows.length, 42, "統合: 断面BはZ999合算後42行(49-7)");
  const diff = lib.diffSnapshots(a, b);
  eq(diff.added.length, 7, "統合: added 7件");
  eq(diff.removed.length, 1, "統合: removed 1件");
  eq(diff.changed.length, 1, "統合: changed 1件");
  eq(diff.removed[0].key, "202506|P005", "統合: removed は 202506|P005");
  eq(diff.changed[0].key, "202504|P002", "統合: changed は 202504|P002");
  eq(diff.changed[0].deltas["売上高"], 1200000, "統合: 売上高の差分 +1,200,000");
  eq(diff.changed[0].deltas["営業利益"], 1200000, "統合: 営業利益の差分 +1,200,000");
  eq(diff.unchangedCount, 34, "統合: 変化なし34件(36-1削除-1変更)");
  // UTF-8版は断面Aと同一内容になるはず
  const a2 = load("ledger_202506締め_utf8.csv");
  const d2 = lib.diffSnapshots(a, a2);
  eq(d2.added.length + d2.removed.length + d2.changed.length, 0, "統合: CP932版とUTF-8版は同一内容");
}

/* ---- niceTicks ---- */
{
  const t = lib.niceTicks(120, 980, 5);
  ok(t.ticks.includes(0), "niceTicks: 0を必ず含む");
  ok(t.lo <= 0 && t.hi >= 980, "niceTicks: 範囲がデータを覆う");
  const t2 = lib.niceTicks(-500, 300, 5);
  ok(t2.ticks.includes(0) && t2.lo <= -500, "niceTicks: 負数範囲");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
