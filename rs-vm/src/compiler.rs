use std::collections::HashMap;

// ── Token ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum Token {
    Number(i16),
    Str(String),
    Word(String),
    Colon,
    Semicolon,
    LBracket,
    RBracket,
    LBrace,
    RBrace,
}

// ── Lexer ──────────────────────────────────────────────────────────────

pub fn tokenize(source: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = source.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut tokens = Vec::new();

    while i < len {
        let ch = chars[i];

        // Whitespace
        if ch.is_whitespace() {
            i += 1;
            continue;
        }

        // Line comments
        if ch == '#' {
            while i < len && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        // Inline comments ( ... )
        if ch == '(' {
            i += 1; // skip '('
            while i < len && chars[i] != ')' {
                i += 1;
            }
            if i >= len {
                return Err("Unterminated comment block".to_string());
            }
            i += 1; // skip ')'
            continue;
        }

        // Syntax characters
        match ch {
            ':' => { tokens.push(Token::Colon); i += 1; continue; }
            ';' => { tokens.push(Token::Semicolon); i += 1; continue; }
            '[' => { tokens.push(Token::LBracket); i += 1; continue; }
            ']' => { tokens.push(Token::RBracket); i += 1; continue; }
            '{' => { tokens.push(Token::LBrace); i += 1; continue; }
            '}' => { tokens.push(Token::RBrace); i += 1; continue; }
            _ => {}
        }

        // Strings
        if ch == '"' {
            i += 1; // skip opening '"'
            let mut s = String::new();
            while i < len {
                if chars[i] == '"' {
                    break;
                }
                if chars[i] == '\\' && i + 1 < len {
                    s.push(chars[i + 1]);
                    i += 2;
                } else {
                    s.push(chars[i]);
                    i += 1;
                }
            }
            if i >= len {
                return Err("Unterminated string literal".to_string());
            }
            i += 1; // skip closing '"'
            tokens.push(Token::Str(s));
            continue;
        }

        // Numbers and negative numbers
        if ch.is_ascii_digit() || (ch == '-' && i + 1 < len && chars[i + 1].is_ascii_digit()) {
            let mut num_str = String::new();
            if ch == '-' {
                num_str.push('-');
                i += 1;
            }
            while i < len && chars[i].is_ascii_digit() {
                num_str.push(chars[i]);
                i += 1;
            }
            let val: i32 = num_str.parse().map_err(|e| format!("Invalid number: {}", e))?;
            // 16-bit signed wrapping
            tokens.push(Token::Number(val as i16));
            continue;
        }

        // Words
        if is_word_start(ch) {
            let mut word = String::new();
            while i < len && is_word_char(chars[i]) {
                word.push(chars[i]);
                i += 1;
            }
            tokens.push(Token::Word(word));
            continue;
        }

        return Err(format!("Unexpected character: '{}'", ch));
    }

    Ok(tokens)
}

fn is_word_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || matches!(ch, '_' | '$' | '?' | '+' | '-' | '*' | '/' | '%' | '>' | '<')
}

fn is_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '_' | '$' | '-' | '?' | '+' | '*' | '/' | '%' | '>' | '<' | '=')
}

// ── Builtin Map ────────────────────────────────────────────────────────

fn builtin_op(name: &str) -> Option<u8> {
    match name {
        "dup" => Some(10), "drop" => Some(11), "swap" => Some(12),
        "over" => Some(13), "rot" => Some(14), "$t" => Some(15),

        "host" => Some(20), "path" => Some(21), "proto" => Some(22),
        "port" => Some(23), "hash" => Some(24), "param" => Some(25),
        "has-param" => Some(26), "segment" => Some(27),

        "eq" => Some(30), "neq" => Some(31), "starts-with" => Some(32),
        "ends-with" => Some(33), "contains" => Some(34),
        "and" => Some(35), "or" => Some(36), "not" => Some(37),

        "str?" => Some(38), "int?" => Some(39), "arr?" => Some(40), "quot?" => Some(41),

        "concat" => Some(45), "replace" => Some(46), "replace-all" => Some(47), "substr" => Some(48),

        "set-param" => Some(50), "remove-param" => Some(51),

        "split" => Some(60), "param-keys" => Some(61), "param-values" => Some(62),
        "path-segments" => Some(63), "len" => Some(64), "get" => Some(65),
        "join" => Some(66), "indices" => Some(67), "slice" => Some(68), "zip" => Some(69),

        "+" => Some(70), "-" => Some(71), "*" => Some(72), "/" => Some(73), "%" => Some(74),
        ">" => Some(75), "<" => Some(76), ">=" => Some(77), "<=" => Some(78),

        "call" => Some(80), "call-if" => Some(81), "choose" => Some(82),
        "each" => Some(83), "map" => Some(84), "filter" => Some(85),

        "redirect" => Some(90), "skip" => Some(91),
        _ => None,
    }
}

