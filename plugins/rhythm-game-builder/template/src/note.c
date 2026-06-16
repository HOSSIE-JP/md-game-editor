/**
 * note.c - ノートのスポーン、スクロール、判定、レンダリング
 *
 * リズムゲームの中核ロジック:
 * - ノートは画面上端 (NOTE_SPAWN_Y=-16) から下方向へスクロールし、
 *   判定ライン (JUDGE_LINE_Y=184) に向かって移動する
 * - MAX_VISIBLE_NOTES(32) 個の ActiveNote プール（配列）で
 *   ハードウェアスプライトを効率的に管理する
 *
 * ノートスプライト運用:
 *   - 全レーン共通で spr_note（1スプライトシート）を使用
 *   - アニメーション番号で見た目を切替
 *     0:↑ 1:↓ 2:← 3:→ 4:A 5:B 6:C 7:ヒットエフェクト
 */

#include "note.h"

#include <genesis.h>

#include "game_def.h"
#include "rhythm.h"
#include "rhythm_resources.h"

/* ============================================================
 * 静的変数
 * ============================================================ */

static ActiveNote note_pool[MAX_VISIBLE_NOTES];

static const NoteData* chart_notes;
static u16 chart_note_count;
static u16 next_spawn_index;
static u16 notes_judged;
static u16 note_vram_index;

static u8 last_judged_pattern;
static u16 last_judged_duration;

#define SPAWN_LEAD_FRAMES ((JUDGE_LINE_Y - NOTE_SPAWN_Y) / NOTE_SPEED)

static s16 findFreeSlot(void);
static void spawnNote(u16 chart_index);
static void releaseNote(u16 index);

static inline s16 laneToX(u8 lane) { return LANE_X_START + (lane * LANE_WIDTH); }

static bool bg_drawn;
static bool use_image_ui;

#define NOTE_SPRITE_ANIM_UP 0
#define NOTE_SPRITE_ANIM_DOWN 1
#define NOTE_SPRITE_ANIM_LEFT 2
#define NOTE_SPRITE_ANIM_RIGHT 3
#define NOTE_SPRITE_ANIM_A 4
#define NOTE_SPRITE_ANIM_B 5
#define NOTE_SPRITE_ANIM_C 6
#define NOTE_SPRITE_ANIM_HIT_EFFECT 7

/* ============================================================
 * スプライト定義取得
 * ============================================================ */

static u16 laneToAnim(u8 lane) {
	switch (lane) {
		case NOTE_UP:
			return NOTE_SPRITE_ANIM_UP;
		case NOTE_DOWN:
			return NOTE_SPRITE_ANIM_DOWN;
		case NOTE_LEFT:
			return NOTE_SPRITE_ANIM_LEFT;
		case NOTE_RIGHT:
			return NOTE_SPRITE_ANIM_RIGHT;
		case NOTE_A:
			return NOTE_SPRITE_ANIM_A;
		case NOTE_B:
			return NOTE_SPRITE_ANIM_B;
		case NOTE_C:
			return NOTE_SPRITE_ANIM_C;
		default:
			return NOTE_SPRITE_ANIM_UP;
	}
}

/* ============================================================
 * 初期化
 * ============================================================ */

u16 NOTE_init(u16 vram_index) {
	note_vram_index = vram_index;

	for (u16 i = 0; i < MAX_VISIBLE_NOTES; i++) {
		note_pool[i].active = FALSE;
		note_pool[i].judged = FALSE;
		note_pool[i].anim_state = NOTE_ANIM_NORMAL;
		note_pool[i].anim_timer = 0;
		note_pool[i].sprite = NULL;
	}

	chart_notes = NULL;
	chart_note_count = 0;
	next_spawn_index = 0;
	notes_judged = 0;
	bg_drawn = FALSE;
	use_image_ui = FALSE;

	/* PAL1: ノートスプライト用パレット */
	PAL_setPalette(PAL1, spr_note.palette->data, CPU);

	return 0;
}

/* ============================================================
 * 譜面ロード
 * ============================================================ */

