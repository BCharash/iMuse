"""New recording UUIDs only; no audio, real database, legacy migration or exports."""
import unittest
from recording_test_support import SOURCE, evaluate

start = SOURCE.index("        const id = (() => {", SOURCE.index("async function startRecording()"))
end = SOURCE.index("        newSessionId = id;", start)
creation = SOURCE[start:end]
fixture = "const create = new Function('crypto', " + __import__('json').dumps(creation + '\nreturn id;') + ");\n"
fixture += "const assert=(value,message)=>{if(!value)throw Error(message);};\n"
fixture += "const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;\n"

class RecordingIdTests(unittest.TestCase):
    def test_native_uuid_is_preserved_and_generated_once(self):
        evaluate(fixture + r"""
let calls=0;
const expected='4cd30ed1-dad7-4f9b-876c-0ba7f9d53ed9';
const id=create({randomUUID(){calls++;return expected;},getRandomValues(){throw Error('unexpected fallback');}});
assert(id===expected&&calls===1,'native UUID changed or generated repeatedly');
globalThis.testResult='PASS';
""")

    def test_cryptographic_fallback_produces_v4_uuid_and_distinct_ids(self):
        evaluate(fixture + r"""
let calls=0;
const provider={getRandomValues(bytes){bytes.fill(++calls);return bytes;}};
const first=create(provider),second=create(provider);
assert(uuid.test(first)&&uuid.test(second),'invalid UUID version/variant/format');
assert(first!==second&&calls===2,'fresh recordings reuse an ID');
assert(first==='01010101-0101-4101-8101-010101010101','unexpected fallback serialization');
globalThis.testResult='PASS';
""")

    def test_randomness_failure_never_falls_back_to_weak_identity(self):
        evaluate(fixture + r"""
let rejected=false;
try{create({getRandomValues(){throw Error('randomness unavailable');}});}catch(e){rejected=e.message==='randomness unavailable';}
assert(rejected,'randomness failure silently generated an ID');
globalThis.testResult='PASS';
""")

    def test_generation_stays_in_startup_before_session_persistence(self):
        self.assertEqual(SOURCE.count("const id = (() => {"), 1)
        self.assertLess(start, SOURCE.index("await putSession(metadata);", start))
        self.assertNotIn("Math.random", creation)
        self.assertIn("newSessionId = id;", SOURCE[end:end + 80])

if __name__ == '__main__':
    unittest.main()