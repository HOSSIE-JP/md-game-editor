/**
 * draw_sjis.c
 *
 * Shift-JIS の文字描画ライブラリ（8x8 ビットマップフォント用）
 */
#include <utils/draw_sjis.h>
#include "rhythm_resources.h"

/**
 * \brief
 *      日本語文字をBGプレーンに描画する
 */
void draw_sjis_text(u16 plan, const char* str, u16 flags, u16 x, u16 y, u8 use_dma) {
	u16 str_length = strlen(str);			 // バイト数
	u16 pattern = flags & TILE_INDEX_MASK;	 // パターンテーブルの位置
	u16 baseflags = flags & TILE_ATTR_MASK;	 // ネームテーブル登録時にフラグ合成の為に必要
	u16 cursor_x = x;						 // 描画カーソル（文字単位）
	u16 i;

	for (i = 0; i < str_length; i++) {
		u8 c = str[i];

		/* 全角判定（シフトJIS）: 0x81-0x9F, 0xE0-0xEF */
		if ((c >= 0x81 && c <= 0x9F) || (c >= 0xE0 && c <= 0xEF)) {
			u8 c2 = (u8)str[i + 1];

			/*
			 * SJIS → JIS X 0208 変換
			 *   フォント画像は 94×94 タイル (JIS区×点) で配置されている。
			 *   SJIS の1バイト目1値は JIS 2区分（奇数/偶数）に対応。
			 *   2バイト目 < 0x9F → 奇数区,  >= 0x9F → 偶数区。
			 */
			u8 font_row, font_col;

			if (c2 < 0x9F) {
				/* 奇数JIS区 */
				if (c <= 0x9F)
					font_row = (c - 0x81) * 2;			/* 0,2,4,...,60 */
				else
					font_row = (c - 0xE0) * 2 + 62;	/* 62,64,... */

				if (c2 <= 0x7E)
					font_col = c2 - 0x40;				/* 0x40-0x7E → 列0-62 */
				else
					font_col = c2 - 0x41;				/* 0x80-0x9E → 列63-93 (0x7Fスキップ) */
			} else {
				/* 偶数JIS区 */
				if (c <= 0x9F)
					font_row = (c - 0x81) * 2 + 1;		/* 1,3,5,...,61 */
				else
					font_row = (c - 0xE0) * 2 + 63;	/* 63,65,... */

				font_col = c2 - 0x9F;					/* 0x9F-0xFC → 列0-93 */
			}

			/* 8x8フォント: 1タイル = 8 u32, 1行 = 94タイル = 752 u32 */
			int tile_offset = font_col * 8 + font_row * Font_Image_Width;

			VDP_loadTileData(&sjis_font.tiles[tile_offset], pattern, Font_Cell_Size, use_dma);
			VDP_fillTileMapRectInc(plan, baseflags | pattern, cursor_x, y, Font_Cell_Size, Font_Cell_Size);
			pattern += Font_Cell_Size;
			cursor_x++;

			i++; /* 2バイト文字の後方バイトをスキップ */
		} else if (c >= 0x20 && c <= 0x7E) {
			/* ASCII半角: システムフォントのタイルを直接参照 */
			VDP_setTileMapXY(plan, baseflags | (TILE_FONT_INDEX + (c - 0x20)), cursor_x, y);
			cursor_x++;
		}
	}
}

void SJIS_drawText(const char* str, u16 tile_index, u16 x, u16 y) {
	draw_sjis_text(BG_A, str, TILE_ATTR_FULL(PAL0, 0, 0, 0, tile_index), x, y, 0);
}