void NOTE_loadChart(const ChartInfo* chart, u8 difficulty) {
	if (chart == NULL || difficulty >= DIFF_COUNT) {
		chart_notes = NULL;
		chart_note_count = 0;
		return;
	}

	chart_notes = chart->notes[difficulty];
	chart_note_count = chart->note_count[difficulty];
	next_spawn_index = 0;
	notes_judged = 0;
	bg_drawn = FALSE;

	if (chart_notes == NULL) {
		chart_note_count = 0;
	} else if (chart_note_count > MAX_CHART_NOTES) {
		chart_note_count = MAX_CHART_NOTES;
	}

	for (u16 i = 0; i < MAX_VISIBLE_NOTES; i++) {
		releaseNote(i);
		note_pool[i].judged = FALSE;
	}
}

/* ============================================================
 * ノートプール操作
 * ============================================================ */

static s16 findFreeSlot(void) {
	for (u16 i = 0; i < MAX_VISIBLE_NOTES; i++) {
		if (!note_pool[i].active) return (s16)i;
	}
	return -1;
}

static void spawnNote(u16 chart_index) {
	s16 slot = findFreeSlot();
	if (slot < 0) return;

	const NoteData* nd = &chart_notes[chart_index];
	ActiveNote* an = &note_pool[slot];

	an->y = NOTE_SPAWN_Y;
	an->lane = nd->type;
	an->pattern = nd->pattern;
	an->target_frame = nd->frame;
	an->duration = nd->duration;
	an->chart_index = chart_index;
	an->active = TRUE;
	an->judged = FALSE;
	an->anim_state = NOTE_ANIM_NORMAL;
	an->anim_timer = 0;

	an->sprite = SPR_addSprite(&spr_note, laneToX(an->lane), an->y, TILE_ATTR(PAL1, FALSE, FALSE, FALSE));
	if (an->sprite != NULL) {
		SPR_setVisibility(an->sprite, VISIBLE);
		SPR_setAnimAndFrame(an->sprite, laneToAnim(an->lane), 0);
	}
}

static void releaseNote(u16 index) {
	if (note_pool[index].sprite != NULL) {
		SPR_releaseSprite(note_pool[index].sprite);
		note_pool[index].sprite = NULL;
	}
	note_pool[index].active = FALSE;
	note_pool[index].anim_state = NOTE_ANIM_NORMAL;
	note_pool[index].anim_timer = 0;
}

/* ============================================================
 * 毎フレーム更新
 * ============================================================ */

void NOTE_update(u16 current_frame) {
	if (chart_notes == NULL) return;

	/* スポーン処理 */
	while (next_spawn_index < chart_note_count) {
		const NoteData* nd = &chart_notes[next_spawn_index];
		u16 spawn_frame = (nd->frame > SPAWN_LEAD_FRAMES) ? (nd->frame - SPAWN_LEAD_FRAMES) : 0;
		if (current_frame >= spawn_frame) {
			spawnNote(next_spawn_index);
			next_spawn_index++;
		} else {
			break;
		}
	}

	/* アクティブノートの移動・アニメーション・除去 */
	for (u16 i = 0; i < MAX_VISIBLE_NOTES; i++) {
		if (!note_pool[i].active) continue;

		/* ヒット/ミスアニメーション中のノートはタイマーで管理 */
		if (note_pool[i].anim_state != NOTE_ANIM_NORMAL) {
			if (note_pool[i].anim_timer > 0) {
				note_pool[i].anim_timer--;
			}
			if (note_pool[i].anim_timer == 0) {
				releaseNote(i);
			}
			continue;
		}

		/* 通常ノートのY座標計算 */
		s32 frames_until_judge = (s32)note_pool[i].target_frame - (s32)current_frame;
		note_pool[i].y = JUDGE_LINE_Y - (s16)(frames_until_judge * NOTE_SPEED);

		if (note_pool[i].sprite != NULL) {
			if (note_pool[i].y < -16 || note_pool[i].y >= SCREEN_H + 16) {
				SPR_setVisibility(note_pool[i].sprite, HIDDEN);
			} else {
				SPR_setVisibility(note_pool[i].sprite, VISIBLE);
				SPR_setPosition(note_pool[i].sprite, laneToX(note_pool[i].lane), note_pool[i].y);
			}
		}

		if (note_pool[i].y > SCREEN_H + 32) {
			releaseNote(i);
		}
	}
}

