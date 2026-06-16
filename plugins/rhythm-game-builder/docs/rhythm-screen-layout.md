# リズムゲーム画面配置設計書

- 作成日時: 2026-05-23 08:59
- 対象: ゲーム内画面のみ（ロゴ1、ロゴ2、タイトル、選曲、ゲームプレイ、ポーズ、リザルト）
- 座標系: Mega Drive 320x224px / 8x8px tile / 40x28 grid
- 方針: 現行コードで描画される配置を正とし、背景画像の内部デザインは1つの配置物として扱う

## 凡例

|カテゴリ|色コード|用途|
|---|---:|---|
|背景画像|`#D9EAF7`|background|
|テキスト|`#DCECCB`|text|
|SJISテキスト|`#C7E8D0`|sjis|
|スプライト|`#FCE2C4`|sprite|
|アルバムアート|`#E2D7F4`|album|
|ノーツ/判定ライン|`#F6C3D3`|note|
|HUD/ゲージ|`#FFF0B8`|hud|
|動的・条件付き表示|`#E6E6E6`|dynamic|
|パネル/枠|`#D6E3E8`|panel|
|要確認|`#F8C8C8`|warning|

## パレット方針

|項目|使用パレット|メモ|
|---|---|---|
|ロゴ1/2背景|PAL3|loadBackground(bg_logo/bg_logo2, ..., PAL3)|
|タイトル/リザルト背景|PAL0|loadBackground(..., PAL0)|
|選曲wobbleロゴ背景|PAL1|image_sgdk_logo.palette|
|選曲メニューパネル|PAL3|MenuBackdrop_Center.palette|
|選曲アルバムアート|PAL1|SongEntry.album_art.palette|
|選曲難易度アイコン|PAL2|spr_icon_diff.palette|
|ゲームプレイUI背景|PAL0|img_gameplay_ui.palette|
|ゲーム中アルバムアート|PAL2|SongEntry.album_art.palette|
|ゲーム中ムードスプライト|PAL3|mood_sprite.palette優先|
|ノーツスプライト|PAL1|spr_note.palette。BGM開始/復帰後にも再適用|
|判定/ゲージスプライト|実表示 PAL0 / 登録 PAL2|rhythm-service.jsのslot指定とhud.cのTILE_ATTRが不一致。要確認。|

## 調整候補

|優先度|対象|確認したい点|理由|
|---|---|---|---|
|高|判定/ゲージスプライト|登録パレットPAL2と実表示PAL0のどちらに寄せるか|現在の配置調整時に色化け要因になりやすい|
|高|ゲームプレイ右情報パネル|score/combo/gauge/title/mood の余白と重なり|右側情報密度が高い|
|中|選曲アルバムアート|選曲メタ情報との視線誘導|右側に要素が縦に集まっている|
|中|ポーズメニュー|背景からの視認性|テキストのみでパネル画像なし|
|低|ロゴ2|bg_logo2専用画像を使うか|現在は既定がbg_logoと同一|

## ロゴ1

起動直後に 60 frame 表示されるロゴ画面。入力は無視される。

|ID|配置物|カテゴリ|レイヤー|tile X/Y/W/H|px X/Y/W/H|リソース|パレット|条件/更新|参照|メモ|
|---|---|---|---|---:|---:|---|---|---|---|---|
|L1_BG|ロゴ1背景|背景画像|BG_B|0/0/40/28|0/0/320/224|bg_logo / rhythm_bg_logo|PAL3|起動後 60 frame|main.c:391||

## ロゴ2

ロゴ1のあとに 60 frame 表示される第2ロゴ。現状は bg_logo2 が同じ既定画像へフォールバックする。

|ID|配置物|カテゴリ|レイヤー|tile X/Y/W/H|px X/Y/W/H|リソース|パレット|条件/更新|参照|メモ|
|---|---|---|---|---:|---:|---|---|---|---|---|
|L2_BG|ロゴ2背景|背景画像|BG_B|0/0/40/28|0/0/320/224|bg_logo2 / rhythm_bg_logo2|PAL3|ロゴ1後 60 frame|main.c:404||

