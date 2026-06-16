
#include <font.h>
#include <genesis.h>

#ifndef _DRAW_SJIS_H_
#define _DRAW_SJIS_H_

// フォント画像の横幅
#define Font_Image_Width 752

// フォントのセルサイズ（8x8）
#define Font_Cell_Size 1

// 全角先頭Byteの補正値
#define Head_Byte_Offset 129

// 全角後方Byteの補正値
#define Foot_Byte_Offset 64

/**
 *  \brief
 *      Draw japanese text in backgound plan.
 *
 * ソースファイルはShift-JISでエンコードして下さい。
 * 半角文字や第二水準以降の全角文字を使うと空白になります。
 * フォントの画像データを4bppで保存している為、ROMサイズが大きくなってしまう。
 * 5C問題と言われる不具合があり
 * 「ソЫ噂浬欺圭構蚕十申曾箪貼能表暴予禄兔喀媾彌拿杤歃濬畚秉綵臀藹觸軆鐔饅鷭」
 * 上の文字を表示したい場合は「\」を文字の後ろに付けて下さい。
 *
 * 例 : load_sjis_text(APLAN, "ソ\ードオブソ\ダンの能\力表\示",
 * TILE_ATTR_FULL(PAL1, 0, 0, 0, TILE_USER_INDEX), 2, 20, 0);
 *
 *  \param str
 *      String to draw.
 *  \param flags
 *      tile flags (see TILE_ATTR macro).
 *  \param x
 *      X position (in tile).
 *  \param y
 *      y position (in tile).
 *  \param use_dma
 *      Use DMA or software clear.
 *
 *  Using DMA permit faster clear operation but can lock Z80 execution.
 *
 *  This method uses the specified plan to draw the text.<br/>
 *  Each character fit in one tile (8x8 pixels).
 */
void draw_sjis_text(u16 plan, const char* str, u16 flags, u16 x, u16 y, u8 use_dma);

void SJIS_drawText(const char* str, u16 tile_index, u16 x, u16 y);

#endif	// _DRAW_SJIS_H_