// ── Opcode constants ───────────────────────────────────────────────────

const OP_PUSH_STR: u8 = 1;
const OP_PUSH_INT: u8 = 2;
const OP_JUMP: u8 = 3;
const OP_PUSH_BLOCK: u8 = 101;
const OP_RETURN: u8 = 102;
const OP_CALL_CUSTOM: u8 = 103;
const OP_MAKE_ARRAY: u8 = 104;

// ── Compiler ───────────────────────────────────────────────────────────

struct PatchEntry {
    idx: usize,
    name: String,
}

pub fn compile(source: &str) -> Result<(Vec<u8>, Vec<String>), String> {
    let tokens = tokenize(source)?;
    let mut bytecode: Vec<u8> = Vec::new();
    let mut constants: Vec<String> = Vec::new();
    let mut definitions: Vec<(String, Vec<Token>)> = Vec::new();
    let mut main_tokens: Vec<Token> = Vec::new();

    // ── First pass: separate word definitions from main tokens ──
    let mut i = 0;
    while i < tokens.len() {
        match &tokens[i] {
            Token::Colon => {
                if i + 1 >= tokens.len() {
                    return Err("Expected word name after ':'".to_string());
                }
                let name = match &tokens[i + 1] {
                    Token::Word(w) => w.clone(),
                    _ => return Err("Expected word name after ':'".to_string()),
                };
                if builtin_op(&name).is_some() {
                    return Err(format!("Compile Error: Word definition for '{}' overrides a built-in word.", name));
                }
                i += 2;
                let start = i;
                let mut depth = 0i32;
                while i < tokens.len() {
                    match &tokens[i] {
                        Token::Colon => depth += 1,
                        Token::Semicolon => {
                            if depth == 0 { break; }
                            depth -= 1;
                        }
                        _ => {}
                    }
                    i += 1;
                }
                if i >= tokens.len() {
                    return Err(format!("Unterminated definition for word '{}'", name));
                }
                definitions.push((name, tokens[start..i].to_vec()));
                i += 1; // skip semicolon
            }
            _ => {
                main_tokens.push(tokens[i].clone());
                i += 1;
            }
        }
    }

    // Collect definition names for lookup
    let def_names: Vec<String> = definitions.iter().map(|(n, _)| n.clone()).collect();

    let mut patch_list: Vec<PatchEntry> = Vec::new();

    // ── Emit helpers ──

    fn emit(bytecode: &mut Vec<u8>, op: u8, arg: Option<u16>) -> usize {
        let idx = bytecode.len();
        bytecode.push(op);
        if let Some(a) = arg {
            bytecode.push((a & 0xFF) as u8);
            bytecode.push(((a >> 8) & 0xFF) as u8);
        }
        idx
    }

    fn patch16(bytecode: &mut [u8], idx: usize, val: u16) {
        bytecode[idx] = (val & 0xFF) as u8;
        bytecode[idx + 1] = ((val >> 8) & 0xFF) as u8;
    }

    // ── Compile pass ──

    fn compile_pass(
        ts: &[Token],
        is_block: bool,
        bytecode: &mut Vec<u8>,
        constants: &mut Vec<String>,
        def_names: &[String],
        patch_list: &mut Vec<PatchEntry>,
    ) -> Result<usize, String> {
        let mut j = 0;
        let mut pushed = 0usize;

        while j < ts.len() {
            match &ts[j] {
                Token::Number(n) => {
                    emit(bytecode, OP_PUSH_INT, Some(*n as u16));
                    pushed += 1;
                }
                Token::Str(s) => {
                    let cidx = constants.iter().position(|c| c == s).unwrap_or_else(|| {
                        let idx = constants.len();
                        constants.push(s.clone());
                        idx
                    });
                    emit(bytecode, OP_PUSH_STR, Some(cidx as u16));
                    pushed += 1;
                }
                Token::Word(name) => {
                    if let Some(op) = builtin_op(name) {
                        emit(bytecode, op, None);
                    } else if def_names.contains(name) {
                        let op_idx = emit(bytecode, OP_CALL_CUSTOM, Some(0));
                        patch_list.push(PatchEntry { idx: op_idx + 1, name: name.clone() });
                    } else {
                        return Err(format!("Unknown word during compilation: {}", name));
                    }
                }
                Token::LBracket => {
                    // Collect block tokens with depth tracking
                    j += 1;
                    let start = j;
                    let mut depth = 0i32;
                    while j < ts.len() {
                        match &ts[j] {
                            Token::LBracket => depth += 1,
                            Token::RBracket => {
                                if depth == 0 { break; }
                                depth -= 1;
                            }
                            _ => {}
                        }
                        j += 1;
                    }
                    let block_tokens = &ts[start..j];

                    // Bytecode layout: [PUSH_BLOCK][body_addr:16][JUMP][next_addr:16][body...][RETURN]
                    let push_op_idx = emit(bytecode, OP_PUSH_BLOCK, Some(0));
                    let jump_op_idx = emit(bytecode, OP_JUMP, Some(0));
                    let body_addr = bytecode.len() as u16;
                    patch16(bytecode, push_op_idx + 1, body_addr);
                    compile_pass(block_tokens, true, bytecode, constants, def_names, patch_list)?;
                    let next_addr = bytecode.len() as u16;
                    patch16(bytecode, jump_op_idx + 1, next_addr);
                    pushed += 1;
                }
                Token::LBrace => {
                    // Collect array tokens with depth tracking
                    j += 1;
                    let start = j;
                    let mut depth = 0i32;
                    while j < ts.len() {
                        match &ts[j] {
                            Token::LBrace => depth += 1,
                            Token::RBrace => {
                                if depth == 0 { break; }
                                depth -= 1;
                            }
                            _ => {}
                        }
                        j += 1;
                    }
                    let array_tokens = &ts[start..j];
                    let inner_count = compile_pass(array_tokens, false, bytecode, constants, def_names, patch_list)?;
                    emit(bytecode, OP_MAKE_ARRAY, Some(inner_count as u16));
                    pushed += 1;
                }
                Token::RBracket | Token::RBrace | Token::Semicolon => {
                    // skip silently, bounds handled above
                }
                Token::Colon => {
                    // Should not appear in main tokens, skip
                }
            }
            j += 1;
        }

        if is_block {
            emit(bytecode, OP_RETURN, None);
        }

        Ok(pushed)
    }

    // ── Emit main body ──
    compile_pass(&main_tokens, false, &mut bytecode, &mut constants, &def_names, &mut patch_list)?;

    // ── Emit custom word bodies ──
    let end_jump_op_idx = emit(&mut bytecode, OP_JUMP, Some(0));
    let mut custom_word_ips: HashMap<String, usize> = HashMap::new();

    for (name, def_tokens) in &definitions {
        custom_word_ips.insert(name.clone(), bytecode.len());
        compile_pass(def_tokens, true, &mut bytecode, &mut constants, &def_names, &mut patch_list)?;
    }

    let end_addr = bytecode.len() as u16;
    patch16(&mut bytecode, end_jump_op_idx + 1, end_addr);

    // ── Patch forward references ──
    for patch in &patch_list {
        if let Some(&ip) = custom_word_ips.get(&patch.name) {
            patch16(&mut bytecode, patch.idx, ip as u16);
        } else {
            return Err(format!("Compiler internal linking error for: {}", patch.name));
        }
    }

    Ok((bytecode, constants))
}
