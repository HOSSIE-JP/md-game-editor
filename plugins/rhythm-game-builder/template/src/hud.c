/**
 * @file hud.c
 * @brief HUD表示モジュール
 *
 * リズムゲームプレイ中のヘッドアップディスプレイを管理する。
 *
 * 表示要素:
 *   - 判定テキスト: PERFECT/GREAT/GOOD/MISS をスプライトで表示
 *   - ゲージ      : スプライトセグメントで表示
 *
 * スコア・正確度はゲームプレイUI背景画像で表現するため、
 * テキスト描画は行わない（画像UIモード前提）。
 */

#include "hud.h"

#include <genesis.h>

#include "game_def.h"
#include "rhythm.h"
#include "rhythm_resources.h"

/* 判定表示タイマーと状態 */
static u16 judge_timer;
static u8 last_judge;
static bool hud_visible;
static bool use_image_ui;
static u32 prev_score;
static u16 prev_combo;

/* 判定テキスト表示時間（フレーム数） */
#define JUDGE_DISPLAY_FRAMES 40

/* スプライトベースのHUD要素 */
static Sprite* spr_judge; /* 判定テキストスプライト */

/* ゲージセグメントスプライト (48px = 6セグメント、右側パネル内) */
#define HUD_GAUGE_SEGMENTS 6
static Sprite* spr_gauge_seg[HUD_GAUGE_SEGMENTS]; /* ゲージ塗りつぶしセグメント */
static u16 prev_gauge_segs;						  /* 前回表示したセグメント数 */

/* スプライト定義の範囲内で安全にアニメ/フレームを設定 */
static void setSpriteSafeAnimFrame(Sprite* spr, const SpriteDefinition* def, u16 anim, u16 frame) {
	if (spr == NULL || def == NULL || def->numAnimation == 0 || def->animations == NULL) return;

	if (anim >= def->numAnimation) anim = def->numAnimation - 1;
	const Animation* a = def->animations[anim];
	if (a == NULL || a->numFrame == 0) return;
	if (frame >= a->numFrame) frame = a->numFrame - 1;

	SPR_setAnimAndFrame(spr, anim, frame);
}

/* ゲージ・スコアは右側情報パネルへ集約する */
#define INFO_PANEL_X 176
#define INFO_PANEL_TILE_X 22
#define GAUGE_X INFO_PANEL_X
#define GAUGE_Y 84
#define GAUGE_SEG_W 8 /* 各セグメントの幅 (1タイル=8px) */
#define SCORE_NUM_X INFO_PANEL_TILE_X
#define SCORE_NUM_Y 4
#define COMBO_NUM_X INFO_PANEL_TILE_X
#define COMBO_NUM_Y 8

/* 判定テキストスプライト表示位置 */
#define JUDGE_SPR_X (LANE_X_START + 32)
#define JUDGE_SPR_Y (JUDGE_LINE_Y - 30)

static void setJudgeSpritePattern(u8 judge) {
	if (spr_judge == NULL) return;

	/*
	 * パターン対応:
	 * - 画像が「縦4アニメ(各1フレーム)」なら anim=judge, frame=0
	 * - 画像が「1アニメ横4フレーム」なら anim=0, frame=judge
	 */
	if (spr_judge_text.numAnimation > judge && spr_judge_text.animations != NULL &&
		spr_judge_text.animations[judge] != NULL && spr_judge_text.animations[judge]->numFrame > 0) {
		setSpriteSafeAnimFrame(spr_judge, &spr_judge_text, judge, 0);
		return;
	}

	setSpriteSafeAnimFrame(spr_judge, &spr_judge_text, 0, judge);
}

/* ============================================================
 * 初期化
 * ============================================================ */

u16 HUD_init(u16 vram_index) {
	judge_timer = 0;
	last_judge = 0;
	hud_visible = FALSE;
	use_image_ui = FALSE;
	prev_score = 0xFFFFFFFF;
	prev_combo = 0xFFFF;
	prev_gauge_segs = 0;

	/* 判定テキストスプライト（初期状態: 非表示） */
	spr_judge = SPR_addSprite(&spr_judge_text, JUDGE_SPR_X, JUDGE_SPR_Y, TILE_ATTR(PAL0, FALSE, FALSE, FALSE));
	if (spr_judge != NULL) {
		SPR_setVisibility(spr_judge, HIDDEN);
		setJudgeSpritePattern(0);
	}

	/* ゲージ塗りつぶしセグメント */
	for (u8 s = 0; s < HUD_GAUGE_SEGMENTS; s++) {
		spr_gauge_seg[s] =
			SPR_addSprite(&spr_gauge_fill, GAUGE_X + s * GAUGE_SEG_W, GAUGE_Y, TILE_ATTR(PAL0, FALSE, FALSE, FALSE));
		if (spr_gauge_seg[s] != NULL) {
			setSpriteSafeAnimFrame(spr_gauge_seg[s], &spr_gauge_fill, 0, s);
			SPR_setVisibility(spr_gauge_seg[s], HIDDEN);
		}
	}

	return 0;
}