## タイトル

タイトル背景に固定テキスト、曲数、先頭曲名または警告を重ねる。START で選曲へ遷移。

|ID|配置物|カテゴリ|レイヤー|tile X/Y/W/H|px X/Y/W/H|リソース|パレット|条件/更新|参照|メモ|
|---|---|---|---|---:|---:|---|---|---|---|---|
|T_BG|タイトル背景|背景画像|BG_B|0/0/40/28|0/0/320/224|bg_title / rhythm_bg_title|PAL0|常時|main.c:456||
|T_NAME|MD RHYTHM GAME|テキスト|BG_A text|9/6/14/1|72/48/112/8|-|PAL0 text|常時|main.c:459||
|T_SUB|for Mega Drive|テキスト|BG_A text|9/8/14/1|72/64/112/8|-|PAL0 text|常時|main.c:460||
|T_COUNT|曲数表示|動的・条件付き表示|BG_A text|9/12/18/1|72/96/144/8|song_count|PAL0 text|常時 / %u song(s) loaded|main.c:464||
|T_WARN1|曲なし警告|動的・条件付き表示|BG_A text|7/14/18/1|56/112/144/8|-|PAL0 text|song_count == 0|main.c:469||
|T_WARN2|Export案内|動的・条件付き表示|BG_A text|4/15/25/1|32/120/200/8|-|PAL0 text|song_count == 0|main.c:470||
|T_FIRST|先頭曲タイトル|動的・条件付き表示|BG_A text|5/14/30/1|40/112/240/8|song_database[0].chart->title|PAL0 text|song_count > 0|main.c:479||
|T_START|PRESS START|テキスト|BG_A text|10/18/11/1|80/144/88/8|-|PAL0 text|常時|main.c:483||

## 選曲

wobble 背景、疑似透過メニュー、曲リスト、アルバムアート、難易度/ハイスコアを表示する。

|ID|配置物|カテゴリ|レイヤー|tile X/Y/W/H|px X/Y/W/H|リソース|パレット|条件/更新|参照|メモ|
|---|---|---|---|---:|---:|---|---|---|---|---|
|S_BG|wobbleロゴ背景|背景画像|BG_B|0/0/40/28|0/0/320/224|image_sgdk_logo を64px単位で敷き詰め|PAL1|常時 / H-INTで縦揺れ|main.c:173-182||
|S_PANEL|曲リスト暗色パネル|パネル/枠|SPR|1/5/25/12|8/40/200/96|MenuBackdrop_*|PAL3|常時 / shadow有効|main.c:191-218||
|S_ALBUM|選択曲アルバムアート|アルバムアート|BG_A|26/5/10/10|208/40/80/80|SongEntry.album_art|PAL1|song_count > 0|main.c:278-291||
|S_TITLE|SONG LIST|テキスト|BG_A text|3/6/9/1|24/48/72/8|-|PAL0 text|常時|main.c:586||
|S_LIST|曲リスト 8行|SJISテキスト|BG_A text|3/7/21/8|24/56/168/64|SongEntry.display_name|PAL0 text|select_scroll から最大8曲|main.c:557-579||
|S_META_NAME|選択曲表示名|SJISテキスト|BG_A text|24/16/14/1|192/128/112/8|SongEntry.display_name|PAL0 text|song_count > 0|main.c:511-516||
|S_META_BPM|BPM|テキスト|BG_A text|24/18/14/1|192/144/112/8|ChartInfo.bpm|PAL0 text|song_count > 0|main.c:519||
|S_HS_HEAD|HIGH-SCORE見出し|テキスト|BG_A text|24/20/14/1|192/160/112/8|-|PAL0 text|song_count > 0|main.c:522||
|S_HS_ROWS|難易度別ハイスコア|動的・条件付き表示|BG_A text|24/21/14/3|192/168/112/24|HIGHSCORE_*|PAL0 text|未プレイは -|main.c:529-539||
|S_DIFF_TXT|難易度テキスト|テキスト|BG_A text|3/24/12/1|24/192/96/8|selected_difficulty|PAL0 text|常時|main.c:588||
|S_DIFF_ICON|難易度アイコン|スプライト|SPR|16/23.5/3/3|128/188.0/24/24|spr_icon_diff|PAL2|selected_difficultyでanim変更|main.c:625-635|px=(128,188), tile Y は 23.5|
|S_HELP|操作ヘルプ|テキスト|BG_A text|1/26/27/1|8/208/216/8|-|PAL0 text|常時|main.c:590||

