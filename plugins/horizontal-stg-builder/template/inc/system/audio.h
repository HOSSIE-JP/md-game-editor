#ifndef HORIZONTAL_STG_AUDIO_H
#define HORIZONTAL_STG_AUDIO_H

#include <genesis.h>

void audioInit(bool enabled);
void audioSetEnabled(bool enabled);
bool audioIsEnabled(void);

void audioPlay(u8 audioId);
void audioStop(void);
void audioPause(void);
void audioResume(void);
u8 audioGetCurrent(void);

#endif
