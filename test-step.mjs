import { Compiler } from './compiler.js';
import { VM } from './vm.js';

const source = 'dup param-keys [ "utm_" starts-with not ] filter drop redirect';
const url = 'https://example.com/?utm_source=a&valid=b&utm_medium=c';

const { bytecode, constants } = Compiler.compile(source);

// Step debugger
const session = VM.createDebugSession(bytecode, constants, url);
let steps = 0;
while (!session.done && steps < 200) {
  VM.stepSession(session);
  steps++;
}

console.log('Steps:', steps);
console.log('Redirect:', session.state.redirectUrl);
console.log('Error:', session.state.error);

// Direct execute
const result = VM.execute(bytecode, constants, url);
console.log('Execute redirect:', result.redirect);
console.log('Match:', session.state.redirectUrl === result.redirect);
