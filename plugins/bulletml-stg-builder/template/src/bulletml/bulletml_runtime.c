#include "bulletml/bulletml_runtime.h"
#include "bulletml/bulletml_lut.h"
#include <string.h>

#define BML_OWNER_EMITTER 0
#define BML_OWNER_BULLET 1
#define BML_FRAME_DEPTH 5
#define BML_EXPR_STACK 16
#define BML_GLOBAL_SPRITES 80
#define BML_SCANLINE_PIECES 20
#define BML_SCANLINE_DOTS 320

#define OP_END 0x00
#define OP_WAIT 0x01
#define OP_FIRE 0x02
#define OP_FIRE_REF 0x03
#define OP_REPEAT 0x04
#define OP_VANISH 0x05
#define OP_CHANGE_DIRECTION 0x06
#define OP_CHANGE_SPEED 0x07
#define OP_ACTION_REF 0x08
#define OP_BULLET_META 0x20

typedef signed long long BML_S64;

typedef struct {
    const u8 *pointer;
    const u8 *end;
} BML_Cursor;

typedef struct {
    bool allocated;
    bool active;
    u16 id;
    const u8 *program;
    u16 programLength;
    s16 x64;
    s16 y64;
    u16 direction;
    s16 speed64;
    u16 seed;
    u16 rankQ16;
    const u8 *cachedFirePointer;
    u8 cachedFireMode;
    bool cachedDirectionValid;
    u8 cachedDirectionType;
    s32 cachedDirectionDelta;
    bool cachedSpeedValid;
    u8 cachedSpeedType;
    s16 cachedSpeedDelta64;
} BML_EmitterState;

typedef struct {
    bool active;
    u8 emitterIndex;
    u16 lifetime;
    u8 margin;
    bool occupancyTracked;
    s16 occupancyTop;
    s16 occupancyBottom;
    s16 directionTarget;
    s16 directionQuotient;
    s16 directionRemainder;
    u16 directionTerm;
    u16 directionRemaining;
    u16 directionError;
    s16 speedTarget;
    s16 speedQuotient;
    s16 speedRemainder;
    u16 speedTerm;
    u16 speedRemaining;
    u16 speedError;
} BML_BulletState;

typedef struct {
    const u8 *block;
    u16 length;
    u16 pc;
    s32 params[4];
    u16 repeatRemaining;
    const u8 *repeatBinding;
    s32 repeatParams[4];
} BML_Frame;

typedef struct {
    bool active;
    u16 id;
    u8 ownerType;
    u8 ownerIndex;
    u8 emitterIndex;
    u16 wait;
    s32 sequenceDirection;
    s32 sequenceSpeed;
    bool hasSequenceDirection;
    bool hasSequenceSpeed;
    u8 frameCount;
    BML_Frame frames[BML_FRAME_DEPTH];
} BML_Context;

typedef struct {
    bool valid;
    u8 type;
    s32 value;
} BML_Spec;

static BML_EmitterState emitters[BML_MAX_EMITTERS];
static BML_BulletState bullets[BML_MAX_BULLETS];
static BML_Bullet bulletData[BML_MAX_BULLETS];
static BML_Context *contexts;
static u8 bulletOrder[BML_MAX_BULLETS];
static BML_Metrics metrics;
static s16 playerX64;
static s16 playerY64;
static u16 nextEmitterId;
static u16 nextBulletId;
static u16 nextContextId;
static u8 budgetPieces[BML_SCANLINES];
static u16 budgetDots[BML_SCANLINES];
static u8 bulletPieces[BML_SCANLINES];
static u16 bulletDots[BML_SCANLINES];
static bool displayDelete[BML_MAX_BULLETS];
static BML_BulletState *bulletStateEnd;
static BML_Bullet *bulletDataEnd;
static u8 contextOrder[BML_MAX_CONTEXTS];
static u8 activeContextSlots[BML_MAX_CONTEXTS];
static u16 activeContextSlotCount;
static u16 activeBulletSlotCount;
static u16 activeEmitterSlotCount;

static u16 readU16(const u8 *source) {
    return ((u16) source[0] << 8) | source[1];
}

static s32 readS32(const u8 *source) {
    return (s32) (((u32) source[0] << 24) | ((u32) source[1] << 16) | ((u32) source[2] << 8) | source[3]);
}

static bool cursorByte(BML_Cursor *cursor, u8 *value) {
    if (cursor->pointer >= cursor->end) return FALSE;
    *value = *cursor->pointer++;
    return TRUE;
}

static bool cursorU16(BML_Cursor *cursor, u16 *value) {
    if (cursor->pointer + 2 > cursor->end) return FALSE;
    *value = readU16(cursor->pointer);
    cursor->pointer += 2;
    return TRUE;
}

static u16 normalizeSeed(u16 seed) {
    return seed ? seed : 0xACE1;
}

static u16 nextRandom(u16 seed) {
    u16 value = normalizeSeed(seed);
    value ^= (u16) (value << 7);
    value ^= value >> 9;
    value ^= (u16) (value << 8);
    return value;
}

static s32 qMul(s32 left, s32 right) {
    return (s32) (((BML_S64) left * (BML_S64) right) / 65536);
}

static s32 qDiv(s32 left, s32 right) {
    if (!right) return 0;
    return (s32) (((BML_S64) left * 65536) / right);
}

static s32 evaluateExpression(const u8 *code, u8 length, BML_EmitterState *emitter, const s32 *params) {
    s32 stack[BML_EXPR_STACK];
    u8 depth = 0;
    u8 offset = 0;
    while (offset < length) {
        u8 opcode = code[offset++];
        s32 left;
        s32 right;
        if (opcode == 0) break;
        if (opcode == 1) {
            if (offset + 4 > length || depth >= BML_EXPR_STACK) return 0;
            stack[depth++] = readS32(code + offset);
            offset += 4;
        } else if (opcode == 2) {
            if (depth >= BML_EXPR_STACK) return 0;
            stack[depth++] = emitter->rankQ16;
        } else if (opcode == 3) {
            if (depth >= BML_EXPR_STACK) return 0;
            emitter->seed = nextRandom(emitter->seed);
            stack[depth++] = emitter->seed;
        } else if (opcode >= 0x11 && opcode <= 0x14) {
            if (depth >= BML_EXPR_STACK) return 0;
            stack[depth++] = params[opcode - 0x11];
        } else if (opcode == 0x24) {
            if (!depth) return 0;
            stack[depth - 1] = -stack[depth - 1];
        } else {
            if (depth < 2) return 0;
            right = stack[--depth];
            left = stack[--depth];
            if (opcode == 0x20) stack[depth++] = left + right;
            else if (opcode == 0x21) stack[depth++] = left - right;
            else if (opcode == 0x22) stack[depth++] = qMul(left, right);
            else if (opcode == 0x23) stack[depth++] = qDiv(left, right);
            else return 0;
        }
    }
    return depth ? stack[depth - 1] : 0;
}

static s32 cursorExpression(BML_Cursor *cursor, BML_EmitterState *emitter, const s32 *params) {
    u8 length;
    s32 value;
    if (!cursorByte(cursor, &length) || cursor->pointer + length > cursor->end) return 0;
    if (length == 6 && cursor->pointer[0] == 1 && cursor->pointer[5] == 0) value = readS32(cursor->pointer + 1);
    else value = evaluateExpression(cursor->pointer, length, emitter, params);
    cursor->pointer += length;
    return value;
}

static bool cursorConstantExpression(BML_Cursor *cursor, s32 *value) {
    u8 length;
    if (!cursorByte(cursor, &length) || cursor->pointer + length > cursor->end) return FALSE;
    if (length != 6 || cursor->pointer[0] != 1 || cursor->pointer[5] != 0) return FALSE;
    *value = readS32(cursor->pointer + 1);
    cursor->pointer += length;
    return TRUE;
}