/* ============================================================
 * 描画（背景UIは画像で描画、テキスト不要）
 * ============================================================ */

void NOTE_draw(void) {
	if (bg_drawn) return;
	bg_drawn = TRUE;
}

/* ============================================================
 * 判定
 * ============================================================ */

s8 NOTE_judge(u8 lane, u16 current_frame) {
	s16 best_slot = -1;
	u16 best_diff = 0xFFFF;

	for (u16 i = 0; i < MAX_VISIBLE_NOTES; i++) {
		if (!note_pool[i].active) continue;
		if (note_pool[i].judged) continue;
		if (note_pool[i].lane != lane) continue;

		u16 diff;
		if (current_frame >= note_pool[i].target_frame)
			diff = current_frame - note_pool[i].target_frame;
		else
			diff = note_pool[i].target_frame - current_frame;

		if (diff <= JUDGE_WINDOW_GOOD && diff < best_diff) {
			best_diff = diff;
			best_slot = (s16)i;
		}
	}

	if (best_slot < 0) return -1;

	u8 result;
	if (best_diff <= JUDGE_WINDOW_PERFECT)
		result = JUDGE_PERFECT;
	else if (best_diff <= JUDGE_WINDOW_GREAT)
		result = JUDGE_GREAT;
	else
		result = JUDGE_GOOD;

	last_judged_pattern = note_pool[best_slot].pattern;
	last_judged_duration = note_pool[best_slot].duration;
	note_pool[best_slot].judged = TRUE;

	if (note_pool[best_slot].pattern == PATTERN_TAP) {
		/* ヒットアニメーションに切り替え */
		note_pool[best_slot].anim_state = NOTE_ANIM_HIT;
		note_pool[best_slot].anim_timer = NOTE_HIT_ANIM_FRAMES;
		if (note_pool[best_slot].sprite != NULL) {
			if (spr_note.numAnimation > NOTE_SPRITE_ANIM_HIT_EFFECT) {
				SPR_setAnimAndFrame(note_pool[best_slot].sprite, NOTE_SPRITE_ANIM_HIT_EFFECT, 0);
			}
			SPR_setPosition(note_pool[best_slot].sprite, laneToX(note_pool[best_slot].lane), JUDGE_LINE_Y);
		}
	} else if (note_pool[best_slot].sprite != NULL) {
		/* HOLD/RAPID: スプライト非表示にし追跡継続 */
		SPR_setVisibility(note_pool[best_slot].sprite, HIDDEN);
	}

	notes_judged++;
	return (s8)result;
}

/* ============================================================
 * ミスノート検出
 * ============================================================ */

u16 NOTE_checkMisses(u16 current_frame) {
	u16 miss_count = 0;

	for (u16 i = 0; i < MAX_VISIBLE_NOTES; i++) {
		if (!note_pool[i].active) continue;
		if (note_pool[i].judged) continue;

		if (current_frame > note_pool[i].target_frame + JUDGE_WINDOW_GOOD + 2) {
			note_pool[i].judged = TRUE;
			notes_judged++;
			miss_count++;

			/* ミス時は即解放（統合ノートはヒットエフェクトのみ運用） */
			releaseNote(i);
		}
	}

	return miss_count;
}

/* ============================================================
 * アクセサ・ユーティリティ
 * ============================================================ */

u8 NOTE_getLastJudgedPattern(void) { return last_judged_pattern; }
u16 NOTE_getLastJudgedDuration(void) { return last_judged_duration; }

bool NOTE_isChartComplete(void) {
	if (chart_notes == NULL) return TRUE;
	return (notes_judged >= chart_note_count);
}

void NOTE_release(void) {
	for (u16 i = 0; i < MAX_VISIBLE_NOTES; i++) {
		releaseNote(i);
	}
	chart_notes = NULL;
	chart_note_count = 0;
	bg_drawn = FALSE;
}

u16 NOTE_getTotalCount(void) { return chart_note_count; }
void NOTE_setUseImageUI(bool use_image) { use_image_ui = use_image; }
