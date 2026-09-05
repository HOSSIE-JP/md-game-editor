#ifndef BULLETML_GAME_H
#define BULLETML_GAME_H

#include <genesis.h>

#define BML_GAME_MAX_WAYPOINTS 8
#define BML_GAME_MAX_PHASES 8
#define BML_GAME_MAX_EMITTERS 8
#define BML_GAME_MAX_PLACEMENTS 16
#define BML_GAME_MAX_MOVEMENT_POINTS 16
#define BML_GAME_MAX_BOSS_PARTS 16
#define BML_GAME_MAX_BANDS 8
#define BML_GAME_MAX_NEXT 8

enum {
    BML_ORIENTATION_VERTICAL = 0,
    BML_ORIENTATION_HORIZONTAL = 1
};

enum {
    BML_TRIGGER_FRAME = 0,
    BML_TRIGGER_SCROLL = 1,
    BML_TRIGGER_CONDITION = 2
};

enum {
    BML_ACTION_SPAWN_ENEMY = 0,
    BML_ACTION_SPAWN_BOSS = 1,
    BML_ACTION_SPAWN_DESTRUCTIBLE = 2,
    BML_ACTION_SET_SCROLL = 3,
    BML_ACTION_SET_BACKGROUND = 4,
    BML_ACTION_SET_WAVE = 5,
    BML_ACTION_SET_FLAG = 6,
    BML_ACTION_CLEAR_BULLETS = 7,
    BML_ACTION_STAGE_CLEAR = 8
};

enum {
    BML_INTERPOLATION_STEP = 0,
    BML_INTERPOLATION_LINEAR = 1,
    BML_INTERPOLATION_SMOOTHSTEP = 2
};

enum {
    BML_WAVE_NONE = 0,
    BML_WAVE_SINE = 1,
    BML_WAVE_DUAL_SINE = 2,
    BML_WAVE_RIPPLE = 3,
    BML_WAVE_SHEAR = 4,
    BML_WAVE_JITTER = 5
};

enum {
    BML_ITEM_WEAPON = 0,
    BML_ITEM_BOMB = 1,
    BML_ITEM_SCORE = 2
};

typedef struct {
    const SpriteDefinition *definition;
    u8 animationRow;
} BML_SpriteRef;

typedef struct {
    s16 x;
    s16 y;
    u16 frame;
    u8 interpolation;
} BML_GameWaypoint;

/* Compatibility projection consumed by the ABI-v1 enemy bullet host. */
typedef struct {
    u16 spawnFrame;
    u16 hp;
    u32 score;
    u8 enemyType;
    u8 boss;
    u8 patternIndex;
    u8 pathCount;
    u8 phaseCount;
    BML_GameWaypoint path[BML_GAME_MAX_WAYPOINTS];
    u8 phaseThreshold[BML_GAME_MAX_PHASES];
    u8 phasePattern[BML_GAME_MAX_PHASES];
    u8 entityRuntimeId;
    u8 movementRuntimeId;
    u8 itemRuntimeId;
} BML_GameEvent;

typedef struct {
    const u8 *data;
    u16 size;
    const char *id;
    u8 type;
} BML_GamePattern;

typedef struct {
    u8 preset;
    u16 start;
    u16 end;
    s16 amplitudeQ8;
    u16 wavelength;
    s16 speedQ8;
    u16 fadeFrames;
} BML_WaveConfig;

typedef struct {
    const char *id;
    u16 order;
    u8 triggerType;
    s32 triggerValueQ8;
    const char *triggerFlag;
    const char *triggerOperator;
    u8 triggerBossRuntimeId;
    u8 actionType;
    u8 enemyRuntimeId;
    u8 bossRuntimeId;
    u8 backgroundRuntimeId;
    u8 movementRuntimeId;
    u8 itemRuntimeId;
    u8 patternIndex;
    u8 plane;
    s32 valueQ8;
    u16 durationFrames;
    u8 interpolation;
    u8 transition;
    BML_WaveConfig wave;
    const char *flag;
} BML_StageEventV2;

typedef struct {
    u8 stageRuntimeId;
    const char *flag;
    bool equals;
} BML_StageNext;

typedef struct {
    const BML_GameEvent *events;
    u8 eventCount;
    u16 durationFrames;
    bool horizontal;
    u8 runtimeId;
    u8 backgroundRuntimeId;
    u8 collisionIndex;
    const BML_StageEventV2 *typedEvents;
    u8 typedEventCount;
    BML_StageNext next[BML_GAME_MAX_NEXT];
    u8 nextCount;
    bool caravan;
    s16 preDemoScene;
    s16 postDemoScene;
    const char *id;
    const char *name;
} BML_GameStage;

typedef struct {
    s16 x;
    s16 y;
    s16 angleDegrees;
} BML_WeaponEmitter;

typedef struct {
    u8 runtimeId;
    const char *id;
    const char *name;
    BML_SpriteRef sprite;
    u8 intervalFrames;
    u8 damage;
    u16 speedQ8;
    u8 simultaneous;
    u32 duplicateScore;
    BML_WeaponEmitter emitters[BML_GAME_MAX_EMITTERS];
    u8 emitterCount;
} BML_WeaponConfig;

typedef struct {
    u8 runtimeId;
    const char *id;
    u8 type;
    BML_SpriteRef sprite;
    u8 weaponRuntimeId;
    u8 amount;
    u32 score;
} BML_ItemConfig;