static bool validProgram(const u8 *program, u16 length) {
    if (!program || length < 32) return FALSE;
    if (program[0] != 'B' || program[1] != 'M' || program[2] != 'L' || program[3] != 'B' || program[4] != 1) return FALSE;
    return readU16(program + 8) == length;
}

static bool definitionBlock(BML_EmitterState *emitter, u8 index, const u8 **block, u16 *length) {
    const u8 *entry;
    u16 offset;
    if (!emitter || index >= emitter->program[6]) return FALSE;
    entry = emitter->program + readU16(emitter->program + 10) + ((u16) index * 8);
    if (entry + 8 > emitter->program + emitter->programLength) return FALSE;
    offset = readU16(entry + 2);
    *length = readU16(entry + 4);
    if ((u32) offset + *length > emitter->programLength) return FALSE;
    *block = emitter->program + offset;
    return TRUE;
}

static u16 activeEmitterCount(void) {
    return activeEmitterSlotCount;
}

static u16 activeBulletCount(void) {
    return activeBulletSlotCount;
}

static u16 activeContextCount(void) {
    return activeContextSlotCount;
}

static bool bulletScreenSpan(const BML_Bullet *view, s16 *top, s16 *bottom) {
    s16 clippedTop = (view->y64 / 64) - (view->height / 2);
    s16 clippedBottom = clippedTop + view->height - 1;
    if (clippedBottom < 0 || clippedTop >= BML_SCANLINES) return FALSE;
    if (clippedTop < 0) clippedTop = 0;
    if (clippedBottom >= BML_SCANLINES) clippedBottom = BML_SCANLINES - 1;
    *top = clippedTop;
    *bottom = clippedBottom;
    return TRUE;
}

static void addOccupancy(s16 top, s16 bottom, u8 width) {
    u16 line;
    for (line = (u16) top; line <= (u16) bottom; line++) {
        bulletPieces[line]++;
        bulletDots[line] += width;
    }
}

static void removeOccupancy(s16 top, s16 bottom, u8 width) {
    u16 line;
    for (line = (u16) top; line <= (u16) bottom; line++) {
        bulletPieces[line]--;
        bulletDots[line] -= width;
    }
}

static void trackBulletOccupancy(BML_BulletState *bullet, BML_Bullet *view) {
    s16 top;
    s16 bottom;
    if (!bulletScreenSpan(view, &top, &bottom)) {
        bullet->occupancyTracked = FALSE;
        return;
    }
    addOccupancy(top, bottom, view->width);
    bullet->occupancyTracked = TRUE;
    bullet->occupancyTop = top;
    bullet->occupancyBottom = bottom;
}

static void untrackBulletOccupancy(BML_BulletState *bullet, BML_Bullet *view) {
    if (!bullet->occupancyTracked) return;
    removeOccupancy(bullet->occupancyTop, bullet->occupancyBottom, view->width);
    bullet->occupancyTracked = FALSE;
}

static void updateBulletOccupancy(BML_BulletState *bullet, BML_Bullet *view) {
    s16 top;
    s16 bottom;
    s16 oldTop;
    s16 oldBottom;
    if (!bulletScreenSpan(view, &top, &bottom)) {
        untrackBulletOccupancy(bullet, view);
        return;
    }
    if (!bullet->occupancyTracked) {
        trackBulletOccupancy(bullet, view);
        return;
    }
    oldTop = bullet->occupancyTop;
    oldBottom = bullet->occupancyBottom;
    if (top > oldBottom || bottom < oldTop) {
        removeOccupancy(oldTop, oldBottom, view->width);
        addOccupancy(top, bottom, view->width);
    } else {
        if (top > oldTop) removeOccupancy(oldTop, top - 1, view->width);
        else if (top < oldTop) addOccupancy(top, oldTop - 1, view->width);
        if (bottom < oldBottom) removeOccupancy(bottom + 1, oldBottom, view->width);
        else if (bottom > oldBottom) addOccupancy(oldBottom + 1, bottom, view->width);
    }
    bullet->occupancyTop = top;
    bullet->occupancyBottom = bottom;
}

static void deactivateContext(BML_Context *context) {
    u16 slot;
    u16 index;
    if (!context || !context->active) return;
    slot = (u16) (context - contexts);
    context->active = FALSE;
    for (index = 0; index < activeContextSlotCount; index++) {
        if (activeContextSlots[index] == slot) {
            for (; index + 1 < activeContextSlotCount; index++) activeContextSlots[index] = activeContextSlots[index + 1];
            activeContextSlotCount--;
            return;
        }
    }
}

static void deactivateBullet(BML_BulletState *bullet) {
    u16 slot;
    u16 lastSlot;
    u16 index;
    if (!bullet || !bullet->active) return;
    slot = (u16) (bullet - bullets);
    untrackBulletOccupancy(bullet, &bulletData[slot]);
    index = 0;
    while (index < activeContextSlotCount) {
        BML_Context *context = &contexts[activeContextSlots[index]];
        if (context->ownerType == BML_OWNER_BULLET && context->ownerIndex == slot) deactivateContext(context);
        else index++;
    }
    for (index = 0; index < activeBulletSlotCount; index++) {
        if (bulletOrder[index] == slot) {
            for (; index + 1 < activeBulletSlotCount; index++) bulletOrder[index] = bulletOrder[index + 1];
            break;
        }
    }
    activeBulletSlotCount--;
    lastSlot = activeBulletSlotCount;
    bulletStateEnd = &bullets[lastSlot];
    bulletDataEnd = &bulletData[lastSlot];
    if (slot != lastSlot) {
        bullets[slot] = bullets[lastSlot];
        bulletData[slot] = bulletData[lastSlot];
        for (index = 0; index < activeContextSlotCount; index++) {
            BML_Context *context = &contexts[activeContextSlots[index]];
            if (context->ownerType == BML_OWNER_BULLET && context->ownerIndex == lastSlot) context->ownerIndex = (u8) slot;
        }
        for (index = 0; index < activeBulletSlotCount; index++) {
            if (bulletOrder[index] == lastSlot) bulletOrder[index] = (u8) slot;
        }
    }
    memset(&bullets[lastSlot], 0, sizeof(bullets[lastSlot]));
    memset(&bulletData[lastSlot], 0, sizeof(bulletData[lastSlot]));
}

static s16 freeBulletSlot(void) {
    return activeBulletSlotCount < BML_MAX_BULLETS ? (s16) activeBulletSlotCount : -1;
}

static s16 freeContextSlot(void) {
    u16 index;
    if (!contexts) return -1;
    for (index = 0; index < BML_MAX_CONTEXTS; index++) if (!contexts[index].active) return (s16) index;
    return -1;
}

static bool readParams(BML_Cursor *cursor, BML_EmitterState *emitter, const s32 *parentParams, s32 *result) {
    u8 count;
    u8 index;
    if (!cursorByte(cursor, &count) || count > 4) return FALSE;
    for (index = 0; index < 4; index++) result[index] = 0;
    for (index = 0; index < count; index++) result[index] = cursorExpression(cursor, emitter, parentParams);
    return TRUE;
}

