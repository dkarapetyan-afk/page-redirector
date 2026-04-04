mod vm;

use wasm_bindgen::prelude::*;
use crate::vm::{VM, VMResult};
use serde_wasm_bindgen;

use serde::Deserialize;

#[derive(Deserialize)]
struct ExecutionOptions {
    #[serde(rename = "maxOps")]
    max_ops: Option<usize>,
    #[serde(rename = "maxCallStack")]
    max_call_stack: Option<usize>,
}

#[wasm_bindgen]
pub fn execute(bytecode: &[u8], constants_js: JsValue, url: String, options_js: JsValue) -> JsValue {
    let constants: Vec<String> = serde_wasm_bindgen::from_value(constants_js).unwrap_or_default();
    let options: ExecutionOptions = serde_wasm_bindgen::from_value(options_js).unwrap_or(ExecutionOptions {
        max_ops: None,
        max_call_stack: None,
    });
    
    let max_ops = options.max_ops.unwrap_or(1_000_000) as u32;
    let max_call_stack = options.max_call_stack.unwrap_or(1000);
    
    let mut vm = VM::new(bytecode, &constants, url, max_ops, max_call_stack);
    let result = vm.execute();
    
    serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}
