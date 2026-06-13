# スロットホール取材スケジュール ダッシュボード

[hall-navi.com](https://hall-navi.com) から東京都の取材・旧イベスケジュールを取得し、
最終的にスマホのブラウザで見られるダッシュボードにするためのプロジェクト。

## 構成

```
slot-dashboard/
├── index.html          # スマホ向けダッシュボード（GitHub Pages 公開用）
├── style.css
├── app.js
├── scraper.py          # hall-navi.com スクレイパー（Playwright）
├── requirements.txt
├── data/
│   ├── schedule_1.json          # 取得結果（1=東京都）
│   └── character_birthdays.json # キャラ誕生日（サンプル・要編集）
├── .github/workflows/scrape.yml # 毎朝自動でスクレイプ＆コミット
└── venv/               # Python 仮想環境
```

## Web ダッシュボード

`index.html` を開くと表示される静的サイト（サーバ不要・ビルド不要）。

- **スケジュールタブ**：今日〜1週間の取材を一覧。日付チップ／ホール名検索／エリア(区)／ランク／取材種別キーワードで絞り込み、日付順・スコア順で並べ替え。
- **誕生日カレンダータブ**：`data/character_birthdays.json` のキャラ誕生日と、その日の狙い目ホール（取材名に機種キーワードが含まれれば強調、無ければ高ランク取材上位）を表示。

ローカル確認：

```bash
cd ~/slot-dashboard
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く（file:// だと fetch が失敗するため要サーバ）
```

### キャラ誕生日データの編集

`data/character_birthdays.json` の `birthdays` 配列を編集する（初期値はサンプル）。

```json
{ "name": "キャラ名", "machine": "機種名", "month": 6, "day": 15, "machine_keywords": ["北斗", "ラオウ"] }
```

`machine_keywords` が取材名に部分一致すると、その日の狙い目ホールとして強調表示される。

## セットアップ

```bash
cd ~/slot-dashboard
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

## 使い方

```bash
source venv/bin/activate
python scraper.py                    # 東京都を全ページ取得 → data/schedule_1.json
python scraper.py --max-pages 3      # 直近3ページ（≒直近の48件）だけ取得
python scraper.py --pref 2           # 神奈川県（県コードは scraper.py の PREFECTURES 参照）
python scraper.py --headed           # ブラウザを表示してデバッグ
```

### 県コード（k パラメータ）

| code | 県      | 備考          |
|------|---------|---------------|
| 1    | 東京都  | 動作確認済み  |
| 2    | 神奈川県 |               |
| 3    | 千葉県  |               |
| 4    | 茨城県  |               |
| 5    | 栃木県  |               |
| 6    | 埼玉県  |               |
| 7    | 群馬県  |               |

## 取得できるデータ

`data/schedule_1.json` の各エントリ:

| フィールド   | 内容                                         |
|--------------|----------------------------------------------|
| `date`       | 取材日 (YYYY-MM-DD)                          |
| `weekday`    | 曜日（土・日…）                              |
| `hall`       | ホール名                                     |
| `hid`        | hall-navi のホール ID                        |
| `hall_url`   | ホール詳細ページ URL                         |
| `address`    | 住所                                         |
| `station`    | 最寄り駅                                     |
| `score`      | hall-navi のおすすめスコア（点）             |
| `events`     | 取材・旧イベ一覧 `[{rank, name}]`（rank: S/A/B/C/・）|

## 技術メモ

- hall-navi.com は **Cloudflare の bot 対策**があるため、`requests` 等の単純な
  HTTP リクエストでは 403 になる。実ブラウザを動かす **Playwright (Chromium)**
  でページを描画して取得している。
- Cloudflare はセッションの 2 回目以降のアクセスを CAPTCHA に格上げするため、
  **ページごとに新しいブラウザコンテキスト**で取得している。
- 「会員登録して表示する」と表示される会員限定エントリは取得対象外（公開分のみ）。
- サーバ負荷を避けるためページ間に待機（既定 2.5 秒）を入れている。個人利用の範囲で。

## GitHub Pages で公開する

1. このフォルダを GitHub リポジトリにして push する。
   ```bash
   cd ~/slot-dashboard
   git init && git add . && git commit -m "init: スロット取材ダッシュボード"
   git branch -M main
   git remote add origin https://github.com/<ユーザー名>/slot-dashboard.git
   git push -u origin main
   ```
2. GitHub の **Settings → Pages** で、Source を `Deploy from a branch` → `main` / `(root)` に設定。
   数十秒後 `https://<ユーザー名>.github.io/slot-dashboard/` で公開される。
3. **Settings → Actions → General → Workflow permissions** を `Read and write permissions` にする
   （Actions が `data/*.json` をコミットできるようにするため）。

## 自動更新（GitHub Actions）

`.github/workflows/scrape.yml` が **毎朝 06:00 JST**（および手動実行）に `scraper.py` を走らせ、
`data/schedule_1.json` を更新してコミットする。Pages はコミットを検知して自動で再公開される。

> ⚠️ **注意**：GitHub Actions のランナーは海外 IP のため、hall-navi.com の Cloudflare に
> より強い CAPTCHA を出され、取得に失敗する可能性がある。失敗する場合は、手元の Mac で
> `python scraper.py` を実行して `data/` をコミットする運用（または自宅 PC のセルフホスト
> ランナー）に切り替える。Actions ログで確認できる。

## 注意・免責

- 本ツールは個人利用を想定。取得データの出典は hall-navi.com（サイト内に明記済み）。
- 会員限定情報は取得せず、公開されている情報のみを扱う。
- 公開サイトとして再配布する場合は、出典元の利用規約を各自で確認すること。

## TODO

- [ ] 他県対応の検証（pref 2〜7）
- [ ] キャラ誕生日データの拡充