static bool pushActionBinding(BML_Context *context, const u8 *binding, const s32 *parentParams, u16 repeatRemaining) {
    BML_Cursor cursor;
    BML_Frame *frame;
    BML_EmitterState *emitter = &emitters[context->emitterIndex];
    const u8 *block;
    u16 length;
    u8 mode;
    u8 definition;
    u8 index;
    s32 nextParams[4];
    if (context->frameCount >= BML_FRAME_DEPTH) return FALSE;
    cursor.pointer = binding;
    cursor.end = emitter->program + emitter->programLength;
    if (!cursorByte(&cursor, &mode)) return FALSE;
    if (mode == 0) {
        if (!cursorByte(&cursor, &definition) || !readParams(&cursor, emitter, parentParams, nextParams)) return FALSE;
        if (!definitionBlock(emitter, definition, &block, &length)) return FALSE;
    } else if (mode == 1) {
        if (!cursorU16(&cursor, &length) || cursor.pointer + length > cursor.end) return FALSE;
        block = cursor.pointer;
        for (index = 0; index < 4; index++) nextParams[index] = parentParams[index];
    } else return FALSE;
    frame = &context->frames[context->frameCount++];
    memset(frame, 0, sizeof(*frame));
    frame->block = block;
    frame->length = length;
    frame->repeatRemaining = repeatRemaining;
    frame->repeatBinding = repeatRemaining ? binding : NULL;
    for (index = 0; index < 4; index++) {
        frame->params[index] = nextParams[index];
        frame->repeatParams[index] = parentParams[index];
    }
    return TRUE;
}

static BML_Context *createContext(u8 ownerType, u8 ownerIndex, u8 emitterIndex, const u8 *block, u16 length, const s32 *params) {
    s16 slot = freeContextSlot();
    BML_Context *context;
    u8 index;
    if (slot < 0) {
        metrics.contextDrops++;
        return NULL;
    }
    context = &contexts[slot];
    memset(context, 0, sizeof(*context));
    context->active = TRUE;
    context->id = nextContextId++;
    context->ownerType = ownerType;
    context->ownerIndex = ownerIndex;
    context->emitterIndex = emitterIndex;
    context->frameCount = 1;
    context->frames[0].block = block;
    context->frames[0].length = length;
    for (index = 0; index < 4; index++) context->frames[0].params[index] = params[index];
    activeContextSlots[activeContextSlotCount++] = (u8) slot;
    return context;
}

static bool ownerState(BML_Context *context, s16 *x64, s16 *y64, u16 *direction, s16 *speed64) {
    if (context->ownerType == BML_OWNER_EMITTER) {
        BML_EmitterState *emitter = &emitters[context->ownerIndex];
        if (!emitter->active) return FALSE;
        *x64 = emitter->x64; *y64 = emitter->y64; *direction = emitter->direction; *speed64 = emitter->speed64;
        return TRUE;
    }
    if (!bullets[context->ownerIndex].active) return FALSE;
    *x64 = bulletData[context->ownerIndex].x64;
    *y64 = bulletData[context->ownerIndex].y64;
    *direction = bulletData[context->ownerIndex].direction;
    *speed64 = bulletData[context->ownerIndex].speed64;
    return TRUE;
}

static u16 aimTurn(s16 x64, s16 y64) {
    s32 dx = (s32) playerX64 - x64;
    s32 dy = (s32) playerY64 - y64;
    u32 ax = dx < 0 ? (u32) -dx : (u32) dx;
    u32 ay = dy < 0 ? (u32) -dy : (u32) dy;
    u16 angle;
    u16 ratio;
    if (!ax && !ay) return 0;
    if (ay >= ax) {
        ratio = (u16) ((ax * 255) / (ay ? ay : 1));
        angle = BML_atanTurn[ratio];
    } else {
        ratio = (u16) ((ay * 255) / (ax ? ax : 1));
        angle = 0x4000 - BML_atanTurn[ratio];
    }
    if (dy < 0) return dx >= 0 ? angle : (u16) (0 - angle);
    return dx >= 0 ? (u16) (0x8000 - angle) : (u16) (0x8000 + angle);
}

static BML_Spec readSpec(BML_Cursor *cursor, BML_EmitterState *emitter, const s32 *params) {
    BML_Spec result;
    u8 type;
    result.valid = FALSE; result.type = 0; result.value = 0;
    if (!cursorByte(cursor, &type)) return result;
    if (type == 0xFF) return result;
    result.valid = TRUE;
    result.type = type;
    result.value = cursorExpression(cursor, emitter, params);
    return result;
}

static bool readConstantSpec(BML_Cursor *cursor, bool *valid, u8 *type, s32 *value) {
    u8 encodedType;
    *valid = FALSE;
    *type = 0;
    *value = 0;
    if (!cursorByte(cursor, &encodedType)) return FALSE;
    if (encodedType == 0xFF) return TRUE;
    if (!cursorConstantExpression(cursor, value)) return FALSE;
    *valid = TRUE;
    *type = encodedType;
    return TRUE;
}

static u16 directionDeltaValue(bool valid, u8 type, s32 delta, BML_Context *context, s16 x64, s16 y64, u16 current) {
    s32 result;
    if (!valid) return current;
    if (type == 0) result = aimTurn(x64, y64) + delta;
    else if (type == 1) result = delta;
    else if (type == 2) result = current + delta;
    else {
        result = (context->hasSequenceDirection ? context->sequenceDirection : current) + delta;
        context->sequenceDirection = result & 0xFFFF;
        context->hasSequenceDirection = TRUE;
    }
    return (u16) result;
}

static u16 directionValue(BML_Spec spec, BML_Context *context, s16 x64, s16 y64, u16 current) {
    return directionDeltaValue(spec.valid, spec.type, spec.value / 360, context, x64, y64, current);
}

static s16 speedDeltaValue(bool valid, u8 type, s16 delta, BML_Context *context, s16 current) {
    s32 result;
    if (!valid) return current;
    if (type == 0) result = delta;
    else if (type == 1) result = current + delta;
    else {
        result = (context->hasSequenceSpeed ? context->sequenceSpeed : current) + delta;
        context->sequenceSpeed = result;
        context->hasSequenceSpeed = TRUE;
    }
    if (result < -32768) result = -32768;
    if (result > 32767) result = 32767;
    return (s16) result;
}

static s16 speedValue(BML_Spec spec, BML_Context *context, s16 current) {
    return speedDeltaValue(spec.valid, spec.type, (s16) ((spec.value * 64) / 65536), context, current);
}

static bool parseBulletBinding(BML_Cursor *cursor, BML_Context *context, const s32 *parentParams, const u8 **block, u16 *length, s32 *params) {
    BML_EmitterState *emitter = &emitters[context->emitterIndex];
    u8 mode;
    u8 definition;
    u8 index;
    if (!cursorByte(cursor, &mode)) return FALSE;
    if (mode == 0) {
        if (!cursorByte(cursor, &definition) || !readParams(cursor, emitter, parentParams, params)) return FALSE;
        return definitionBlock(emitter, definition, block, length);
    }
    if (mode != 1 || !cursorU16(cursor, length) || cursor->pointer + *length > cursor->end) return FALSE;
    *block = cursor->pointer;
    cursor->pointer += *length;
    for (index = 0; index < 4; index++) params[index] = parentParams[index];
    return TRUE;
}