typedef struct {
    u8 runtimeId;
    const char *id;
    BML_SpriteRef sprite;
    u16 durationFrames;
    const u8 *se;
    u32 seSize;
} BML_EffectConfig;

typedef struct {
    u16 frame;
    u8 effectRuntimeId;
    s16 x;
    s16 y;
} BML_EffectPlacement;

typedef struct {
    u8 runtimeId;
    const char *id;
    BML_EffectPlacement placements[BML_GAME_MAX_PLACEMENTS];
    u8 placementCount;
} BML_ExplosionConfig;

typedef struct {
    s16 x;
    s16 y;
    u16 durationFrames;
    u8 interpolation;
} BML_MovementPoint;

typedef struct {
    u8 runtimeId;
    const char *id;
    bool loop;
    BML_MovementPoint points[BML_GAME_MAX_MOVEMENT_POINTS];
    u8 pointCount;
} BML_MovementConfig;

typedef struct {
    u8 runtimeId;
    const char *id;
    BML_SpriteRef sprite;
    u16 hp;
    u32 score;
    s8 hitboxX;
    s8 hitboxY;
    u8 hitboxRadius;
    u8 movementRuntimeId;
    u8 patternIndex;
    u8 dropItemRuntimeId;
    u8 explosionRuntimeId;
    const u8 *se;
    u32 seSize;
    bool destructibleBackground;
} BML_EnemyConfig;

typedef struct {
    const char *id;
    u16 hp;
    u16 globalHpTransferQ8;
    s8 hitboxX;
    s8 hitboxY;
    u8 hitboxRadius;
    u8 explosionRuntimeId;
    const char *disableEventId;
    bool followBackground;
} BML_BossPartConfig;

typedef struct {
    u8 threshold;
    u8 patternIndex;
    u8 movementRuntimeId;
    u8 backgroundRuntimeId;
    u8 activePartMask;
    bool clearBullets;
    s32 rankQ16;
    BML_WaveConfig wave;
} BML_BossPhaseConfig;

typedef struct {
    u8 runtimeId;
    const char *id;
    BML_SpriteRef sprite;
    u16 hp;
    u32 score;
    u8 hitboxRadius;
    u8 movementRuntimeId;
    u8 patternIndex;
    u8 dropItemRuntimeId;
    u8 explosionRuntimeId;
    const u8 *se;
    u32 seSize;
    BML_BossPartConfig parts[BML_GAME_MAX_BOSS_PARTS];
    u8 partCount;
    BML_BossPhaseConfig phases[BML_GAME_MAX_PHASES];
    u8 phaseCount;
} BML_BossConfig;

typedef struct {
    u16 start;
    u16 end;
    s16 multiplierQ8;
} BML_BackgroundBand;

typedef struct {
    const MapDefinition *map;
    const TileSet *tileset;
    const u16 *palette;
    BML_BackgroundBand bands[BML_GAME_MAX_BANDS];
    u8 bandCount;
    BML_WaveConfig wave;
} BML_BackgroundPlane;

typedef struct {
    u8 runtimeId;
    const char *id;
    BML_BackgroundPlane bgA;
    BML_BackgroundPlane bgB;
    u8 transition;
    u16 fadeFrames;
    const u8 *bgm;
} BML_BackgroundConfig;

typedef struct {
    u8 runtimeId;
    const char *id;
    bool solid;
    u8 damage;
    u8 mask;
} BML_CollisionMaterial;

typedef struct {
    u8 stageRuntimeId;
    u16 width;
    u16 height;
    u8 tileWidth;
    u8 tileHeight;
    const u8 *rle;
    u16 rleSize;
    const char *layerName;
} BML_CollisionMap;

typedef struct {
    BML_SpriteRef sprite;
    u8 verticalRows[3];
    u8 horizontalRows[3];
    s8 hitboxX;
    s8 hitboxY;
    u8 hitboxRadius;
    u16 speedsQ8[3];
    u8 initialLives;
    u8 initialBombs;
    u8 initialWeaponRuntimeId;
    u8 initialSpeed;
} BML_PlayerConfig;

extern const BML_GamePattern bmlGamePatterns[];
extern const u8 bmlGamePatternCount;
extern const u8 bmlPatternRuntimeIds[];
extern const BML_GameStage bmlGameStages[];
extern const u8 bmlGameStageCount;
extern const BML_PlayerConfig bmlPlayerConfig;
extern const BML_WeaponConfig bmlWeapons[];
extern const u8 bmlWeaponCount;
extern const BML_ItemConfig bmlItems[];
extern const u8 bmlItemCount;
extern const BML_EffectConfig bmlEffects[];
extern const u8 bmlEffectCount;
extern const BML_ExplosionConfig bmlExplosions[];
extern const u8 bmlExplosionCount;
extern const BML_MovementConfig bmlMovements[];
extern const u8 bmlMovementCount;
extern const BML_EnemyConfig bmlEnemies[];
extern const u8 bmlEnemyCount;
extern const BML_BossConfig bmlBosses[];
extern const u8 bmlBossCount;
extern const BML_BackgroundConfig bmlBackgrounds[];
extern const u8 bmlBackgroundCount;
extern const BML_CollisionMaterial bmlCollisionMaterials[];
extern const u8 bmlCollisionMaterialCount;
extern const BML_CollisionMap bmlCollisionMaps[];
extern const u8 bmlCollisionMapCount;

void BML_gameRun(void);

#endif
