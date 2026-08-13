#!/usr/bin/env python3
"""ダミー元帳データ生成スクリプト。

標準ライブラリのみ使用。シード固定のため、何度実行しても同一の出力になる。

生成物(すべて本スクリプトと同じディレクトリに出力):
  ledger_202506締め.csv      断面A: 202501〜202506、CP932
  ledger_202507締め.csv      断面B: 202501〜202507、CP932(断面Aとの差分あり)
  ledger_202506締め_utf8.csv 断面Aと同内容、UTF-8(エンコード判定の検証用)
  ledger_202507締め.xls      断面Bと同内容、実体はHTML(偽xls)。
                             数値はカンマ区切り・負数は△表記(数値クリーニングの検証用)

断面Aに対する断面Bの差分(比較表の検証用。件数は既知):
  added   7件: 202507 の全行(P001〜P004, P006, Z999)+ P006 の 202506(過去月への追加)
  removed 1件: P005 の 202506(P005 は 202505 で終了扱い)
  changed 1件: P002 の 202504 売上高を +1,200,000 遡及修正

Z999「販売費および一般管理費」は毎月2行(部門: 本社/共通)に分かれる。
→ 同一キー(年月×プロジェクトコード)の重複行を数値合算するロジックの必須テストケース。
その他の検証用の仕込み:
  - P002 のプロジェクト名に CP932 拡張文字「髙」
  - P004 のプロジェクト名に ASCII カンマ(CSV のクォート処理の検証用)
"""
import random
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent

HEADER = ["年月", "プロジェクトコード", "プロジェクト名", "部門",
          "売上高", "売上原価", "販管費", "営業利益"]

PROJECTS = [
    ("P001", "基幹システム刷新", "開発部"),
    ("P002", "髙島商事向け導入支援", "営業1部"),
    ("P003", "データ分析基盤構築", "開発部"),
    ("P004", "クラウド移行支援(設計,構築)", "営業2部"),
    ("P005", "保守運用サービス", "営業1部"),
]
P006 = ("P006", "新規SaaS立ち上げ", "営業2部")
SGA_CODE, SGA_NAME = "Z999", "販売費および一般管理費"

MONTHS_A = [f"2025{m:02d}" for m in range(1, 7)]   # 202501..202506
MONTHS_B = [f"2025{m:02d}" for m in range(1, 8)]   # 202501..202507


def project_row(code, name, dept, month):
    # (code, month) から決定的に数値を作る。断面間で同じ行は同じ値になる
    r = random.Random(f"{code}-{month}")
    sales = r.randrange(8_000, 30_001, 10) * 1000
    cogs = int(sales * r.uniform(0.55, 0.80) / 1000) * 1000
    sga = r.randrange(300, 1_500) * 1000
    return [month, code, name, dept, sales, cogs, sga, sales - cogs - sga]


def sga_rows(month):
    # 販管費プロジェクト: 同一キーで2行(本社/共通)。売上なし・営業利益はマイナス
    r = random.Random(f"{SGA_CODE}-{month}")
    total = r.randrange(9_000, 14_000) * 1000
    part1 = int(total * 0.6 / 1000) * 1000
    part2 = total - part1
    return [
        [month, SGA_CODE, SGA_NAME, "本社", 0, 0, part1, -part1],
        [month, SGA_CODE, SGA_NAME, "共通", 0, 0, part2, -part2],
    ]


def snapshot_a():
    rows = []
    for m in MONTHS_A:
        for code, name, dept in PROJECTS:
            rows.append(project_row(code, name, dept, m))
        rows.extend(sga_rows(m))
    rows.sort(key=lambda r: (r[0], r[1]))
    return rows


def snapshot_b():
    rows = []
    for m in MONTHS_B:
        for code, name, dept in PROJECTS:
            if code == "P005" and m >= "202506":
                continue  # removed: P005 は 202505 で終了(202506 行が断面Aから消える)
            rows.append(project_row(code, name, dept, m))
        if m >= "202506":
            rows.append(project_row(*P006, m))  # added: P006 は 202506 から新規参入
        rows.extend(sga_rows(m))
    for row in rows:
        if row[0] == "202504" and row[1] == "P002":
            row[4] += 1_200_000  # changed: 売上高の遡及修正
            row[7] += 1_200_000
    rows.sort(key=lambda r: (r[0], r[1]))
    return rows


def csv_field(v):
    s = str(v)
    if any(c in s for c in ',"\r\n'):
        s = '"' + s.replace('"', '""') + '"'
    return s


def write_csv(path, rows, encoding):
    lines = [",".join(csv_field(v) for v in row) for row in [HEADER] + rows]
    path.write_bytes(("\r\n".join(lines) + "\r\n").encode(encoding))
    print(f"  {path.name}  ({encoding}, {len(rows)}行)")


def fmt_xls_number(n):
    # 業務システム風: カンマ区切り、負数は △ 表記
    return f"△{abs(n):,}" if n < 0 else f"{n:,}"


def write_fake_xls(path, rows):
    body = ["<html><head><meta http-equiv='Content-Type' "
            "content='text/html; charset=shift_jis'></head><body>"]
    # 業務システム出力にありがちな装飾用の小テーブル(パーサーはこれを無視して
    # 最大行数のテーブルを採用できる必要がある)
    body.append("<table><tr><td>元帳一覧表</td></tr>"
                "<tr><td>出力日: 2025/08/05</td></tr></table>")
    body.append("<table border='1'>")
    body.append("<tr>" + "".join(f"<th>{h}</th>" for h in HEADER) + "</tr>")
    for row in rows:
        tds = [f"<td>{v}</td>" for v in row[:4]]
        tds += [f"<td align='right'>{fmt_xls_number(v)}</td>" for v in row[4:]]
        body.append("<tr>" + "".join(tds) + "</tr>")
    body.append("</table></body></html>")
    path.write_bytes("\r\n".join(body).encode("cp932"))
    print(f"  {path.name}  (偽xls/HTML, cp932, {len(rows)}行)")


def main():
    a, b = snapshot_a(), snapshot_b()
    print(f"生成先: {OUT_DIR}")
    write_csv(OUT_DIR / "ledger_202506締め.csv", a, "cp932")
    write_csv(OUT_DIR / "ledger_202506締め_utf8.csv", a, "utf-8")
    write_csv(OUT_DIR / "ledger_202507締め.csv", b, "cp932")
    write_fake_xls(OUT_DIR / "ledger_202507締め.xls", b)

    # 差分の答え合わせ(比較表の検証で使う既知件数)
    key = lambda r: f"{r[0]}|{r[1]}"
    def merged(rows):
        m = {}
        for r in rows:
            k = key(r)
            m[k] = [x + y for x, y in zip(m[k], r[4:])] if k in m else list(r[4:])
        return m
    ma, mb = merged(a), merged(b)
    added = sorted(set(mb) - set(ma))
    removed = sorted(set(ma) - set(mb))
    changed = sorted(k for k in set(ma) & set(mb) if ma[k] != mb[k])
    print(f"断面間差分: added {len(added)} / removed {len(removed)} / changed {len(changed)}")
    print(f"  added:   {added}")
    print(f"  removed: {removed}")
    print(f"  changed: {changed}")


if __name__ == "__main__":
    main()