static bool cacheSimpleFire(BML_Context *context, const u8 *firePointer, BML_Cursor cursor) {
    BML_EmitterState *emitter = &emitters[context->emitterIndex];
    bool fireDirectionValid;
    bool fireSpeedValid;
    bool bulletDirectionValid;
    bool bulletSpeedValid;
    u8 fireDirectionType;
    u8 fireSpeedType;
    u8 bulletDirectionType;
    u8 bulletSpeedType;
    s32 fireDirectionValue;
    s32 fireSpeedValue;
    s32 bulletDirectionValue;
    s32 bulletSpeedValue;
    const u8 *bulletBlock;
    u16 bulletLength;
    BML_Cursor metaCursor;
    u8 mode;
    u8 definition;
    u8 paramCount;
    u8 actionCount;
    bool chosenDirectionValid;
    bool chosenSpeedValid;
    u8 chosenDirectionType;
    u8 chosenSpeedType;
    s32 chosenDirectionValue;
    s32 chosenSpeedValue;
    emitter->cachedFirePointer = firePointer;
    emitter->cachedFireMode = 2;
    if (!readConstantSpec(&cursor, &fireDirectionValid, &fireDirectionType, &fireDirectionValue)
        || !readConstantSpec(&cursor, &fireSpeedValid, &fireSpeedType, &fireSpeedValue)
        || !cursorByte(&cursor, &mode)) return FALSE;
    if (mode == 0) {
        if (!cursorByte(&cursor, &definition) || !cursorByte(&cursor, &paramCount) || paramCount
            || !definitionBlock(emitter, definition, &bulletBlock, &bulletLength)) return FALSE;
    } else if (mode == 1) {
        if (!cursorU16(&cursor, &bulletLength) || cursor.pointer + bulletLength > cursor.end) return FALSE;
        bulletBlock = cursor.pointer;
    } else return FALSE;
    if (bulletLength < 2 || bulletBlock[0] != OP_BULLET_META || bulletBlock[1] + 2 > bulletLength) return FALSE;
    metaCursor.pointer = bulletBlock + 2;
    metaCursor.end = metaCursor.pointer + bulletBlock[1];
    if (!readConstantSpec(&metaCursor, &bulletDirectionValid, &bulletDirectionType, &bulletDirectionValue)
        || !readConstantSpec(&metaCursor, &bulletSpeedValid, &bulletSpeedType, &bulletSpeedValue)
        || !cursorByte(&metaCursor, &actionCount) || actionCount) return FALSE;
    chosenDirectionValid = fireDirectionValid || bulletDirectionValid;
    chosenDirectionType = fireDirectionValid ? fireDirectionType : bulletDirectionType;
    chosenDirectionValue = fireDirectionValid ? fireDirectionValue : bulletDirectionValue;
    chosenSpeedValid = fireSpeedValid || bulletSpeedValid;
    chosenSpeedType = fireSpeedValid ? fireSpeedType : bulletSpeedType;
    chosenSpeedValue = fireSpeedValid ? fireSpeedValue : bulletSpeedValue;
    emitter->cachedDirectionValid = chosenDirectionValid;
    emitter->cachedDirectionType = chosenDirectionType;
    emitter->cachedDirectionDelta = chosenDirectionValid ? chosenDirectionValue / 360 : 0;
    emitter->cachedSpeedValid = chosenSpeedValid;
    emitter->cachedSpeedType = chosenSpeedType;
    emitter->cachedSpeedDelta64 = chosenSpeedValid ? (s16) ((chosenSpeedValue * 64) / 65536) : 0;
    emitter->cachedFireMode = 1;
    return TRUE;
}

static u16 spawnCachedFireBatch(BML_Context *context, s16 ownerX, s16 ownerY, u16 ownerDirection, s16 ownerSpeed, u16 requested) {
    BML_EmitterState *emitter = &emitters[context->emitterIndex];
    u16 spawnCapacity = BML_MAX_SPAWNS_PER_FRAME - metrics.spawnedThisFrame;
    u16 poolCapacity = BML_MAX_BULLETS - activeBulletSlotCount;
    u16 accepted;
    u16 rejected;
    u16 index;
    u16 baseSlot = activeBulletSlotCount;
    u16 lifetime = readU16(emitter->program + 14);
    BML_BulletState *bullet = bulletStateEnd;
    BML_Bullet *view = bulletDataEnd;
    bool poolLimitsFirst = poolCapacity < spawnCapacity;
    if (!requested) return 0;
    accepted = requested;
    if (accepted > spawnCapacity) accepted = spawnCapacity;
    if (accepted > poolCapacity) accepted = poolCapacity;
    rejected = requested - accepted;
    for (index = 0; index < accepted; index++, bullet++, view++) {
        bullet->active = TRUE;
        bullet->emitterIndex = context->emitterIndex;
        view->id = nextBulletId++;
        view->x64 = ownerX;
        view->y64 = ownerY;
        view->direction = directionDeltaValue(emitter->cachedDirectionValid, emitter->cachedDirectionType, emitter->cachedDirectionDelta, context, ownerX, ownerY, ownerDirection);
        view->speed64 = speedDeltaValue(emitter->cachedSpeedValid, emitter->cachedSpeedType, emitter->cachedSpeedDelta64, context, ownerSpeed);
        view->hitboxRadius = emitter->program[17];
        view->hitboxX = (s8) emitter->program[18];
        view->hitboxY = (s8) emitter->program[19];
        view->width = emitter->program[20];
        view->height = emitter->program[21];
        view->visible = TRUE;
        bullet->lifetime = lifetime;
        bullet->margin = emitter->program[16];
        bulletOrder[baseSlot + index] = (u8) (baseSlot + index);
    }
    activeBulletSlotCount += accepted;
    bulletStateEnd = bullet;
    bulletDataEnd = view;
    metrics.spawnedThisFrame += accepted;
    metrics.spawned += accepted;
    if (rejected) {
        if (poolLimitsFirst) metrics.poolDrops += rejected;
        else metrics.spawnDrops += rejected;
        metrics.fireDrops += rejected;
    }
    return accepted;
}

static bool spawnCachedFire(BML_Context *context, s16 ownerX, s16 ownerY, u16 ownerDirection, s16 ownerSpeed) {
    return spawnCachedFireBatch(context, ownerX, ownerY, ownerDirection, ownerSpeed, 1) == 1;
}

