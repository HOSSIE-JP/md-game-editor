#include <genesis.h>
#include "system/audio.h"
#include "generated/audio_data.h"

static bool soundEnabled;
static u8 currentAudio;

void audioInit(bool enabled)
{
    soundEnabled = enabled;
    currentAudio = AUDIO_NONE;
    XGM2_stop();
}

void audioSetEnabled(bool enabled)
{
    if (soundEnabled == enabled)
        return;

    soundEnabled = enabled;
    if (!soundEnabled)
        XGM2_stop();
    currentAudio = AUDIO_NONE;
}

bool audioIsEnabled(void)
{
    return soundEnabled;
}

void audioPlay(u8 audioId)
{
    if (!soundEnabled || (audioId == AUDIO_NONE) || (audioId >= AUDIO_TYPE_COUNT))
        return;
    if (gStgAudioData[audioId] == NULL)
        return;
    if ((currentAudio == audioId) && XGM2_isPlaying())
        return;

    XGM2_setLoopNumber(gStgAudioLoops[audioId] ? -1 : 0);
    XGM2_play(gStgAudioData[audioId]);
    currentAudio = audioId;
}

void audioStop(void)
{
    XGM2_stop();
    currentAudio = AUDIO_NONE;
}

void audioPause(void)
{
    if (soundEnabled && XGM2_isPlaying())
        XGM2_pause();
}

void audioResume(void)
{
    if (soundEnabled && (currentAudio != AUDIO_NONE))
        XGM2_resume();
}

u8 audioGetCurrent(void)
{
    return currentAudio;
}
