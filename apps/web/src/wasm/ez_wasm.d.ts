/* tslint:disable */
/* eslint-disable */
/**
 * Byte angle from a to b (matches the on-chain math exactly).
 */
export function angle_to(ax: number, ay: number, bx: number, by: number): number;
/**
 * Converts the on-chain raw layout into the compact layout the UI decoder reads.
 */
export function raw_to_compact(raw: Uint8Array): Uint8Array;
/**
 * Value of an item, for UI.
 */
export function item_value(kind: number, rarity: number): number;
export class Sim {
  private constructor();
  free(): void;
  /**
   * kind: 0 attack, 1 special, 2 dodge, 3 potion
   */
  act_combat(p: number, kind: number, aim: number): void;
  t_set_tick(t: number): void;
  tick_count(): number;
  static world_size(): number;
  replace_raw(raw: Uint8Array): boolean;
  resolve_chest(chest: number, rnd: Uint8Array): boolean;
  /**
   * Moves a monster (e.g. to frame the boss).
   */
  t_move_monster(mi: number, x: number, y: number): void;
  /**
   * Removes every monster within `r` units of (x, y) (r < 0 removes all).
   */
  t_clear_monsters(x: number, y: number, r: number): void;
  /**
   * Wraps world bytes read from the rollup (for prediction and decoding helpers).
   */
  static load(bytes: Uint8Array): Sim;
  t_hp(p: number, hp: number, max: number): void;
  /**
   * Advances one world tick, letting bots act first. Returns chest indices bots opened.
   */
  tick(): Uint8Array;
  bytes(): Uint8Array;
  phase(): number;
  /**
   * Collision-aware movement for client prediction: returns [x, y].
   */
  slide(x: number, y: number, dx: number, dy: number): Int32Array;
  is_bot(p: number): boolean;
  /**
   * Places an item on the floor with the usual loot fanfare.
   */
  t_drop(kind: number, rarity: number, x: number, y: number): void;
  replace(bytes: Uint8Array): boolean;
  /**
   * Teleports a player (and resets its movement budget).
   */
  t_place(p: number, x: number, y: number): void;
  /**
   * Spawns a monster; returns its slot or -1.
   */
  t_spawn(kind: number, x: number, y: number, chase: boolean, target: number): number;
  act_move(p: number, x: number, y: number, aim: number, moving: number): void;
  /**
   * Returns the chest index waiting for randomness, or -1.
   */
  interact(p: number): number;
  /**
   * Loads the zero-copy layout read straight from the room account.
   */
  static load_raw(raw: Uint8Array): Sim;
  /**
   * Practice run: the local player is slot 0, `bots` rival adventurers fill the rest.
   */
  static practice(seed: Uint8Array, _class: number, name: string, bots: number, quick: boolean): Sim;
  static raw_size(): number;
  tick_only(): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_sim_free: (a: number, b: number) => void;
  readonly angle_to: (a: number, b: number, c: number, d: number) => number;
  readonly item_value: (a: number, b: number) => number;
  readonly raw_to_compact: (a: number, b: number) => [number, number, number, number];
  readonly sim_act_combat: (a: number, b: number, c: number, d: number) => void;
  readonly sim_act_move: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly sim_bytes: (a: number) => [number, number];
  readonly sim_interact: (a: number, b: number) => number;
  readonly sim_is_bot: (a: number, b: number) => number;
  readonly sim_load: (a: number, b: number) => [number, number, number];
  readonly sim_load_raw: (a: number, b: number) => [number, number, number];
  readonly sim_phase: (a: number) => number;
  readonly sim_practice: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
  readonly sim_raw_size: () => number;
  readonly sim_replace: (a: number, b: number, c: number) => number;
  readonly sim_replace_raw: (a: number, b: number, c: number) => number;
  readonly sim_resolve_chest: (a: number, b: number, c: number, d: number) => number;
  readonly sim_slide: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly sim_t_clear_monsters: (a: number, b: number, c: number, d: number) => void;
  readonly sim_t_drop: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly sim_t_hp: (a: number, b: number, c: number, d: number) => void;
  readonly sim_t_move_monster: (a: number, b: number, c: number, d: number) => void;
  readonly sim_t_place: (a: number, b: number, c: number, d: number) => void;
  readonly sim_t_set_tick: (a: number, b: number) => void;
  readonly sim_t_spawn: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
  readonly sim_tick: (a: number) => [number, number];
  readonly sim_tick_count: (a: number) => number;
  readonly sim_tick_only: (a: number) => void;
  readonly sim_world_size: () => number;
  readonly __wbindgen_export_0: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