static bool spawnFire(BML_Context *context, BML_Cursor *cursor, const s32 *params, s16 ownerX, s16 ownerY, u16 ownerDirection, s16 ownerSpeed) {
    BML_EmitterState *emitter = &emitters[context->emitterIndex];
    const u8 *firePointer = cursor->pointer;
    BML_Spec fireDirection;
    BML_Spec fireSpeed;
    const u8 *bulletBlock;
    u16 bulletLength;
    s32 bulletParams[4];
    BML_Cursor metaCursor;
    BML_Spec bulletDirection;
    BML_Spec bulletSpeed;
    const u8 *actionBindings[2];
    u8 actionCount;
    u8 index;
    s16 slot;
    BML_BulletState *bullet;
    BML_Bullet *view;
    if (emitter->cachedFirePointer != firePointer) cacheSimpleFire(context, firePointer, *cursor);
    if (emitter->cachedFirePointer == firePointer && emitter->cachedFireMode == 1) return spawnCachedFire(context, ownerX, ownerY, ownerDirection, ownerSpeed);
    fireDirection = readSpec(cursor, emitter, params);
    fireSpeed = readSpec(cursor, emitter, params);
    if (!parseBulletBinding(cursor, context, params, &bulletBlock, &bulletLength, bulletParams)) return FALSE;
    if (bulletLength < 2 || bulletBlock[0] != OP_BULLET_META || bulletBlock[1] + 2 > bulletLength) return FALSE;
    metaCursor.pointer = bulletBlock + 2;
    metaCursor.end = metaCursor.pointer + bulletBlock[1];
    bulletDirection = readSpec(&metaCursor, emitter, bulletParams);
    bulletSpeed = readSpec(&metaCursor, emitter, bulletParams);
    if (!cursorByte(&metaCursor, &actionCount) || actionCount > 2) return FALSE;
    for (index = 0; index < actionCount; index++) {
        u8 mode;
        u16 inlineLength;
        actionBindings[index] = metaCursor.pointer;
        if (!cursorByte(&metaCursor, &mode)) return FALSE;
        if (mode == 0) {
            u8 definition;
            u8 paramCount;
            if (!cursorByte(&metaCursor, &definition) || !cursorByte(&metaCursor, &paramCount) || paramCount > 4) return FALSE;
            while (paramCount--) {
                u8 exprLength;
                if (!cursorByte(&metaCursor, &exprLength) || metaCursor.pointer + exprLength > metaCursor.end) return FALSE;
                metaCursor.pointer += exprLength;
            }
        } else if (mode == 1) {
            if (!cursorU16(&metaCursor, &inlineLength) || metaCursor.pointer + inlineLength > metaCursor.end) return FALSE;
            metaCursor.pointer += inlineLength;
        } else return FALSE;
    }
    if (metrics.spawnedThisFrame >= BML_MAX_SPAWNS_PER_FRAME) { metrics.spawnDrops++; metrics.fireDrops++; return FALSE; }
    slot = freeBulletSlot();
    if (slot < 0) { metrics.poolDrops++; metrics.fireDrops++; return FALSE; }
    if (activeContextCount() + actionCount > BML_MAX_CONTEXTS) { metrics.contextDrops += actionCount; metrics.fireDrops++; return FALSE; }
    bullet = bulletStateEnd;
    memset(bullet, 0, sizeof(*bullet));
    view = bulletDataEnd;
    memset(view, 0, sizeof(*view));
    bullet->active = TRUE;
    bullet->emitterIndex = context->emitterIndex;
    view->id = nextBulletId++;
    view->x64 = ownerX;
    view->y64 = ownerY;
    view->direction = directionValue(fireDirection.valid ? fireDirection : bulletDirection, context, ownerX, ownerY, ownerDirection);
    view->speed64 = speedValue(fireSpeed.valid ? fireSpeed : bulletSpeed, context, ownerSpeed);
    view->hitboxRadius = emitter->program[17];
    view->hitboxX = (s8) emitter->program[18];
    view->hitboxY = (s8) emitter->program[19];
    view->width = emitter->program[20];
    view->height = emitter->program[21];
    view->visible = TRUE;
    bullet->lifetime = readU16(emitter->program + 14);
    bullet->margin = emitter->program[16];
    for (index = 0; index < actionCount; index++) {
        BML_Context *newContext;
        BML_Cursor bindingCursor;
        const u8 *actionBlock = NULL;
        u16 actionLength = 0;
        s32 actionParams[4];
        u8 mode = 0;
        u8 definition = 0;
        u8 paramIndex;
        bindingCursor.pointer = actionBindings[index];
        bindingCursor.end = emitter->program + emitter->programLength;
        if (!cursorByte(&bindingCursor, &mode)) { bullet->active = FALSE; return FALSE; }
        if (mode == 0) {
            if (!cursorByte(&bindingCursor, &definition)) { bullet->active = FALSE; return FALSE; }
            if (!readParams(&bindingCursor, emitter, bulletParams, actionParams) || !definitionBlock(emitter, definition, &actionBlock, &actionLength)) { bullet->active = FALSE; return FALSE; }
        } else if (mode == 1) {
            if (!cursorU16(&bindingCursor, &actionLength) || bindingCursor.pointer + actionLength > bindingCursor.end) { bullet->active = FALSE; return FALSE; }
            actionBlock = bindingCursor.pointer;
            for (paramIndex = 0; paramIndex < 4; paramIndex++) actionParams[paramIndex] = bulletParams[paramIndex];
        } else { bullet->active = FALSE; return FALSE; }
        newContext = createContext(BML_OWNER_BULLET, (u8) slot, context->emitterIndex, actionBlock, actionLength, actionParams);
        if (!newContext) { bullet->active = FALSE; return FALSE; }
    }
    bulletOrder[activeBulletSlotCount++] = (u8) slot;
    bulletStateEnd++;
    bulletDataEnd++;
    metrics.spawnedThisFrame++;
    metrics.spawned++;
    return TRUE;
}

static void finishFrame(BML_Context *context) {
    BML_Frame *finished;
    const u8 *repeatBinding;
    s32 repeatParams[4];
    u16 repeatRemaining;
    u8 index;
    if (!context->frameCount) { deactivateContext(context); return; }
    finished = &context->frames[context->frameCount - 1];
    if (finished->repeatRemaining > 1 && finished->repeatBinding && finished->repeatBinding[0] == 1) {
        finished->repeatRemaining--;
        finished->pc = 0;
        return;
    }
    repeatBinding = finished->repeatBinding;
    repeatRemaining = finished->repeatRemaining;
    if (repeatRemaining > 1) for (index = 0; index < 4; index++) repeatParams[index] = finished->repeatParams[index];
    context->frameCount--;
    if (repeatRemaining > 1) {
        if (!pushActionBinding(context, repeatBinding, repeatParams, repeatRemaining - 1)) deactivateContext(context);
    }
    if (!context->frameCount) deactivateContext(context);
}

static void startDirectionChange(BML_BulletState *bullet, BML_Bullet *view, u16 target, u16 term) {
    s32 delta = (s16) (target - view->direction);
    bullet->directionTarget = (s16) target;
    bullet->directionTerm = term;
    bullet->directionRemaining = term;
    bullet->directionQuotient = (s16) (delta / term);
    bullet->directionRemainder = (s16) (delta - ((s32) bullet->directionQuotient * term));
    bullet->directionError = 0;
}

static void startSpeedChange(BML_BulletState *bullet, BML_Bullet *view, s16 target, u16 term) {
    s32 delta = (s32) target - view->speed64;
    bullet->speedTarget = target;
    bullet->speedTerm = term;
    bullet->speedRemaining = term;
    bullet->speedQuotient = (s16) (delta / term);
    bullet->speedRemainder = (s16) (delta - ((s32) bullet->speedQuotient * term));
    bullet->speedError = 0;
}

