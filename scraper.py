#!/usr/bin/env python3
"""
hall-navi.com 取材スケジュール スクレイパー

hall-navi.com は Cloudflare の bot 対策があるため、Playwright の
ヘッドレスブラウザで実際にページを描画して取得する。
公開されている（=会員登録不要で表示される）取材スケジュールのみを抽出し、
data/schedule_<area>.json に保存する。

使い方:
    source venv/bin/activate
    python scraper.py                  # 東京都を全ページ取得
    python scraper.py --pref 1 --max-pages 5
    python scraper.py --headed         # ブラウザを表示してデバッグ

注意:
  - 個人利用の範囲で、サーバに負荷をかけないようページ間に待機を入れている。
  - 会員限定（「会員登録して表示する」）のエントリは取得しない。
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone, timedelta

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

BASE = "https://hall-navi.com"

# 県コード（k パラメータ）。確認済みは 1=東京都。他は hall-navi の関東版の並び順。
PREFECTURES = {
    1: "東京都",
    2: "神奈川県",
    3: "千葉県",
    4: "茨城県",
    5: "栃木県",
    6: "埼玉県",
    7: "群馬県",
}

JST = timezone(timedelta(hours=9))

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def parse_date(text):
    """'2026/06/13( 土 )' -> ('2026-06-13', '土')"""
    m = re.search(r"(\d{4})/(\d{1,2})/(\d{1,2})", text)
    iso = None
    if m:
        iso = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    wm = re.search(r"[（(]\s*([月火水木金土日])\s*[)）]", text)
    weekday = wm.group(1) if wm else None
    return iso, weekday


def parse_schedule(html):
    """1ページ分の HTML から公開スケジュールを抽出する。"""
    soup = BeautifulSoup(html, "lxml")
    items = []
    for box in soup.select(".osbox"):
        # 会員限定エントリ（ホール名が伏せられている）はスキップ
        if "会員登録して表示する" in box.get_text():
            continue
        h2 = box.select_one("h2.oslh2")
        if not h2:
            continue
        hall = h2.get_text(strip=True)
        if not hall or hall == "東京都":
            continue

        # スコア
        score = None
        sc = box.select_one("p.oslstr font.point") or box.select_one("font.point")
        if sc:
            sm = re.search(r"[\d.]+", sc.get_text())
            if sm:
                score = float(sm.group(0))

        # 日付
        date_iso, weekday = (None, None)
        dm = box.select_one("p.oslmd")
        if dm:
            date_iso, weekday = parse_date(dm.get_text(" ", strip=True))

        # 取材種別（ランク + 名前）
        events = []
        for ul in box.select("ul.list_event_name"):
            rank_el = ul.select_one("li.list_event_name_rank")
            name_el = ul.select_one("li.list_event_name_li")
            rank = rank_el.get_text(strip=True) if rank_el else None
            name = name_el.get_text(" ", strip=True) if name_el else None
            if name:
                events.append({"rank": rank, "name": name})

        # 住所・最寄り駅 と メタ情報（oslha が複数ある）
        address = None
        station = None
        for p in box.select("p.oslha"):
            t = p.get_text(" ", strip=True)
            if t.startswith("["):
                stm = re.match(r"\[(.+?)\]\s*(.*)", t)
                if stm:
                    station = stm.group(1)
                    address = stm.group(2)
                else:
                    address = t

        # ホール詳細リンク（hid）
        hid = None
        hall_url = None
        hv = box.select_one("a[href*='hole_view']")
        if hv:
            href = hv.get("href", "")
            hm = re.search(r"hid=(\d+)", href)
            if hm:
                hid = hm.group(1)
                hall_url = f"{BASE}/hole_view?hid={hid}"

        items.append(
            {
                "date": date_iso,
                "weekday": weekday,
                "hall": hall,
                "hid": hid,
                "hall_url": hall_url,
                "address": address,
                "station": station,
                "score": score,
                "events": events,
            }
        )
    return items


def get_total_and_pages(html):
    """H1 から総件数を読む。'全1030件 1～50を表示' -> (1030, 50)"""
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.select_one("h1")
    total = per = None
    if h1:
        t = h1.get_text(" ", strip=True)
        tm = re.search(r"全\s*([\d,]+)\s*件", t)
        if tm:
            total = int(tm.group(1).replace(",", ""))
        pm = re.search(r"～\s*(\d+)\s*を表示", t)
        if pm:
            per = int(pm.group(1))
    return total, per


def scrape(pref=1, max_pages=None, delay=2.5, headed=False):
    pref_name = PREFECTURES.get(pref, str(pref))
    results = []
    seen = set()  # (hid, date, hall) で重複排除

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)

        total_seen = None
        page_no = 1
        while True:
            # Cloudflare はセッションの 2 回目以降を CAPTCHA に格上げするため、
            # ページごとに新しいコンテキスト（=毎回「初回アクセス」）で取得する。
            if page_no == 1:
                url = f"{BASE}/serch_sche_result?k[]={pref}&area=kanto"
            else:
                url = f"{BASE}/serch_sche_result?k[]={pref}&area=kanto&page={page_no}"

            ctx = browser.new_context(
                user_agent=UA,
                locale="ja-JP",
                viewport={"width": 412, "height": 915},
            )
            page = ctx.new_page()
            print(f"  [page {page_no}] {url}", file=sys.stderr)
            try:
                resp = page.goto(url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(4000)  # Cloudflare / JS 描画待ち
                html = page.content()
            finally:
                ctx.close()

            if "Attention Required" in html or "Just a moment" in html:
                print("    -> Cloudflare に阻まれました。中断します", file=sys.stderr)
                break

            if total_seen is None:
                total_seen, per = get_total_and_pages(html)
                print(f"    総件数: {total_seen} (1ページ {per} 件)", file=sys.stderr)

            page_items = parse_schedule(html)
            new_count = 0
            for it in page_items:
                key = (it["hid"], it["date"], it["hall"])
                if key in seen:
                    continue
                seen.add(key)
                it["prefecture"] = pref_name
                results.append(it)
                new_count += 1
            print(f"    -> 公開 {len(page_items)} 件 / 新規 {new_count} 件", file=sys.stderr)

            # 終了判定: このページに公開エントリが無い / 上限ページ / 「次へ」無し
            has_next = any(
                a.get_text(strip=True) == "次へ"
                for a in BeautifulSoup(html, "lxml").find_all("a", href=True)
            )
            if len(page_items) == 0:
                break
            if max_pages and page_no >= max_pages:
                break
            if not has_next:
                print("    -> 「次へ」リンク無し。終端に到達", file=sys.stderr)
                break
            page_no += 1
            time.sleep(delay)

        browser.close()

    return {
        "source": "hall-navi.com",
        "prefecture": pref_name,
        "pref_code": pref,
        "fetched_at": datetime.now(JST).isoformat(),
        "total_listed": total_seen,
        "count": len(results),
        "schedules": results,
    }


def main():
    ap = argparse.ArgumentParser(description="hall-navi.com 取材スケジュール取得")
    ap.add_argument("--pref", type=int, default=1, help="県コード (1=東京都)")
    ap.add_argument("--max-pages", type=int, default=None, help="取得する最大ページ数")
    ap.add_argument("--delay", type=float, default=2.5, help="ページ間の待機秒数")
    ap.add_argument("--headed", action="store_true", help="ブラウザを表示する")
    ap.add_argument("--out", default=None, help="出力先 JSON パス")
    args = ap.parse_args()

    pref_name = PREFECTURES.get(args.pref, str(args.pref))
    print(f"== {pref_name} の取材スケジュールを取得 ==", file=sys.stderr)
    data = scrape(
        pref=args.pref, max_pages=args.max_pages, delay=args.delay, headed=args.headed
    )

    out = args.out or f"data/schedule_{args.pref}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"== 完了: {data['count']} 件を {out} に保存 ==", file=sys.stderr)


if __name__ == "__main__":
    main()
