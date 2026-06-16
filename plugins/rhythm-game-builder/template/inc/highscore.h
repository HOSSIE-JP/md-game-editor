#ifndef _HIGHSCORE_H_
#define _HIGHSCORE_H_

/**
 * @file highscore.h
 * @brief ハイスコア管理モジュール（SRAM永続化）
 *
 * 曲×難易度ごとのハイスコアをSRAMに保存・読み込みする。
 */

#include <genesis.h>

#include "game_def.h"

/**
 * ハイスコアシステムの初期化。
 * SRAMからハイスコアデータを読み込む。
 * マジックナンバーが合わない場合は全スコアを0に初期化する。
 */
void HIGHSCORE_init(void);

/**
 * 指定曲・難易度のハイスコアを取得する。
 * @param song_id 楽曲インデックス (0?MAX_SONGS-1)
 * @param difficulty 難易度 (DIFF_EASY/NORMAL/HARD)
 * @return ハイスコア値（未プレイの場合0）
 */
u32 HIGHSCORE_getScore(u16 song_id, u8 difficulty);

/**
 * 指定曲・難易度にスコアが記録されているか判定する。
 * @param song_id 楽曲インデックス
 * @param difficulty 難易度
 * @return TRUE=記録あり, FALSE=未プレイ
 */
bool HIGHSCORE_hasScore(u16 song_id, u8 difficulty);

/**
 * ハイスコアを更新する（現在値より高い場合のみ）。
 * 更新時にSRAMへ即座に書き込む。
 * @param song_id 楽曲インデックス
 * @param difficulty 難易度
 * @param score 新しいスコア
 */
void HIGHSCORE_updateScore(u16 song_id, u8 difficulty, u32 score);

#endif /* _HIGHSCORE_H_ */