static void processContext(BML_Context *context) {
    BML_EmitterState *emitter = &emitters[context->emitterIndex];
    s16 ownerX;
    s16 ownerY;
    s16 ownerSpeed;
    u16 ownerDirection;
    if (!context->active || !ownerState(context, &ownerX, &ownerY, &ownerDirection, &ownerSpeed)) { deactivateContext(context); return; }
    if (context->wait) { context->wait--; return; }
    while (context->active && metrics.opcodesThisFrame < BML_MAX_OPCODES_PER_FRAME) {
        BML_Frame *frame;
        const u8 *instruction;
        u8 opcode;
        u8 payloadLength;
        BML_Cursor cursor;
        if (!context->frameCount) { deactivateContext(context); break; }
        frame = &context->frames[context->frameCount - 1];
        if (frame->pc + 2 > frame->length) { deactivateContext(context); break; }
        instruction = frame->block + frame->pc;
        opcode = instruction[0];
        payloadLength = instruction[1];
        if ((u32) frame->pc + 2 + payloadLength > frame->length) { deactivateContext(context); break; }
        frame->pc += 2 + payloadLength;
        if (opcode == OP_END) { finishFrame(context); continue; }
        cursor.pointer = instruction + 2;
        cursor.end = cursor.pointer + payloadLength;
        metrics.opcodesThisFrame++;
        metrics.lastOpcode = opcode;
        if (opcode == OP_WAIT) {
            s32 value = cursorExpression(&cursor, emitter, frame->params) / 65536;
            if (value < 0) value = 0;
            if (value > 65535) value = 65535;
            context->wait = (u16) value;
            if (context->wait) break;
        } else if (opcode == OP_FIRE) {
            spawnFire(context, &cursor, frame->params, ownerX, ownerY, ownerDirection, ownerSpeed);
            if (emitter->cachedFireMode == 1
                && frame->repeatRemaining > 1
                && frame->repeatBinding
                && frame->repeatBinding[0] == 1
                && frame->pc + 2 == frame->length
                && frame->block[frame->pc] == OP_END
                && frame->block[frame->pc + 1] == 0) {
                u16 remaining = frame->repeatRemaining - 1;
                u16 executable = BML_MAX_OPCODES_PER_FRAME - metrics.opcodesThisFrame;
                if (executable > remaining) executable = remaining;
                if (executable) {
                    metrics.opcodesThisFrame += executable;
                    metrics.lastOpcode = OP_FIRE;
                    spawnCachedFireBatch(context, ownerX, ownerY, ownerDirection, ownerSpeed, executable);
                    remaining -= executable;
                }
                if (!remaining) frame->repeatRemaining = 1;
                else {
                    frame->repeatRemaining = remaining;
                    frame->pc = 0;
                    break;
                }
            }
        } else if (opcode == OP_FIRE_REF) {
            u8 definition;
            s32 fireParams[4];
            const u8 *block;
            u16 length;
            if (cursorByte(&cursor, &definition) && readParams(&cursor, emitter, frame->params, fireParams) && definitionBlock(emitter, definition, &block, &length) && length >= 2 && block[0] == OP_FIRE) {
                BML_Cursor fireCursor;
                fireCursor.pointer = block + 2; fireCursor.end = fireCursor.pointer + block[1];
                spawnFire(context, &fireCursor, fireParams, ownerX, ownerY, ownerDirection, ownerSpeed);
            }
        } else if (opcode == OP_REPEAT) {
            s32 times = cursorExpression(&cursor, emitter, frame->params) / 65536;
            const u8 *binding = cursor.pointer;
            if (times < 0) times = 0;
            if (times > 65535) times = 65535;
            if (times && !pushActionBinding(context, binding, frame->params, (u16) times)) deactivateContext(context);
        } else if (opcode == OP_ACTION_REF) {
            u8 definition;
            s32 actionParams[4];
            const u8 *block;
            u16 length;
            if (!cursorByte(&cursor, &definition) || !readParams(&cursor, emitter, frame->params, actionParams) || !definitionBlock(emitter, definition, &block, &length)) deactivateContext(context);
            else {
                BML_Frame *next;
                u8 index;
                if (context->frameCount >= BML_FRAME_DEPTH) deactivateContext(context);
                else {
                    next = &context->frames[context->frameCount++]; memset(next, 0, sizeof(*next)); next->block = block; next->length = length;
                    for (index = 0; index < 4; index++) next->params[index] = actionParams[index];
                }
            }
        } else if (opcode == OP_VANISH) {
            if (context->ownerType == BML_OWNER_BULLET) deactivateBullet(&bullets[context->ownerIndex]);
            deactivateContext(context);
        } else if (opcode == OP_CHANGE_DIRECTION && context->ownerType == BML_OWNER_BULLET) {
            BML_Spec spec = readSpec(&cursor, emitter, frame->params);
            s32 termValue = cursorExpression(&cursor, emitter, frame->params) / 65536;
            u16 target = directionValue(spec, context, ownerX, ownerY, ownerDirection);
            u16 term = (u16) (termValue < 1 ? 1 : termValue > 65535 ? 65535 : termValue);
            startDirectionChange(&bullets[context->ownerIndex], &bulletData[context->ownerIndex], target, term);
        } else if (opcode == OP_CHANGE_SPEED && context->ownerType == BML_OWNER_BULLET) {
            BML_Spec spec = readSpec(&cursor, emitter, frame->params);
            s32 termValue = cursorExpression(&cursor, emitter, frame->params) / 65536;
            s16 target = speedValue(spec, context, ownerSpeed);
            u16 term = (u16) (termValue < 1 ? 1 : termValue > 65535 ? 65535 : termValue);
            startSpeedChange(&bullets[context->ownerIndex], &bulletData[context->ownerIndex], target, term);
        } else deactivateContext(context);
    }
}

static void interpolateDirection(BML_BulletState *bullet, BML_Bullet *view) {
    s16 step;
    if (!bullet->directionRemaining) return;
    step = bullet->directionQuotient;
    bullet->directionError += bullet->directionRemainder < 0 ? -bullet->directionRemainder : bullet->directionRemainder;
    if (bullet->directionError >= bullet->directionTerm) {
        step += bullet->directionRemainder < 0 ? -1 : 1;
        bullet->directionError -= bullet->directionTerm;
    }
    view->direction += step;
    bullet->directionRemaining--;
    if (!bullet->directionRemaining) view->direction = (u16) bullet->directionTarget;
}

static void interpolateSpeed(BML_BulletState *bullet, BML_Bullet *view) {
    s16 step;
    if (!bullet->speedRemaining) return;
    step = bullet->speedQuotient;
    bullet->speedError += bullet->speedRemainder < 0 ? -bullet->speedRemainder : bullet->speedRemainder;
    if (bullet->speedError >= bullet->speedTerm) {
        step += bullet->speedRemainder < 0 ? -1 : 1;
        bullet->speedError -= bullet->speedTerm;
    }
    view->speed64 += step;
    bullet->speedRemaining--;
    if (!bullet->speedRemaining) view->speed64 = bullet->speedTarget;
}

static void cleanupContexts(void) {
    u16 index = 0;
    while (index < activeContextSlotCount) {
        BML_Context *context = &contexts[activeContextSlots[index]];
        if (context->ownerType == BML_OWNER_BULLET && !bullets[context->ownerIndex].active) deactivateContext(context);
        else index++;
    }
}

static void releaseEmitters(void) {
    u16 emitterIndex;
    u16 index;
    if (activeEmitterSlotCount == BML_MAX_EMITTERS) return;
    for (emitterIndex = 0; emitterIndex < BML_MAX_EMITTERS; emitterIndex++) {
        bool retained = FALSE;
        if (!emitters[emitterIndex].allocated || emitters[emitterIndex].active) continue;
        for (index = 0; index < activeBulletSlotCount; index++) {
            if (bullets[index].emitterIndex == emitterIndex) { retained = TRUE; break; }
        }
        if (!retained) {
            for (index = 0; index < activeContextSlotCount; index++) {
                if (contexts[activeContextSlots[index]].emitterIndex == emitterIndex) { retained = TRUE; break; }
            }
        }
        if (!retained) emitters[emitterIndex].allocated = FALSE;
    }
}

static void updateHighWater(void) {
    metrics.bullets = activeBulletCount();
    metrics.emitters = activeEmitterCount();
    metrics.contexts = activeContextCount();
    if (metrics.bullets > metrics.maxBullets) metrics.maxBullets = metrics.bullets;
    if (metrics.emitters > metrics.maxEmitters) metrics.maxEmitters = metrics.emitters;
    if (metrics.contexts > metrics.maxContexts) metrics.maxContexts = metrics.contexts;
}

static u16 orderActiveBullets(void) {
    return activeBulletSlotCount;
}

void BML_init(void) {
    if (!contexts) contexts = MEM_alloc(sizeof(BML_Context) * BML_MAX_CONTEXTS);
    memset(emitters, 0, sizeof(emitters));
    memset(bullets, 0, sizeof(bullets));
    memset(bulletData, 0, sizeof(bulletData));
    memset(bulletOrder, 0, sizeof(bulletOrder));
    if (contexts) memset(contexts, 0, sizeof(BML_Context) * BML_MAX_CONTEXTS);
    memset(bulletPieces, 0, sizeof(bulletPieces));
    memset(bulletDots, 0, sizeof(bulletDots));
    activeContextSlotCount = 0;
    activeBulletSlotCount = 0;
    activeEmitterSlotCount = 0;
    bulletStateEnd = bullets;
    bulletDataEnd = bulletData;
    memset(&metrics, 0, sizeof(metrics));
    playerX64 = 160 * 64;
    playerY64 = 196 * 64;
    nextEmitterId = 1;
    nextBulletId = 1;
    nextContextId = 1;
}

bool BML_isReady(void) {
    return contexts != NULL;
}