## ゲームプレイ

左側に縦レーン/ノーツ、右側にアルバムアート、スコア、コンボ、ゲージ、曲情報、ムードスプライトを置く。

|ID|配置物|カテゴリ|レイヤー|tile X/Y/W/H|px X/Y/W/H|リソース|パレット|条件/更新|参照|メモ|
|---|---|---|---|---:|---:|---|---|---|---|---|
|G_BG|ゲームプレイUI背景|背景画像|BG_B|0/0/40/28|0/0/320/224|img_gameplay_ui / rhythm_img_gameplay_ui|PAL0|常時|main.c:695,721||
|G_LANES|7レーン走行範囲|ノーツ/判定ライン|SPR overlay|2/0/18/28|16/0/144/224|LANE_X_START=16, LANE_WIDTH=20|PAL1 notes|ノーツは上から下へ流れる|rhythm-service.js:627-633 / note.c:45||
|G_JUDGE_LINE|判定ライン|ノーツ/判定ライン|背景UI内/基準線|2/23/18/1|16/184/144/8|JUDGE_LINE_Y=184|PAL0 background|判定基準|rhythm-service.js:627||
|G_NOTE_SPR|ノーツスプライト|スプライト|SPR|2/0/18/25|16/0/144/200|spr_note / 2x2 tiles|PAL1|NOTE_SPAWN_Y=-16 から JUDGE_LINE_Y=184 へ移動|note.c:159-230||
|G_JUDGE_SPR|判定テキスト|スプライト|SPR|6/19.25/8/2|48/154.0/64/16|spr_judge_text|実表示 PAL0 / 登録 PAL2|判定後 40 frame 表示|hud.c:66,100|パレット指定に要確認あり|
|G_SCORE|スコア数値|HUD/ゲージ|BG_A text|22/4/6/1|176/32/48/8|GameState.score|PAL0 text|score 変更時|hud.c:60-132||
|G_COMBO|コンボ数値|HUD/ゲージ|BG_A text|22/8/3/1|176/64/24/8|GameState.combo|PAL0 text|combo 変更時|hud.c:62-142||
|G_GAUGE|ゲージ塗り|HUD/ゲージ|SPR|22/10.5/6/1|176/84.0/48/8|spr_gauge_fill x6|実表示 PAL0 / 登録 PAL2|gauge_value から 0-6 segment|hud.c:55-59,109||
|G_ALBUM|ゲーム中アルバムアート|アルバムアート|BG_A|29/2/10/10|232/16/80/80|SongEntry.album_art|PAL2|曲別画像がある場合|main.c:310-337||
|G_TITLE|曲表示名|SJISテキスト|BG_A text|22/13/18/1|176/104/144/8|SongEntry.display_name|PAL0 text|GAME_start後|main.c:345-359||
|G_DIFF|難易度名|テキスト|BG_A text|22/14/6/1|176/112/48/8|selected_difficulty|PAL0 text|GAME_start後|main.c:358-359||
|G_MOOD|ムードスプライト|スプライト|SPR|23/16/16/12|184/128/128/96|SongEntry.mood_sprite / 128x96 frame|PAL3|accuracyに応じてanim 0-3|main.c:314-315,724-801||

