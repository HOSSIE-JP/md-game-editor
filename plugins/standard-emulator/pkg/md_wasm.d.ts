/* tslint:disable */
/* eslint-disable */

export class EmulatorHandle {
    free(): void;
    [Symbol.dispose](): void;
    auto_video_region(): void;
    static build_version(): string;
    debug_cram_colors_json(): any;
    debug_render_plane(plane: string): any;
    debug_render_tiles(palette: number): any;
    debug_sprites_json(): any;
    get_cpu_state(): any;
    get_cram(): Uint8Array;
    get_framebuffer_argb(): Uint32Array;
    get_memory(address: number, length: number): Uint8Array;
    /**
     * Returns the current SRAM contents as a byte array.
     * Returns an empty Vec if no SRAM is present.
     */
    get_sram(): Uint8Array;
    /**
     * Returns SRAM info as a JS object: { has_sram, start, end, size, flags }.
     */
    get_sram_info(): any;
    get_vdp_registers_json(): any;
    get_video_region(): string;
    get_vram(): Uint8Array;
    /**
     * Returns true if the loaded ROM has battery-backed SRAM.
     */
    has_sram(): boolean;
    is_video_region_auto(): boolean;
    load_rom(rom: Uint8Array): void;
    /**
     * Restores SRAM from a byte array (e.g., loaded from IndexedDB).
     * No-op if the ROM has no SRAM or the sizes don't match.
     */
    load_sram(data: Uint8Array): void;
    load_state(data: Uint8Array): void;
    constructor();
    pause(): void;
    reset(): void;
    resume(): void;
    run_frame(): void;
    save_state(): Uint8Array;
    set_breakpoint(address: number): void;
    set_controller_state(player: number, buttons: number): void;
    set_video_region(region: string): void;
    step(cycles: number): void;
    step_instruction(): void;
    take_audio_samples(frames: number): Float32Array;
    trace_execution(): any;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_emulatorhandle_free: (a: number, b: number) => void;
    readonly emulatorhandle_auto_video_region: (a: number) => void;
    readonly emulatorhandle_build_version: () => [number, number];
    readonly emulatorhandle_debug_cram_colors_json: (a: number) => [number, number, number];
    readonly emulatorhandle_debug_render_plane: (a: number, b: number, c: number) => [number, number, number];
    readonly emulatorhandle_debug_render_tiles: (a: number, b: number) => [number, number, number];
    readonly emulatorhandle_debug_sprites_json: (a: number) => [number, number, number];
    readonly emulatorhandle_get_cpu_state: (a: number) => [number, number, number];
    readonly emulatorhandle_get_cram: (a: number) => [number, number];
    readonly emulatorhandle_get_framebuffer_argb: (a: number) => [number, number];
    readonly emulatorhandle_get_memory: (a: number, b: number, c: number) => [number, number];
    readonly emulatorhandle_get_sram: (a: number) => [number, number];
    readonly emulatorhandle_get_sram_info: (a: number) => [number, number, number];
    readonly emulatorhandle_get_vdp_registers_json: (a: number) => [number, number, number];
    readonly emulatorhandle_get_video_region: (a: number) => [number, number];
    readonly emulatorhandle_get_vram: (a: number) => [number, number];
    readonly emulatorhandle_has_sram: (a: number) => number;
    readonly emulatorhandle_is_video_region_auto: (a: number) => number;
    readonly emulatorhandle_load_rom: (a: number, b: number, c: number) => [number, number];
    readonly emulatorhandle_load_sram: (a: number, b: number, c: number) => void;
    readonly emulatorhandle_load_state: (a: number, b: number, c: number) => [number, number];
    readonly emulatorhandle_new: () => number;
    readonly emulatorhandle_pause: (a: number) => void;
    readonly emulatorhandle_reset: (a: number) => void;
    readonly emulatorhandle_resume: (a: number) => void;
    readonly emulatorhandle_run_frame: (a: number) => void;
    readonly emulatorhandle_save_state: (a: number) => [number, number, number, number];
    readonly emulatorhandle_set_breakpoint: (a: number, b: number) => void;
    readonly emulatorhandle_set_controller_state: (a: number, b: number, c: number) => void;
    readonly emulatorhandle_set_video_region: (a: number, b: number, c: number) => [number, number];
    readonly emulatorhandle_step: (a: number, b: number) => void;
    readonly emulatorhandle_step_instruction: (a: number) => void;
    readonly emulatorhandle_take_audio_samples: (a: number, b: number) => [number, number];
    readonly emulatorhandle_trace_execution: (a: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
