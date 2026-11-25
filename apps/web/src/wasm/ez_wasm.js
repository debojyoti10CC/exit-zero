let wasm;

const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

let cachedUint8ArrayMemory0 = null;

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
/**
 * Byte angle from a to b (matches the on-chain math exactly).
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
export function angle_to(ax, ay, bx, by) {
    const ret = wasm.angle_to(ax, ay, bx, by);
    return ret;
}

let WASM_VECTOR_LEN = 0;

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_export_0.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
/**
 * Converts the on-chain raw layout into the compact layout the UI decoder reads.
 * @param {Uint8Array} raw
 * @returns {Uint8Array}
 */
export function raw_to_compact(raw) {
    const ptr0 = passArray8ToWasm0(raw, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.raw_to_compact(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Value of an item, for UI.
 * @param {number} kind
 * @param {number} rarity
 * @returns {number}
 */
export function item_value(kind, rarity) {
    const ret = wasm.item_value(kind, rarity);
    return ret >>> 0;
}

let cachedInt32ArrayMemory0 = null;

function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

const ReplayFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_replay_free(ptr >>> 0, 1));
/**
 * Re-runs a recorded on-chain match: every instruction the program applied to
 * the room's world, in order, with the program's own bookkeeping (wallets and
 * session keys). Each method mirrors one instruction handler and returns false
 * where the program would have rejected the transaction.
 */
export class Replay {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ReplayFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_replay_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    tick_count() {
        const ret = wasm.replay_tick_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * World right after `reset` with this nonce (or room creation for nonce 0).
     * @param {number} nonce
     */
    constructor(nonce) {
        const ret = wasm.replay_new(nonce);
        this.__wbg_ptr = ret >>> 0;
        ReplayFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Uint8Array} wallet
     * @param {number} _class
     * @param {Uint8Array} name
     * @param {Uint8Array} session
     * @returns {boolean}
     */
    join(wallet, _class, name, session) {
        const ptr0 = passArray8ToWasm0(wallet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(name, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(session, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.replay_join(this.__wbg_ptr, ptr0, len0, _class, ptr1, len1, ptr2, len2);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} randomness
     * @returns {boolean}
     */
    seed(randomness) {
        const ptr0 = passArray8ToWasm0(randomness, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.replay_seed(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Steps the world when the program did (its receipt log says so).
     * @returns {boolean}
     */
    tick() {
        const ret = wasm.replay_tick(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} session
     * @returns {boolean}
     */
    begin(session) {
        const ptr0 = passArray8ToWasm0(session, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.replay_begin(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Compact encoding: hashed for receipts and decoded by the renderer.
     * @returns {Uint8Array}
     */
    bytes() {
        const ret = wasm.replay_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {Uint8Array} randomness
     * @param {number} chest
     * @returns {boolean}
     */
    chest(randomness, chest) {
        const ptr0 = passArray8ToWasm0(randomness, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.replay_chest(this.__wbg_ptr, ptr0, len0, chest);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} session
     * @returns {boolean}
     */
    leave(session) {
        const ptr0 = passArray8ToWasm0(session, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.replay_leave(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    phase() {
        const ret = wasm.replay_phase(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {Uint8Array} session
     * @returns {boolean}
     */
    start(session) {
        const ptr0 = passArray8ToWasm0(session, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.replay_start(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} session
     * @param {number} kind
     * @param {number} aim
     * @returns {boolean}
     */
    combat(session, kind, aim) {
        const ptr0 = passArray8ToWasm0(session, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.replay_combat(this.__wbg_ptr, ptr0, len0, kind, aim);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    settle() {
        const ret = wasm.replay_settle(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} session
     * @param {number} x
     * @param {number} y
     * @param {number} aim
     * @param {number} moving
     * @returns {boolean}
     */
    act_move(session, x, y, aim, moving) {
        const ptr0 = passArray8ToWasm0(session, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.replay_act_move(this.__wbg_ptr, ptr0, len0, x, y, aim, moving);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} session
     * @returns {boolean}
     */
    interact(session) {
        const ptr0 = passArray8ToWasm0(session, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.replay_interact(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} session
     * @param {number} _class
     * @returns {boolean}
     */
    set_class(session, _class) {
        const ptr0 = passArray8ToWasm0(session, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.replay_set_class(this.__wbg_ptr, ptr0, len0, _class);
        return ret !== 0;
    }
}

const SimFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sim_free(ptr >>> 0, 1));

export class Sim {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Sim.prototype);
        obj.__wbg_ptr = ptr;
        SimFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SimFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sim_free(ptr, 0);
    }
    /**
     * kind: 0 attack, 1 special, 2 dodge, 3 potion
     * @param {number} p
     * @param {number} kind
     * @param {number} aim
     */
    act_combat(p, kind, aim) {
        wasm.sim_act_combat(this.__wbg_ptr, p, kind, aim);
    }
    /**
     * @returns {number}
     */
    tick_count() {
        const ret = wasm.sim_tick_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    static world_size() {
        const ret = wasm.sim_world_size();
        return ret >>> 0;
    }
    /**
     * @param {Uint8Array} raw
     * @returns {boolean}
     */
    replace_raw(raw) {
        const ptr0 = passArray8ToWasm0(raw, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sim_replace_raw(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {number} chest
     * @param {Uint8Array} rnd
     * @returns {boolean}
     */
    resolve_chest(chest, rnd) {
        const ptr0 = passArray8ToWasm0(rnd, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sim_resolve_chest(this.__wbg_ptr, chest, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Wraps world bytes read from the rollup (for prediction and decoding helpers).
     * @param {Uint8Array} bytes
     * @returns {Sim}
     */
    static load(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sim_load(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Sim.__wrap(ret[0]);
    }
    /**
     * Advances one world tick, letting bots act first. Returns chest indices bots opened.
     * @returns {Uint8Array}
     */
    tick() {
        const ret = wasm.sim_tick(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    bytes() {
        const ret = wasm.sim_bytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {number}
     */
    phase() {
        const ret = wasm.sim_phase(this.__wbg_ptr);
        return ret;
    }
    /**
     * Collision-aware movement for client prediction: returns [x, y].
     * @param {number} x
     * @param {number} y
     * @param {number} dx
     * @param {number} dy
     * @returns {Int32Array}
     */
    slide(x, y, dx, dy) {
        const ret = wasm.sim_slide(this.__wbg_ptr, x, y, dx, dy);
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} p
     * @returns {boolean}
     */
    is_bot(p) {
        const ret = wasm.sim_is_bot(this.__wbg_ptr, p);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {boolean}
     */
    replace(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sim_replace(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {number} p
     * @param {number} x
     * @param {number} y
     * @param {number} aim
     * @param {number} moving
     */
    act_move(p, x, y, aim, moving) {
        wasm.sim_act_move(this.__wbg_ptr, p, x, y, aim, moving);
    }
    /**
     * Returns the chest index waiting for randomness, or -1.
     * @param {number} p
     * @returns {number}
     */
    interact(p) {
        const ret = wasm.sim_interact(this.__wbg_ptr, p);
        return ret;
    }
    /**
     * Loads the zero-copy layout read straight from the room account.
     * @param {Uint8Array} raw
     * @returns {Sim}
     */
    static load_raw(raw) {
        const ptr0 = passArray8ToWasm0(raw, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sim_load_raw(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Sim.__wrap(ret[0]);
    }
    /**
     * Practice run: the local player is slot 0, `bots` rival adventurers fill the rest.
     * @param {Uint8Array} seed
     * @param {number} _class
     * @param {string} name
     * @param {number} bots
     * @param {boolean} quick
     * @returns {Sim}
     */
    static practice(seed, _class, name, bots, quick) {
        const ptr0 = passArray8ToWasm0(seed, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.sim_practice(ptr0, len0, _class, ptr1, len1, bots, quick);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Sim.__wrap(ret[0]);
    }
    /**
     * @returns {number}
     */
    static raw_size() {
        const ret = wasm.sim_raw_size();
        return ret >>> 0;
    }
    tick_only() {
        wasm.sim_tick_only(this.__wbg_ptr);
    }
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);

            } catch (e) {
                if (module.headers.get('Content-Type') != 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else {
                    throw e;
                }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);

    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };

        } else {
            return instance;
        }
    }
}

function __wbg_get_imports() {
    const imports = {};
    imports.wbg = {};
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_export_0;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };
    imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
        const ret = getStringFromWasm0(arg0, arg1);
        return ret;
    };
    imports.wbg.__wbindgen_throw = function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
    };

    return imports;
}

function __wbg_init_memory(imports, memory) {

}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    __wbg_init.__wbindgen_wasm_module = module;
    cachedInt32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;


    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (typeof module !== 'undefined') {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();

    __wbg_init_memory(imports);

    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }

    const instance = new WebAssembly.Instance(module, imports);

    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (typeof module_or_path !== 'undefined') {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('ez_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
