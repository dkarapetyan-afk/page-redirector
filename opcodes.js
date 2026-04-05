export const Op = {
    PUSH_STR: 1, 
    PUSH_INT: 2, 
    JUMP: 3,     
    
    // Core dictionary
    DUP: 10,
    DROP: 11,
    SWAP: 12,
    OVER: 13,
    ROT: 14,
    T: 15,

    // URL processing
    HOST: 20,
    PATH: 21,
    PROTO: 22,
    PORT: 23,
    HASH: 24,
    PARAM: 25,
    HAS_PARAM: 26,
    SEGMENT: 27,

    // Comparison / Logic
    EQ: 30,
    NEQ: 31,
    STARTS_WITH: 32,
    ENDS_WITH: 33,
    CONTAINS: 34,
    AND: 35,
    OR: 36,
    NOT: 37,

    // Type predicates
    STR_Q: 38,
    INT_Q: 39,
    ARR_Q: 40,
    QUOT_Q: 41,

    // Strings
    CONCAT: 45,
    REPLACE: 46,
    REPLACE_ALL: 47,
    SUBSTR: 48,

    // URL manipulation
    SET_PARAM: 50,
    REMOVE_PARAM: 51,

    // Arrays / Splitting
    SPLIT: 60,
    PARAM_KEYS: 61,
    PARAM_VALUES: 62,
    PATH_SEGMENTS: 63,
    LEN: 64,
    GET: 65,
    JOIN: 66,
    INDICES: 67,
    SLICE: 68,
    ZIP: 69,
    
    // Arithmetic & Comparison
    ADD: 70,
    SUB: 71,
    MUL: 72,
    DIV: 73,
    MOD: 74,
    GT: 75,
    LT: 76,
    GTE: 77,
    LTE: 78,
    
    // Flow Control
    CALL: 80,
    CALL_IF: 81,
    CHOOSE: 82,
    EACH: 83,
    MAP: 84,
    FILTER: 85,
    
    // Commands
    REDIRECT: 90,
    SKIP: 91,

    // Block logic
    PUSH_BLOCK: 101, // Pushes a target IP onto the stack
    RETURN: 102,     // Returns from a Call frame (custom words)
    CALL_CUSTOM: 103, // Used internally to call custom registered words
    MAKE_ARRAY: 104
};

export const OpReverseMap = Object.keys(Op).reduce((acc, key) => {
    acc[Op[key]] = key;
    return acc;
}, {});

export const BuiltinMap = {
    "dup": Op.DUP, "drop": Op.DROP, "swap": Op.SWAP, "over": Op.OVER, "rot": Op.ROT, "$t": Op.T,
    "host": Op.HOST, "path": Op.PATH, "proto": Op.PROTO, "port": Op.PORT, "hash": Op.HASH,
    "param": Op.PARAM, "has-param": Op.HAS_PARAM, "segment": Op.SEGMENT,
    "eq": Op.EQ, "neq": Op.NEQ, "starts-with": Op.STARTS_WITH, "ends-with": Op.ENDS_WITH, "contains": Op.CONTAINS,
    "and": Op.AND, "or": Op.OR, "not": Op.NOT,
    "str?": Op.STR_Q, "int?": Op.INT_Q, "arr?": Op.ARR_Q, "quot?": Op.QUOT_Q,
    "concat": Op.CONCAT, "replace": Op.REPLACE, "replace-all": Op.REPLACE_ALL, "substr": Op.SUBSTR,
    "set-param": Op.SET_PARAM, "remove-param": Op.REMOVE_PARAM,
    "split": Op.SPLIT, "param-keys": Op.PARAM_KEYS, "param-values": Op.PARAM_VALUES, "path-segments": Op.PATH_SEGMENTS,
    "len": Op.LEN, "get": Op.GET, "join": Op.JOIN, "indices": Op.INDICES, "slice": Op.SLICE, "zip": Op.ZIP,
    "+": Op.ADD, "-": Op.SUB, "*": Op.MUL, "/": Op.DIV, "%": Op.MOD,
    ">": Op.GT, "<": Op.LT, ">=": Op.GTE, "<=": Op.LTE,
    "call": Op.CALL, "call-if": Op.CALL_IF, "choose": Op.CHOOSE, "each": Op.EACH, "map": Op.MAP, "filter": Op.FILTER,
    "redirect": Op.REDIRECT, "skip": Op.SKIP
};