## ポーズ

ゲームプレイ画面の上にテキストメニューを重ねる。STARTで開閉、上下でカーソル、決定で Resume/Retry/Quit。

|ID|配置物|カテゴリ|レイヤー|tile X/Y/W/H|px X/Y/W/H|リソース|パレット|条件/更新|参照|メモ|
|---|---|---|---|---:|---:|---|---|---|---|---|
|P_BASE|背後のゲームプレイ画面|背景画像|既存BG/SPR|0/0/40/28|0/0/320/224|ゲームプレイ画面の状態を保持|各種|pause中も背後に残る|game.c:538||
|P_AREA|ポーズメニュー消去範囲|パネル/枠|BG_A text|15/10/20/7|120/80/160/56|-|PAL0 text|pause open/close時に上書き|game.c:517-529||
|P_TITLE|= PAUSE =|テキスト|BG_A text|15/10/20/1|120/80/160/8|-|PAL0 text|pause中|game.c:517||
|P_RESUME|Resume|動的・条件付き表示|BG_A text|15/12/20/1|120/96/160/8|pause_menu_cursor|PAL0 text|項目0|game.c:521-522||
|P_RETRY|Retry|動的・条件付き表示|BG_A text|15/14/20/1|120/112/160/8|pause_menu_cursor|PAL0 text|項目1|game.c:521-522||
|P_QUIT|Quit|動的・条件付き表示|BG_A text|15/16/20/1|120/128/160/8|pause_menu_cursor|PAL0 text|項目2|game.c:521-522||

## リザルト

プレイ結果を背景上へテキストで列挙する。STARTで選曲へ戻る。

|ID|配置物|カテゴリ|レイヤー|tile X/Y/W/H|px X/Y/W/H|リソース|パレット|条件/更新|参照|メモ|
|---|---|---|---|---:|---:|---|---|---|---|---|
|R_BG|リザルト背景|背景画像|BG_B|0/0/40/28|0/0/320/224|bg_result / rhythm_bg_result|PAL0|常時|main.c:837||
|R_TITLE|= RESULT =|テキスト|BG_A text|10/3/10/1|80/24/80/8|-|PAL0 text|常時|main.c:840||
|R_SONG|楽曲名|動的・条件付き表示|BG_A text|8/5/24/1|64/40/192/8|ChartInfo.title|PAL0 text|常時|main.c:844||
|R_SCORE|SCORE|動的・条件付き表示|BG_A text|8/8/20/1|64/64/160/8|GameState.score|PAL0 text|常時|main.c:848||
|R_COMBO|MAX COMBO|動的・条件付き表示|BG_A text|8/10/20/1|64/80/160/8|GameState.max_combo|PAL0 text|常時|main.c:851||
|R_JUDGES|判定内訳|動的・条件付き表示|BG_A text|8/13/20/4|64/104/160/32|judge_counts|PAL0 text|PERFECT/GREAT/GOOD/MISS|main.c:854-860||
|R_ACC|ACCURACY|動的・条件付き表示|BG_A text|8/18/14/1|64/144/112/8|計算値|PAL0 text|total_notes > 0|main.c:873||
|R_GRADE|GRADE|動的・条件付き表示|BG_A text|8/20/8/1|64/160/64/8|accuracy threshold|PAL0 text|S/A/B/C/D|main.c:883||
|R_HELP|START: Song Select|テキスト|BG_A text|7/25/18/1|56/200/144/8|-|PAL0 text|常時|main.c:885||

## 参照元

- `md-game-editor/plugins/rhythm-game-builder/template/src/main.c`
- `md-game-editor/plugins/rhythm-game-builder/template/src/game.c`
- `md-game-editor/plugins/rhythm-game-builder/template/src/note.c`
- `md-game-editor/plugins/rhythm-game-builder/template/src/hud.c`
- `md-game-editor/plugins/rhythm-game-editor/rhythm-service.js`
