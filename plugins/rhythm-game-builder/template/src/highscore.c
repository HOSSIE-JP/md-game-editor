/**
 * @file highscore.c
 * @brief ハイスコア管理モジュール（SRAM永続化）
 *
 * SRAM レイアウト:
 *   offset 0-3 : マジックナンバー (0x4D445248 = "MDRH")
 *   offset 4+  : MAX_SONGS × DIFF_COUNT × 4 バイトのスコアデータ
 */

#include "highscore.h"

#include <genesis.h>

#define HIGHSCORE_MAGIC 0x4D445248

/** ハイスコアのRAMキャッシュ */
static u32 high_scores[MAX_SONGS][DIFF_COUNT];

/** プレイ済みフラグ（SRAM初期値0xFFFFFFFFと区別） */
static bool has_score[MAX_SONGS][DIFF_COUNT];

/** スコアの妥当性上限 */
#define HIGHSCORE_MAX 9999999

/**
 * 指定曲・難易度のSRAMオフセットを算出する。
 */
static u32 sramOffset(u16 song_id, u8 difficulty) { return 4 + ((u32)song_id * DIFF_COUNT + difficulty) * 4; }

void HIGHSCORE_init(void) {
	u16 s;
	u8 d;

	/* キャッシュをクリア */
	for (s = 0; s < MAX_SONGS; s++)
		for (d = 0; d < DIFF_COUNT; d++) {
			high_scores[s][d] = 0;
			has_score[s][d] = FALSE;
		}

	/* SRAMから読み込み */
	SRAM_enable();
	u32 magic = SRAM_readLong(0);
	if (magic == HIGHSCORE_MAGIC) {
		for (s = 0; s < MAX_SONGS; s++) {
			for (d = 0; d < DIFF_COUNT; d++) {
				u32 val = SRAM_readLong(sramOffset(s, d));
				if (val > 0 && val <= HIGHSCORE_MAX) {
					high_scores[s][d] = val;
					has_score[s][d] = TRUE;
				}
				/* val==0 or val>HIGHSCORE_MAX → 未プレイ/不正データ扱い */
			}
		}
	} else {
		/* 初回: SRAM全体を初期化 */
		SRAM_writeLong(0, HIGHSCORE_MAGIC);
		for (s = 0; s < MAX_SONGS; s++)
			for (d = 0; d < DIFF_COUNT; d++) SRAM_writeLong(sramOffset(s, d), 0);
	}
	SRAM_disable();
}

u32 HIGHSCORE_getScore(u16 song_id, u8 difficulty) {
	if (song_id >= MAX_SONGS || difficulty >= DIFF_COUNT) return 0;
	return high_scores[song_id][difficulty];
}

bool HIGHSCORE_hasScore(u16 song_id, u8 difficulty) {
	if (song_id >= MAX_SONGS || difficulty >= DIFF_COUNT) return FALSE;
	return has_score[song_id][difficulty];
}

void HIGHSCORE_updateScore(u16 song_id, u8 difficulty, u32 score) {
	if (song_id >= MAX_SONGS || difficulty >= DIFF_COUNT) return;
	if (score == 0) return;
	if (has_score[song_id][difficulty] && score <= high_scores[song_id][difficulty]) return;

	high_scores[song_id][difficulty] = score;
	has_score[song_id][difficulty] = TRUE;

	/* SRAMへ書き込み */
	SRAM_enable();
	SRAM_writeLong(0, HIGHSCORE_MAGIC);
	SRAM_writeLong(sramOffset(song_id, difficulty), score);
	SRAM_disable();
}
