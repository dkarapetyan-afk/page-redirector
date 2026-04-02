import { Interpreter } from './interpreter.js';
import { Compiler } from './compiler.js';
import { VM } from './vm.js';

const vm = new Interpreter();

function test(source, url, expectedUrl) {
    console.log(`\nTesting: ${source}`);
    console.log(`URL: ${url}`);
    
    // AST Test
    const astResult = vm.execute(source, url);
    if (!astResult.success) {
        console.error("AST FAIL - Error:", astResult.error);
    } else if (astResult.redirect !== expectedUrl) {
        console.error(`AST FAIL - Expected ${expectedUrl}, got ${astResult.redirect}`);
    } else {
        console.log(`AST PASS - Redirects to: ${astResult.redirect} (ops: ${astResult.ops})`);
    }

    // Compiled VM Test
    try {
        const { bytecode, constants } = Compiler.compile(source);
        const vmResult = VM.execute(bytecode, constants, url);
        if (!vmResult.success) {
            console.error("COMPILER FAIL - Error:", vmResult.error);
        } else if (vmResult.redirect !== expectedUrl) {
            console.error(`COMPILER FAIL - Expected ${expectedUrl}, got ${vmResult.redirect}`);
        } else {
            console.log(`COMPILER PASS - Redirects to: ${vmResult.redirect} (ops: ${vmResult.ops})`);
        }
    } catch(err) {
        console.error(`COMPILER CRASH - ${err.message}`);
    }
}

// 1. Simple Host Redirect
test(
    'dup host "old-site.com" eq [ drop "https://new-site.com" redirect ] call-if',
    'https://old-site.com/foo',
    'https://new-site.com'
);

// 2. Strip tracking
test(
    `dup "utm_source" has-param 
    [ "utm_source" remove-param "utm_medium" remove-param redirect ] call-if`,
    'https://example.com/page?utm_source=twitter&utm_medium=social&foo=bar',
    'https://example.com/page?foo=bar'
);

// 3. Conditional filter of tracking params
test(
    `dup param-keys
    [ "utm_" starts-with not ] filter
    drop redirect`,
    'https://example.com/?utm_source=a&valid=b&utm_medium=c',
    null // we didn't implement rebuilding the URL from keys here, just drop redirect to null
);

// 4. Custom Words
test(
    `: force-https ( url -- url' )
       "http://" "https://" replace-all ;
     : normalize ( url -- url' )
       force-https ;
       
     dup host "example.com" contains
     [ normalize redirect ] call-if`,
    'http://www.example.com/login',
    'https://www.example.com/login'
);

// 5. Recursion
// Removes all occurrences of "foo" one by one recursively
test(
    `: strip-foo ( str -- str' )
       dup "foo" contains
       [ "foo" "" replace strip-foo ]
       [ ]
       choose ;
       
     path strip-foo redirect`,
    'https://example.com/foo/bar/foo/baz',
    '//bar//baz'
);

// 6. Deep Recursion (Testing budget/stack limits conceptually)
// Recursively consume segments of a path until only the last one is left
test(
    `: last-segment ( arr -- str )
       dup len 1 eq
       [ 0 get ]
       [ 1 255 slice last-segment ]
       choose ;
       
     path-segments last-segment redirect`,
    'https://example.com/a/b/c/d/e',
    'e'
);

// 7. Static Array Literals
test(
    `{ "apple" "banana" "cherry" } 2 get redirect`,
    'https://example.com/foo',
    'cherry'
);

// 8. Nested Block and Array Compilation
test(
    `{ "level1" { "hidden" "level2" } [ drop "nested block" ] } 
     1 get 1 get redirect`,
    'https://example.com/foo',
    'level2'
);