/* ============================================================
 * HUD表示値の更新（スプライトのみ、テキスト描画なし）
 * ============================================================ */

void HUD_update(u32 score, u16 combo, u8 accuracy) {
	if (!hud_visible) return;

	/* 左上テキスト: スコア数値のみ */
	if (score != prev_score) {
		char sbuf[12];
		u32 score_draw = (score > 999999UL) ? 999999UL : score;
		sprintf(sbuf, "%06lu", (unsigned long)score_draw);
		VDP_setTextPalette(PAL0);
		VDP_drawText(sbuf, SCORE_NUM_X, SCORE_NUM_Y);
		prev_score = score;
	}

	/* コンボテキストは常時表示（0は"  0"で表示） */
	if (combo != prev_combo) {
		char cbuf[8];
		VDP_setTextPalette(PAL0);
		u16 combo_draw = (combo > 999) ? 999 : combo;
		sprintf(cbuf, "%3u", combo_draw);
		VDP_drawText(cbuf, COMBO_NUM_X, COMBO_NUM_Y);
		prev_combo = combo;
	}
}

/* ============================================================
 * 判定テキスト表示
 * ============================================================ */

void HUD_showJudgment(u8 judge) {
	if (judge > JUDGE_MISS) return;

	last_judge = judge;
	judge_timer = JUDGE_DISPLAY_FRAMES;

	if (!hud_visible) return;

	/* 判定スプライトを表示 */
	if (spr_judge != NULL) {
		setJudgeSpritePattern(judge);
		SPR_setVisibility(spr_judge, VISIBLE);
	}
}

/* ============================================================
 * HUDアニメーション更新
 * ============================================================ */

void HUD_animate(void) {
	if (judge_timer > 0) {
		judge_timer--;
		if (judge_timer == 0) {
			if (spr_judge != NULL) SPR_setVisibility(spr_judge, HIDDEN);
		}
	}
}

/* ============================================================
 * ゲージ表示更新
 * ============================================================ */

void HUD_updateGauge(u16 gauge_value) {
	if (!hud_visible) return;

	/* ゲージ値からセグメント数を計算 */
	u16 filled = (u16)((u32)gauge_value * HUD_GAUGE_SEGMENTS / GAUGE_MAX);
	if (filled > HUD_GAUGE_SEGMENTS) filled = HUD_GAUGE_SEGMENTS;

	/* 前回と同じなら更新不要 */
	if (filled == prev_gauge_segs) return;

	/* セグメントの表示/非表示を更新 */
	for (u8 s = 0; s < HUD_GAUGE_SEGMENTS; s++) {
		if (spr_gauge_seg[s] != NULL) {
			if (s < filled) {
				SPR_setVisibility(spr_gauge_seg[s], VISIBLE);
			} else {
				SPR_setVisibility(spr_gauge_seg[s], HIDDEN);
			}
		}
	}
	prev_gauge_segs = filled;
}

/* ============================================================
 * HUD表示/非表示切替
 * ============================================================ */

void HUD_setVisibility(bool visible) {
	hud_visible = visible;

	if (visible) {
		prev_score = 0xFFFFFFFF;
		prev_combo = 0xFFFF;
		prev_gauge_segs = 0;
	} else {
		VDP_drawText("      ", SCORE_NUM_X, SCORE_NUM_Y);
		VDP_drawText("   ", COMBO_NUM_X, COMBO_NUM_Y);
		/* 全HUDスプライトを非表示化 */
		if (spr_judge != NULL) SPR_setVisibility(spr_judge, HIDDEN);
		for (u8 s = 0; s < HUD_GAUGE_SEGMENTS; s++) {
			if (spr_gauge_seg[s] != NULL) SPR_setVisibility(spr_gauge_seg[s], HIDDEN);
		}
	}
}

void HUD_setUseImageUI(bool use_image) { use_image_ui = use_image; }

/* ============================================================
 * HUDリソース解放
 * ============================================================ */

void HUD_release(void) {
	HUD_setVisibility(FALSE);
	judge_timer = 0;

	if (spr_judge != NULL) {
		SPR_releaseSprite(spr_judge);
		spr_judge = NULL;
	}
	for (u8 s = 0; s < HUD_GAUGE_SEGMENTS; s++) {
		if (spr_gauge_seg[s] != NULL) {
			SPR_releaseSprite(spr_gauge_seg[s]);
			spr_gauge_seg[s] = NULL;
		}
	}
}
