use std::fmt;
use serde::{Serialize, Deserialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Value {
    Int(i16),
    Str(String),
    Array(Vec<Value>),
    Null,
}

impl Value {
    pub fn is_truthy(&self) -> bool {
        match self {
            Value::Int(i) => *i != 0,
            Value::Str(s) => !s.is_empty(),
            Value::Array(a) => !a.is_empty(),
            Value::Null => false,
        }
    }

    pub fn to_str(&self) -> String {
        match self {
            Value::Int(i) => i.to_string(),
            Value::Str(s) => s.clone(),
            Value::Array(a) => format!("{:?}", a),
            Value::Null => "".to_string(),
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_str())
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    PushStr = 1, PushInt = 2, Jump = 3,
    Dup = 10, Drop = 11, Swap = 12, Over = 13, Rot = 14, T = 15,
    Host = 20, Path = 21, Proto = 22, Port = 23, Hash = 24,
    Param = 25, HasParam = 26, Segment = 27,
    Eq = 30, Neq = 31, StartsWith = 32, EndsWith = 33, Contains = 34,
    And = 35, Or = 36, Not = 37,
    StrQ = 38, IntQ = 39, ArrQ = 40, QuotQ = 41,
    Concat = 45, Replace = 46, ReplaceAll = 47, Substr = 48,
    SetParam = 50, RemoveParam = 51,
    Split = 60, ParamKeys = 61, ParamValues = 62, PathSegments = 63,
    Len = 64, Get = 65, Join = 66, Indices = 67, Slice = 68, Zip = 69,

    Add = 70, Sub = 71, Mul = 72, Div = 73, Mod = 74,
    Gt = 75, Lt = 76, Gte = 77, Lte = 78,

    Call = 80, CallIf = 81, Choose = 82, Each = 83, Map = 84, Filter = 85,
    Redirect = 90, Skip = 91,
    PushBlock = 101, Return = 102, CallCustom = 103, MakeArray = 104,
}

impl From<u8> for Op {
    fn from(v: u8) -> Self {
        match v {
            1 => Op::PushStr, 2 => Op::PushInt, 3 => Op::Jump,
            10 => Op::Dup, 11 => Op::Drop, 12 => Op::Swap, 13 => Op::Over, 14 => Op::Rot, 15 => Op::T,
            20 => Op::Host, 21 => Op::Path, 22 => Op::Proto, 23 => Op::Port, 24 => Op::Hash,
            25 => Op::Param, 26 => Op::HasParam, 27 => Op::Segment,
            30 => Op::Eq, 31 => Op::Neq, 32 => Op::StartsWith, 33 => Op::EndsWith, 34 => Op::Contains,
            35 => Op::And, 36 => Op::Or, 37 => Op::Not,
            38 => Op::StrQ, 39 => Op::IntQ, 40 => Op::ArrQ, 41 => Op::QuotQ,
            45 => Op::Concat, 46 => Op::Replace, 47 => Op::ReplaceAll, 48 => Op::Substr,
            50 => Op::SetParam, 51 => Op::RemoveParam,
            60 => Op::Split, 61 => Op::ParamKeys, 62 => Op::ParamValues, 63 => Op::PathSegments,
            64 => Op::Len, 65 => Op::Get, 66 => Op::Join, 67 => Op::Indices, 68 => Op::Slice, 69 => Op::Zip,
            70 => Op::Add, 71 => Op::Sub, 72 => Op::Mul, 73 => Op::Div, 74 => Op::Mod,
            75 => Op::Gt, 76 => Op::Lt, 77 => Op::Gte, 78 => Op::Lte,
            80 => Op::Call, 81 => Op::CallIf, 82 => Op::Choose, 83 => Op::Each, 84 => Op::Map, 85 => Op::Filter,
            90 => Op::Redirect, 91 => Op::Skip,
            101 => Op::PushBlock, 102 => Op::Return, 103 => Op::CallCustom, 104 => Op::MakeArray,
            _ => panic!("Unknown opcode: {}", v),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IterType { Each, Map, Filter }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IterFrame {
    pub itype: IterType,
    pub block_ip: usize,
    pub return_ip: usize,
    pub arr: Vec<Value>,
    pub index: usize,
    pub results: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Frame {
    Call(usize),
    Iter(IterFrame),
}

pub struct VM<'a> {
    pub ip: usize,
    pub bytecode: &'a [u8],
    pub constants: &'a [String],
    pub stack: Vec<Value>,
    pub call_stack: Vec<Frame>,
    pub ops: u32,
    pub redirect_url: Option<String>,
    pub max_ops: u32,
    pub max_call_stack: usize,
    pub url_cache: Option<(String, Url)>,
}

#[derive(Serialize, Deserialize)]
pub struct VMResult {
    pub success: bool,
    pub redirect: Option<String>,
    pub stack: Vec<Value>,
    pub ops: u32,
    pub error: Option<String>,
}

impl<'a> VM<'a> {
    pub fn new(bytecode: &'a [u8], constants: &'a [String], initial_url: String, max_ops: u32, max_call_stack: usize) -> Self {
        let url_cache = Url::parse(&initial_url).ok().map(|u| (initial_url.clone(), u));
        Self {
            ip: 0,
            bytecode,
            constants,
            stack: vec![Value::Str(initial_url)],
            call_stack: Vec::new(),
            ops: 0,
            redirect_url: None,
            max_ops,
            max_call_stack,
            url_cache,
        }
    }

    fn pop_val(&mut self) -> Value {
        self.stack.pop().unwrap_or(Value::Null)
    }

    fn get_url(&mut self, url_str: String) -> Option<&Url> {
        let matches = if let Some((ref s, _)) = self.url_cache {
            s == &url_str
        } else {
            false
        };

        if matches {
            return self.url_cache.as_ref().map(|(_, u)| u);
        }

        if let Ok(u) = Url::parse(&url_str) {
            self.url_cache = Some((url_str, u));
            return self.url_cache.as_ref().map(|(_, u)| u);
        }
        None
    }

    pub fn execute(&mut self) -> VMResult {
        while self.ip < self.bytecode.len() || !self.call_stack.is_empty() {
            if self.ip >= self.bytecode.len() {
                if self.call_stack.is_empty() { break; }
                self.handle_return();
                continue;
            }

            self.ops += 1;
            if self.ops > self.max_ops {
                return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Maximum operations exceeded")) };
            }

            let op_byte = self.bytecode[self.ip];
            self.ip += 1;
            let op = Op::from(op_byte);

            match op {
                Op::PushInt => {
                    let val = ((self.bytecode[self.ip] as u16) | ((self.bytecode[self.ip + 1] as u16) << 8)) as i16;
                    self.ip += 2;
                    self.stack.push(Value::Int(val));
                }
                Op::PushStr => {
                    let idx = (self.bytecode[self.ip] as usize) | ((self.bytecode[self.ip + 1] as usize) << 8);
                    self.ip += 2;
                    self.stack.push(Value::Str(self.constants[idx].clone()));
                }
                Op::Jump => {
                    let tgt = (self.bytecode[self.ip] as usize) | ((self.bytecode[self.ip + 1] as usize) << 8);
                    self.ip = tgt;
                }
                Op::PushBlock => {
                    // PUSH_BLOCK also pushes an IP/integer
                    let val = ((self.bytecode[self.ip] as u16) | ((self.bytecode[self.ip + 1] as u16) << 8)) as i16;
                    self.ip += 2;
                    self.stack.push(Value::Int(val));
                }
                Op::Return => {
                    if self.call_stack.is_empty() {
                        return VMResult { success: true, redirect: self.redirect_url.clone(), stack: self.stack.clone(), ops: self.ops, error: None };
                    }
                    self.handle_return();
                }
                Op::CallCustom => {
                    if self.call_stack.len() >= self.max_call_stack {
                        return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Call stack overflow")) };
                    }
                    let tgt = (self.bytecode[self.ip] as usize) | ((self.bytecode[self.ip + 1] as usize) << 8);
                    self.ip += 2;
                    self.call_stack.push(Frame::Call(self.ip));
                    self.ip = tgt;
                }
                Op::MakeArray => {
                    let len = (self.bytecode[self.ip] as usize) | ((self.bytecode[self.ip + 1] as usize) << 8);
                    self.ip += 2;
                    let mut items = Vec::new();
                    for _ in 0..len {
                        if let Some(v) = self.stack.pop() { items.push(v); }
                    }
                    items.reverse();
                    self.stack.push(Value::Array(items));
                }
                Op::Dup => {
                    if let Some(v) = self.stack.last().cloned() { self.stack.push(v); }
                    else { return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Stack underflow")) }; }
                }
                Op::Drop => { self.stack.pop(); }
                Op::Swap => {
                    let y = self.pop_val();
                    let x = self.pop_val();
                    self.stack.push(y);
                    self.stack.push(x);
                }
                Op::Over => {
                    let y = self.pop_val();
                    let x = self.pop_val();
                    self.stack.push(x.clone());
                    self.stack.push(y);
                    self.stack.push(x);
                }
                Op::Rot => {
                    let z = self.pop_val();
                    let y = self.pop_val();
                    let x = self.pop_val();
                    self.stack.push(y);
                    self.stack.push(z);
                    self.stack.push(x);
                }
                Op::T => { if let Some(v) = self.stack.last().cloned() { self.stack.push(v); } }
                
                Op::Host => {
                    let url_str = self.pop_val().to_str();
                    let val = match self.get_url(url_str) {
                        Some(u) => u.host_str().unwrap_or("").to_string(),
                        None => String::from(""),
                    };
                    self.stack.push(Value::Str(val));
                }
                Op::Path => {
                    let url_str = self.pop_val().to_str();
                    let val = match self.get_url(url_str) {
                        Some(u) => u.path().to_string(),
                        None => String::from(""),
                    };
                    self.stack.push(Value::Str(val));
                }
                Op::Proto => {
                    let url_str = self.pop_val().to_str();
                    let val = match self.get_url(url_str) {
                        Some(u) => u.scheme().to_string(),
                        None => String::from(""),
                    };
                    self.stack.push(Value::Str(val));
                }
                Op::Port => {
                    let url_str = self.pop_val().to_str();
                    let val = match self.get_url(url_str) {
                        Some(u) => u.port().map(|port| port.to_string()).unwrap_or_else(|| "".to_string()),
                        None => String::from(""),
                    };
                    self.stack.push(Value::Str(val));
                }
                Op::Hash => {
                    let url_str = self.pop_val().to_str();
                    let val = match self.get_url(url_str) {
                        Some(u) => u.fragment().unwrap_or("").to_string(),
                        None => String::from(""),
                    };
                    self.stack.push(Value::Str(val));
                }
                Op::Param => {
                    let key = self.pop_val().to_str();
                    let url_str = self.pop_val().to_str();
                    let val = match self.get_url(url_str) {
                        Some(u) => u.query_pairs()
                            .find(|(k, _)| *k == key)
                            .map(|(_, v)| v.into_owned())
                            .unwrap_or_else(|| "".to_string()),
                        None => String::from(""),
                    };
                    self.stack.push(Value::Str(val));
                }
                Op::HasParam => {
                    let key = self.pop_val().to_str();
                    let url_str = self.pop_val().to_str();
                    let has = match self.get_url(url_str) {
                        Some(u) => u.query_pairs().any(|(k, _)| *k == key),
                        None => false,
                    };
                    self.stack.push(Value::Int(if has { 1 } else { 0 }));
                }
                Op::Segment => {
                    let idx = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let url_str = self.pop_val().to_str();
                    let val = match self.get_url(url_str) {
                        Some(u) => {
                            let segs: Vec<&str> = u.path().split('/').filter(|s| !s.is_empty()).collect();
                            segs.get(idx).map(|s| s.to_string()).unwrap_or_else(|| "".to_string())
                        }
                        None => String::from(""),
                    };
                    self.stack.push(Value::Str(val));
                }
                Op::Eq => {
                    let b = self.pop_val();
                    let a = self.pop_val();
                    self.stack.push(Value::Int(if a == b { 1 } else { 0 }));
                }
                Op::Neq => {
                    let b = self.pop_val();
                    let a = self.pop_val();
                    self.stack.push(Value::Int(if a != b { 1 } else { 0 }));
                }
                Op::StartsWith => {
                    let pfx = self.pop_val().to_str();
                    let s = self.pop_val().to_str();
                    self.stack.push(Value::Int(if s.starts_with(&pfx) { 1 } else { 0 }));
                }
                Op::EndsWith => {
                    let sfx = self.pop_val().to_str();
                    let s = self.pop_val().to_str();
                    self.stack.push(Value::Int(if s.ends_with(&sfx) { 1 } else { 0 }));
                }
                Op::Contains => {
                    let sub = self.pop_val().to_str();
                    let s = self.pop_val().to_str();
                    self.stack.push(Value::Int(if s.contains(&sub) { 1 } else { 0 }));
                }
                Op::And => {
                    let b = self.pop_val().is_truthy();
                    let a = self.pop_val().is_truthy();
                    self.stack.push(Value::Int(if a && b { 1 } else { 0 }));
                }
                Op::Or => {
                    let b = self.pop_val().is_truthy();
                    let a = self.pop_val().is_truthy();
                    self.stack.push(Value::Int(if a || b { 1 } else { 0 }));
                }
                Op::Not => {
                    let a = self.pop_val().is_truthy();
                    self.stack.push(Value::Int(if !a { 1 } else { 0 }));
                }
                Op::Add => {
                    let b = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    let a = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    self.stack.push(Value::Int(a.wrapping_add(b)));
                }
                Op::Sub => {
                    let b = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    let a = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    self.stack.push(Value::Int(a.wrapping_sub(b)));
                }
                Op::Mul => {
                    let b = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    let a = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    self.stack.push(Value::Int(a.wrapping_mul(b)));
                }
                Op::Div => {
                    let b = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    let a = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    if b == 0 {
                        return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Division by zero")) };
                    }
                    self.stack.push(Value::Int(a / b));
                }
                Op::Mod => {
                    let b = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    let a = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    if b == 0 {
                        return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Division by zero")) };
                    }
                    self.stack.push(Value::Int(a % b));
                }
                Op::Gt => {
                    let b = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    let a = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    self.stack.push(Value::Int(if a > b { 1 } else { 0 }));
                }
                Op::Lt => {
                    let b = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    let a = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    self.stack.push(Value::Int(if a < b { 1 } else { 0 }));
                }
                Op::Gte => {
                    let b = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    let a = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    self.stack.push(Value::Int(if a >= b { 1 } else { 0 }));
                }
                Op::Lte => {
                    let b = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    let a = match self.pop_val() { Value::Int(i) => i, _ => 0 };
                    self.stack.push(Value::Int(if a <= b { 1 } else { 0 }));
                }
                Op::StrQ => {
                    let has = match self.stack.last() { Some(Value::Str(_)) => 1, _ => 0 };
                    self.stack.push(Value::Int(has));
                }
                Op::IntQ => {
                    let has = match self.stack.last() { Some(Value::Int(_)) => 1, _ => 0 };
                    self.stack.push(Value::Int(has));
                }
                Op::ArrQ => {
                    let has = match self.stack.last() { Some(Value::Array(_)) => 1, _ => 0 };
                    self.stack.push(Value::Int(has));
                }
                Op::QuotQ => {
                    let has = match self.stack.last() { Some(Value::Int(_)) => 1, _ => 0 };
                    self.stack.push(Value::Int(has));
                }
                Op::Concat => {
                    let b = self.pop_val().to_str();
                    let a = self.pop_val().to_str();
                    self.stack.push(Value::Str(a + &b));
                }
                Op::Replace => {
                    let rep = self.pop_val().to_str();
                    let srch = self.pop_val().to_str();
                    let s = self.pop_val().to_str();
                    self.stack.push(Value::Str(s.replacen(&srch, &rep, 1)));
                }
                Op::ReplaceAll => {
                    let rep = self.pop_val().to_str();
                    let srch = self.pop_val().to_str();
                    let s = self.pop_val().to_str();
                    self.stack.push(Value::Str(s.replace(&srch, &rep)));
                }
                Op::Substr => {
                    let l = self.pop_val().to_str().parse::<usize>().unwrap_or(0);
                    let i = self.pop_val().to_str().parse::<usize>().unwrap_or(0);
                    let s = self.pop_val().to_str();
                    let sub = s.chars().skip(i).take(l).collect::<String>();
                    self.stack.push(Value::Str(sub));
                }
                Op::SetParam => {
                    let v = self.pop_val().to_str();
                    let k = self.pop_val().to_str();
                    let url_str = self.pop_val().to_str();
                    if let Ok(mut u) = Url::parse(&url_str) {
                        let mut params: Vec<(String, String)> = u.query_pairs().into_owned().filter(|(pk, _)| pk != &k).collect();
                        params.push((k, v));
                        u.query_pairs_mut().clear().extend_pairs(params);
                        self.stack.push(Value::Str(u.to_string()));
                    } else { self.stack.push(Value::Str(url_str)); }
                }
                Op::RemoveParam => {
                    let k = self.pop_val().to_str();
                    let url_str = self.pop_val().to_str();
                    if let Ok(mut u) = Url::parse(&url_str) {
                        let params: Vec<(String, String)> = u.query_pairs().into_owned().filter(|(pk, _)| pk != &k).collect();
                        u.query_pairs_mut().clear().extend_pairs(params);
                        self.stack.push(Value::Str(u.to_string()));
                    } else { self.stack.push(Value::Str(url_str)); }
                }
                Op::Split => {
                    let d = self.pop_val().to_str();
                    let s = self.pop_val().to_str();
                    let res: Vec<Value> = s.split(&d).map(|v| Value::Str(v.to_string())).collect();
                    self.stack.push(Value::Array(res));
                }
                Op::ParamKeys => {
                    let url_str = self.pop_val().to_str();
                    let keys: Vec<Value> = match self.get_url(url_str) {
                        Some(u) => u.query_pairs().map(|(k, _)| Value::Str(k.into_owned())).collect(),
                        None => vec![],
                    };
                    self.stack.push(Value::Array(keys));
                }
                Op::ParamValues => {
                    let url_str = self.pop_val().to_str();
                    let vals: Vec<Value> = match self.get_url(url_str) {
                        Some(u) => u.query_pairs().map(|(_, v)| Value::Str(v.into_owned())).collect(),
                        None => vec![],
                    };
                    self.stack.push(Value::Array(vals));
                }
                Op::PathSegments => {
                    let url_str = self.pop_val().to_str();
                    let segs: Vec<Value> = match self.get_url(url_str) {
                        Some(u) => u.path().split('/').filter(|s| !s.is_empty()).map(|s| Value::Str(s.to_string())).collect(),
                        None => vec![],
                    };
                    self.stack.push(Value::Array(segs));
                }
                Op::Len => {
                    let a = match self.pop_val() { Value::Array(v) => v.len() as i16, _ => 0 };
                    self.stack.push(Value::Int(a));
                }
                Op::Get => {
                    let i = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let a = match self.pop_val() { Value::Array(v) => v, _ => vec![] };
                    self.stack.push(a.get(i).cloned().unwrap_or(Value::Null));
                }
                Op::Join => {
                    let d = self.pop_val().to_str();
                    let a = match self.pop_val() { Value::Array(v) => v, _ => vec![] };
                    let res = a.iter().map(|v| v.to_str()).collect::<Vec<_>>().join(&d);
                    self.stack.push(Value::Str(res));
                }
                Op::Indices => {
                    let a = match self.pop_val() { Value::Array(v) => v, _ => vec![] };
                    let res: Vec<Value> = (0..a.len()).map(|i| Value::Int(i as i16)).collect();
                    self.stack.push(Value::Array(res));
                }
                Op::Slice => {
                    let n = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let s = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let a = match self.pop_val() { Value::Array(v) => v, _ => vec![] };
                    let end = std::cmp::min(s + n, a.len());
                    let res = if s < a.len() { a[s..end].to_vec() } else { vec![] };
                    self.stack.push(Value::Array(res));
                }
                Op::Zip => {
                    let b = match self.pop_val() { Value::Array(v) => v, _ => vec![] };
                    let a = match self.pop_val() { Value::Array(v) => v, _ => vec![] };
                    let len = std::cmp::min(a.len(), b.len());
                    let mut res = Vec::new();
                    for i in 0..len {
                        res.push(Value::Array(vec![a[i].clone(), b[i].clone()]));
                    }
                    self.stack.push(Value::Array(res));
                }
                Op::Call => {
                    if self.call_stack.len() >= self.max_call_stack {
                        return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Call stack overflow")) };
                    }
                    let push_ip = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    self.call_stack.push(Frame::Call(self.ip));
                    self.ip = push_ip;
                }
                Op::CallIf => {
                    let push_ip = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let flag = self.pop_val().is_truthy();
                    if flag {
                        if self.call_stack.len() >= self.max_call_stack {
                            return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Call stack overflow")) };
                        }
                        self.call_stack.push(Frame::Call(self.ip));
                        self.ip = push_ip;
                    }
                }
                Op::Choose => {
                    let f_ip = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let t_ip = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let flag = self.pop_val().is_truthy();
                    if self.call_stack.len() >= self.max_call_stack {
                        return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Call stack overflow")) };
                    }
                    self.call_stack.push(Frame::Call(self.ip));
                    self.ip = if flag { t_ip } else { f_ip };
                }
                Op::Each => {
                    let block_ip = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let arr = match self.pop_val() { Value::Array(v) => v, _ => vec![] };
                    if arr.is_empty() { continue; }
                    if self.call_stack.len() >= self.max_call_stack {
                        return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Call stack overflow")) };
                    }
                    self.call_stack.push(Frame::Iter(IterFrame {
                        itype: IterType::Each, block_ip, return_ip: self.ip, arr: arr.clone(), index: 0, results: vec![]
                    }));
                    self.stack.push(arr[0].clone());
                    self.ip = block_ip;
                }
                Op::Map => {
                    let block_ip = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let arr = match self.pop_val() { Value::Array(v) => v, _ => vec![] };
                    if arr.is_empty() { self.stack.push(Value::Array(vec![])); continue; }
                    if self.call_stack.len() >= self.max_call_stack {
                        return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Call stack overflow")) };
                    }
                    self.call_stack.push(Frame::Iter(IterFrame {
                        itype: IterType::Map, block_ip, return_ip: self.ip, arr: arr.clone(), index: 0, results: vec![]
                    }));
                    self.stack.push(arr[0].clone());
                    self.ip = block_ip;
                }
                Op::Filter => {
                    let block_ip = match self.pop_val() { Value::Int(i) => i as usize, _ => 0 };
                    let arr = match self.pop_val() { Value::Array(v) => v, _ => vec![] };
                    if arr.is_empty() { self.stack.push(Value::Array(vec![])); continue; }
                    if self.call_stack.len() >= self.max_call_stack {
                        return VMResult { success: false, redirect: None, stack: self.stack.clone(), ops: self.ops, error: Some(String::from("Call stack overflow")) };
                    }
                    self.call_stack.push(Frame::Iter(IterFrame {
                        itype: IterType::Filter, block_ip, return_ip: self.ip, arr: arr.clone(), index: 0, results: vec![]
                    }));
                    self.stack.push(arr[0].clone());
                    self.ip = block_ip;
                }
                Op::Redirect => {
                    let val = self.pop_val();
                    if val != Value::Null {
                        self.redirect_url = Some(val.to_str());
                    } else {
                        self.redirect_url = None;
                    }
                    return VMResult { success: true, redirect: self.redirect_url.clone(), stack: self.stack.clone(), ops: self.ops, error: None };
                }
                Op::Skip => {
                    return VMResult { success: true, redirect: self.redirect_url.clone(), stack: self.stack.clone(), ops: self.ops, error: None };
                }
            }
            if self.redirect_url.is_some() { break; }
        }
        VMResult { success: true, redirect: self.redirect_url.clone(), stack: self.stack.clone(), ops: self.ops, error: None }
    }

    fn handle_return(&mut self) {
        if let Some(frame) = self.call_stack.pop() {
            match frame {
                Frame::Call(return_ip) => self.ip = return_ip,
                Frame::Iter(mut iter) => {
                    let res = match iter.itype {
                        IterType::Each => Value::Null,
                        _ => self.pop_val(),
                    };

                    match iter.itype {
                        IterType::Filter => {
                            if res.is_truthy() { iter.results.push(iter.arr[iter.index].clone()); }
                        }
                        IterType::Map => iter.results.push(res),
                        _ => {}
                    }

                    iter.index += 1;
                    if iter.index < iter.arr.len() {
                        let next_val = iter.arr[iter.index].clone();
                        let block_ip = iter.block_ip;
                        self.call_stack.push(Frame::Iter(iter));
                        self.stack.push(next_val);
                        self.ip = block_ip;
                    } else {
                        // Iteration finished
                        match iter.itype {
                            IterType::Map | IterType::Filter => self.stack.push(Value::Array(iter.results)),
                            _ => {}
                        }
                        self.ip = iter.return_ip;
                    }
                }
            }
        }
    }
}