s16 BML_startEmitter(const u8 *program, u16 programLength, s16 x64, s16 y64, u16 direction, u16 seed, u16 rankQ16) {
    u8 rootCount;
    u8 index;
    s16 slot = -1;
    s32 params[4] = { 0, 0, 0, 0 };
    if (!contexts || !validProgram(program, programLength) || activeEmitterCount() >= BML_MAX_EMITTERS) return -1;
    for (index = 0; index < BML_MAX_EMITTERS; index++) if (!emitters[index].allocated) { slot = index; break; }
    if (slot < 0) return -1;
    memset(&emitters[slot], 0, sizeof(emitters[slot]));
    emitters[slot].allocated = TRUE;
    emitters[slot].active = TRUE;
    emitters[slot].id = nextEmitterId++;
    emitters[slot].program = program;
    emitters[slot].programLength = programLength;
    emitters[slot].x64 = x64;
    emitters[slot].y64 = y64;
    emitters[slot].direction = direction;
    emitters[slot].seed = normalizeSeed(seed);
    emitters[slot].rankQ16 = rankQ16;
    rootCount = program[7];
    if (activeContextCount() + rootCount > BML_MAX_CONTEXTS) { emitters[slot].active = FALSE; emitters[slot].allocated = FALSE; metrics.contextDrops += rootCount; return -1; }
    activeEmitterSlotCount++;
    for (index = 0; index < rootCount; index++) {
        const u8 *block;
        u16 length;
        if (!definitionBlock(&emitters[slot], program[24 + index], &block, &length) || !createContext(BML_OWNER_EMITTER, (u8) slot, (u8) slot, block, length, params)) {
            BML_stopEmitter(emitters[slot].id);
            return -1;
        }
    }
    updateHighWater();
    return emitters[slot].id;
}

bool BML_updateEmitter(s16 emitterId, s16 x64, s16 y64, u16 direction) {
    u16 index;
    for (index = 0; index < BML_MAX_EMITTERS; index++) if (emitters[index].active && emitters[index].id == (u16) emitterId) {
        emitters[index].x64 = x64; emitters[index].y64 = y64; emitters[index].direction = direction; return TRUE;
    }
    return FALSE;
}

bool BML_stopEmitter(s16 emitterId) {
    u16 index;
    u16 emitterIndex;
    for (emitterIndex = 0; emitterIndex < BML_MAX_EMITTERS; emitterIndex++) if (emitters[emitterIndex].active && emitters[emitterIndex].id == (u16) emitterId) {
        emitters[emitterIndex].active = FALSE;
        activeEmitterSlotCount--;
        index = 0;
        while (index < activeContextSlotCount) {
            BML_Context *context = &contexts[activeContextSlots[index]];
            if (context->ownerType == BML_OWNER_EMITTER && context->ownerIndex == emitterIndex) deactivateContext(context);
            else index++;
        }
        releaseEmitters();
        return TRUE;
    }
    return FALSE;
}

void BML_setPlayer(s16 x64, s16 y64) {
    playerX64 = x64;
    playerY64 = y64;
}

void BML_tick(void) {
    u16 index;
    u16 orderCount = activeContextSlotCount;
    BML_BulletState *bullet;
    BML_Bullet *view;
    if (!contexts) return;
    metrics.frame++;
    metrics.spawnedThisFrame = 0;
    metrics.opcodesThisFrame = 0;
    for (index = 0; index < orderCount; index++) contextOrder[index] = activeContextSlots[index];
    for (index = 0; index < orderCount && metrics.opcodesThisFrame < BML_MAX_OPCODES_PER_FRAME; index++) {
        BML_Context *context = &contexts[contextOrder[index]];
        if (context->active) processContext(context);
    }
    if (metrics.opcodesThisFrame >= BML_MAX_OPCODES_PER_FRAME) {
        for (index = 0; index < activeContextSlotCount; index++) if (!contexts[activeContextSlots[index]].wait) { metrics.opcodeExhaustions++; break; }
    }
    index = 0;
    bullet = bullets;
    view = bulletData;
    while (index < activeBulletSlotCount) {
        s32 dx;
        s32 dy;
        s32 halfWidth;
        s32 halfHeight;
        s32 margin;
        u16 trigIndex;
        interpolateDirection(bullet, view);
        interpolateSpeed(bullet, view);
        trigIndex = view->direction >> 6;
        dx = ((s32) BML_sinQ14[trigIndex] * view->speed64) / 16384;
        dy = ((s32) BML_sinQ14[(trigIndex + 256) & 1023] * view->speed64) / 16384;
        view->x64 += (s16) dx;
        view->y64 -= (s16) dy;
        view->age++;
        if (view->age >= bullet->lifetime) { deactivateBullet(bullet); metrics.expired++; continue; }
        halfWidth = ((view->width + 1) / 2) * 64;
        halfHeight = ((view->height + 1) / 2) * 64;
        margin = bullet->margin * 64;
        if ((s32) view->x64 + halfWidth < -margin || (s32) view->y64 + halfHeight < -margin || (s32) view->x64 - halfWidth > 320 * 64 + margin || (s32) view->y64 - halfHeight > 224 * 64 + margin) { deactivateBullet(bullet); metrics.culled++; continue; }
        updateBulletOccupancy(bullet, view);
        index++;
        bullet++;
        view++;
    }
    cleanupContexts();
    releaseEmitters();
    updateHighWater();
}

