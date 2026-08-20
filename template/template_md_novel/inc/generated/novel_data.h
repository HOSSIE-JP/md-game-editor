#ifndef MD_NOVEL_GENERATED_DATA_H
#define MD_NOVEL_GENERATED_DATA_H

#include "novel_runtime/novel_runtime.h"

extern const NovelProject gNovelProject;
const Image* novelDataBackground(u16 index);
const SpriteDefinition* novelDataSprite(u16 index);
u16 novelDataSpritePalette(u16 index);
void novelDataPlayBgm(u16 index);
void novelDataPlaySfx(u16 index);

#endif