static u16 applyDisplayBudget(u16 reservedGlobalSprites, const u8 *reservedPiecesByScanline, const u16 *reservedDotsByScanline, bool sparse, u16 reservedMaxPieces, u16 reservedMaxDots) {
    u16 global = reservedGlobalSprites > BML_GLOBAL_SPRITES ? BML_GLOBAL_SPRITES : reservedGlobalSprites;
    u8 *pieceBudget = budgetPieces;
    u16 *dotBudget = budgetDots;
    u16 scanline;
    u16 handled;
    u16 orderedCount;
    u16 onScreen = 0;
    u16 removed = 0;
    u16 maxPieces = sparse ? reservedMaxPieces : 0;
    u16 maxDots = sparse ? reservedMaxDots : 0;
    bool allFit = TRUE;
    BML_BulletState *displayBullet;
    BML_Bullet *displayView;
    orderedCount = orderActiveBullets();
    displayBullet = bullets;
    displayView = bulletData;
    for (handled = 0; handled < orderedCount; handled++) {
        displayView->visible = displayBullet->occupancyTracked;
        if (displayBullet->occupancyTracked) onScreen++;
        displayBullet++;
        displayView++;
    }
    if (global + onScreen > BML_GLOBAL_SPRITES) allFit = FALSE;
    if (sparse && reservedPiecesByScanline && reservedDotsByScanline) {
        displayBullet = bullets;
        for (handled = 0; handled < orderedCount; handled++, displayBullet++) if (displayBullet->occupancyTracked) {
            for (scanline = (u16) displayBullet->occupancyTop; scanline <= (u16) displayBullet->occupancyBottom; scanline++) {
                u16 pieces = reservedPiecesByScanline[scanline] + bulletPieces[scanline];
                u16 dots = reservedDotsByScanline[scanline] + bulletDots[scanline];
                pieceBudget[scanline] = (u8) pieces;
                dotBudget[scanline] = dots;
                if (pieces > maxPieces) maxPieces = pieces;
                if (dots > maxDots) maxDots = dots;
                if (pieces > BML_SCANLINE_PIECES || dots > BML_SCANLINE_DOTS) allFit = FALSE;
            }
        }
    } else if (reservedPiecesByScanline && reservedDotsByScanline) {
        for (scanline = 0; scanline < BML_SCANLINES; scanline++) {
            u16 pieces = reservedPiecesByScanline[scanline] + bulletPieces[scanline];
            u16 dots = reservedDotsByScanline[scanline] + bulletDots[scanline];
            pieceBudget[scanline] = (u8) pieces;
            dotBudget[scanline] = dots;
            if (pieces > maxPieces) maxPieces = pieces;
            if (dots > maxDots) maxDots = dots;
            if (pieces > BML_SCANLINE_PIECES || dots > BML_SCANLINE_DOTS) allFit = FALSE;
        }
    } else {
        for (scanline = 0; scanline < BML_SCANLINES; scanline++) {
            u16 pieces = (reservedPiecesByScanline ? reservedPiecesByScanline[scanline] : 0) + bulletPieces[scanline];
            u16 dots = (reservedDotsByScanline ? reservedDotsByScanline[scanline] : 0) + bulletDots[scanline];
            pieceBudget[scanline] = (u8) pieces;
            dotBudget[scanline] = dots;
            if (pieces > maxPieces) maxPieces = pieces;
            if (dots > maxDots) maxDots = dots;
            if (pieces > BML_SCANLINE_PIECES || dots > BML_SCANLINE_DOTS) allFit = FALSE;
        }
    }
    if (allFit) {
        metrics.displaySpritesThisFrame = global + onScreen;
        metrics.maxPiecesThisFrame = maxPieces;
        metrics.maxDotsThisFrame = maxDots;
        return 0;
    }
    maxPieces = sparse ? reservedMaxPieces : 0;
    maxDots = sparse ? reservedMaxDots : 0;
    if (sparse && reservedPiecesByScanline && reservedDotsByScanline) {
        displayBullet = bullets;
        for (handled = 0; handled < orderedCount; handled++, displayBullet++) if (displayBullet->occupancyTracked) {
            for (scanline = (u16) displayBullet->occupancyTop; scanline <= (u16) displayBullet->occupancyBottom; scanline++) {
                pieceBudget[scanline] = reservedPiecesByScanline[scanline];
                dotBudget[scanline] = reservedDotsByScanline[scanline];
            }
        }
    } else {
        for (scanline = 0; scanline < BML_SCANLINES; scanline++) {
            pieceBudget[scanline] -= bulletPieces[scanline];
            dotBudget[scanline] -= bulletDots[scanline];
            if (pieceBudget[scanline] > maxPieces) maxPieces = pieceBudget[scanline];
            if (dotBudget[scanline] > maxDots) maxDots = dotBudget[scanline];
        }
    }
    memset(displayDelete, 0, sizeof(displayDelete));
    for (handled = 0; handled < orderedCount; handled++) {
        u8 slot = bulletOrder[handled];
        {
            BML_BulletState *bullet = &bullets[slot];
            BML_Bullet *view = &bulletData[slot];
            s16 top = bullet->occupancyTop;
            s16 bottom = bullet->occupancyBottom;
            bool fits = global < BML_GLOBAL_SPRITES;
            view->visible = FALSE;
            if (!bullet->occupancyTracked) continue;
            if (fits) {
                for (scanline = (u16) top; scanline <= (u16) bottom; scanline++) {
                    if (pieceBudget[scanline] + 1 > BML_SCANLINE_PIECES || dotBudget[scanline] + view->width > BML_SCANLINE_DOTS) {
                        fits = FALSE;
                        while (scanline > (u16) top) {
                            scanline--;
                            pieceBudget[scanline]--;
                            dotBudget[scanline] -= view->width;
                        }
                        break;
                    }
                    pieceBudget[scanline]++;
                    dotBudget[scanline] += view->width;
                    if (pieceBudget[scanline] > maxPieces) maxPieces = pieceBudget[scanline];
                    if (dotBudget[scanline] > maxDots) maxDots = dotBudget[scanline];
                }
            }
            if (!fits) { displayDelete[slot] = TRUE; metrics.displayDeletes++; removed++; continue; }
            view->visible = TRUE;
            global++;
        }
    }
    metrics.displaySpritesThisFrame = global;
    metrics.maxPiecesThisFrame = maxPieces;
    metrics.maxDotsThisFrame = maxDots;
    for (handled = orderedCount; handled > 0; handled--) {
        u16 slot = handled - 1;
        if (displayDelete[slot]) deactivateBullet(&bullets[slot]);
    }
    cleanupContexts();
    updateHighWater();
    return removed;
}

u16 BML_applyDisplayBudget(u16 reservedGlobalSprites, const u8 *reservedPiecesByScanline, const u16 *reservedDotsByScanline) {
    return applyDisplayBudget(reservedGlobalSprites, reservedPiecesByScanline, reservedDotsByScanline, FALSE, 0, 0);
}

u16 BML_applyDisplayBudgetSparse(u16 reservedGlobalSprites, const u8 *reservedPiecesByScanline, const u16 *reservedDotsByScanline, u16 reservedMaxPieces, u16 reservedMaxDots) {
    if (!reservedPiecesByScanline || !reservedDotsByScanline) return BML_applyDisplayBudget(reservedGlobalSprites, reservedPiecesByScanline, reservedDotsByScanline);
    return applyDisplayBudget(reservedGlobalSprites, reservedPiecesByScanline, reservedDotsByScanline, TRUE, reservedMaxPieces, reservedMaxDots);
}

const BML_Bullet *BML_getBullets(u16 *count) {
    if (count) *count = activeBulletSlotCount;
    return bulletData;
}

bool BML_removeBullet(u16 index) {
    if (index >= activeBulletSlotCount) return FALSE;
    deactivateBullet(&bullets[index]);
    updateHighWater();
    return TRUE;
}

void BML_clearAll(void) {
    u16 index;
    if (!contexts) return;
    while (activeBulletSlotCount) deactivateBullet(&bullets[activeBulletSlotCount - 1]);
    index = 0;
    while (index < activeContextSlotCount) {
        BML_Context *context = &contexts[activeContextSlots[index]];
        if (context->ownerType == BML_OWNER_BULLET) deactivateContext(context);
        else index++;
    }
    releaseEmitters();
    updateHighWater();
}

void BML_shutdown(void) {
    if (!contexts) return;
    BML_clearAll();
    MEM_free(contexts);
    contexts = NULL;
    activeContextSlotCount = 0;
    activeBulletSlotCount = 0;
    activeEmitterSlotCount = 0;
}

const BML_Metrics *BML_getMetrics(void) {
    return &metrics;
}

static u32 crcByte(u32 crc, u8 value) {
    u8 bit;
    crc ^= value;
    for (bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ ((crc & 1) ? 0xEDB88320UL : 0);
    return crc;
}

static u32 crcU16(u32 crc, u16 value) {
    crc = crcByte(crc, (u8) (value >> 8));
    return crcByte(crc, (u8) value);
}

static u32 crcU32(u32 crc, u32 value) {
    crc = crcByte(crc, (u8) (value >> 24)); crc = crcByte(crc, (u8) (value >> 16)); crc = crcByte(crc, (u8) (value >> 8)); return crcByte(crc, (u8) value);
}

u32 BML_stateCrc(u32 previous) {
    u16 count = orderActiveBullets();
    u16 index;
    u16 seed = 0xACE1;
    for (index = 0; index < BML_MAX_EMITTERS; index++) if (emitters[index].allocated) { seed = emitters[index].seed; break; }
    previous = crcU32(previous, metrics.frame);
    previous = crcU16(previous, seed);
    previous = crcU16(previous, count);
    previous = crcU16(previous, metrics.contexts);
    previous = crcU16(previous, metrics.lastOpcode);
    for (index = 0; index < count; index++) {
        const BML_Bullet *view = &bulletData[bulletOrder[index]];
        previous = crcU16(previous, view->id);
        previous = crcU32(previous, (u32) (s32) view->x64);
        previous = crcU32(previous, (u32) (s32) view->y64);
        previous = crcU16(previous, view->direction);
        previous = crcU16(previous, (u16) view->speed64);
    }
    return previous;
}
