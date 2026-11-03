"""Run: python3 tests/test_storage_persistence.py.
Tests browser-policy responses and actual Settings integration with mock APIs/DOM.
Never accesses browser storage, the microphone, or user recordings.
"""
import json
from pathlib import Path
import re
from test_emergency_recordings import evaluate

ROOT = Path(__file__).resolve().parents[1]
controller = (ROOT / 'js/storage-persistence.js').read_text().replace('export ', '')
settings = (ROOT / 'js/settings.js').read_text()
ui = settings[settings.index('// Separate from read-only diagnostics:'):settings.index('// Recording diagnostics are read-only')]

MOCKS = r"""
const assert = (value, message) => { if (!value) throw Error(message); };
const timers = new Map(); let timerId = 0;
function setTimeout(callback) {const id=++timerId;timers.set(id,callback);return id;}
function clearTimeout(id) {timers.delete(id);}
async function flush() {for(let i=0;i<40;i++)await Promise.resolve();}
class Element {
    constructor(){this.children=[];this.events={};}
    setAttribute(){}
    append(...items){this.children.push(...items);}
    appendChild(item){this.append(item);}
    addEventListener(name, handler){this.events[name]=handler;}
    click(){if(!this.disabled)this.events.click?.();}
}
const document={createElement:()=>new Element()};
const panel=new Element(),button=new Element();
let checks=0,requests=0;
const navigator={storage:{async persisted(){checks++;return false;},async persist(){requests++;return true;}}};
"""

TESTS = r"""
globalThis.testResult='pending';
(async()=>{
    let checked=0,requested=0;
    let monitor=createStoragePersistence({async persisted(){checked++;return true;},async persist(){requested++;return true;}});
    assert((await monitor.request()).status==='granted' && requested===0,'already protected avoids redundant request');
    assert(checked===1,'checks live browser state');

    let granted=false;
    const storage={
        async persisted(){assert(this===storage,'persisted method keeps receiver');return granted;},
        async persist(){assert(this===storage,'persist method keeps receiver');requested++;return granted=true;}
    };
    monitor=createStoragePersistence(storage);
    assert((await monitor.check()).status==='not-granted','read-only check reports no protection');
    const pending=monitor.request();
    assert(monitor.request()===pending && monitor.check()===pending,'concurrent actions share one request');
    assert((await pending).status==='granted','accepted request reports protection');
    granted=false;
    assert((await monitor.check()).status==='not-granted','later checks do not trust cached grant');

    monitor=createStoragePersistence({persisted:async()=>false,persist:async()=>false});
    assert((await monitor.request()).status==='not-granted','denial does not imply protection');
    assert(!monitor.snapshot().busy,'denial clears busy state');
    monitor=createStoragePersistence(undefined);
    assert((await monitor.request()).status==='unsupported' && !monitor.snapshot().requestSupported,'absent StorageManager');
    monitor=createStoragePersistence({persisted:async()=>false});
    assert((await monitor.request()).status==='not-granted' && !monitor.snapshot().requestSupported,'query-only implementation');
    monitor=createStoragePersistence({persist:async()=>true});
    assert((await monitor.check()).status==='unsupported','request-only API cannot check');
    assert((await monitor.request()).status==='granted','request-only API can request');

    let throws=true;
    monitor=createStoragePersistence({persisted:()=>{if(throws)throw Error('denied');return false;},persist:async()=>true});
    assert((await monitor.request()).status==='error','synchronous exception reports unknown protection');
    throws=false;
    assert((await monitor.request()).status==='granted','retry succeeds after exception');
    monitor=createStoragePersistence({persisted:async()=>false,persist:async()=>{throw Error('request blocked');}});
    assert((await monitor.request()).error.includes('request blocked'),'request rejection is reported');

    let resolveLate;
    monitor=createStoragePersistence({persisted:()=>new Promise(resolve=>{resolveLate=resolve;})});
    const hung=monitor.check();
    timers.get([...timers.keys()].at(-1))();
    assert((await hung).status==='error' && !monitor.snapshot().busy,'hung policy API releases UI after timeout');
    resolveLate(true);
    await flush();
    assert(monitor.snapshot().status==='error','late result cannot falsely overwrite timeout status');

    assert(storagePersistenceLabel({status:'granted'}).includes('Protected'),'grant label');
    assert(storagePersistenceLabel({status:'not-granted'}).includes('Not granted'),'denial label');
    assert(storagePersistenceLabel({status:'unsupported'}).includes('unsupported'),'unsupported label');

    // Settings code ran its nonblocking startup request before the tests.
    await flush();
    assert(checks===1 && requests===1,'one startup check/request in actual Settings integration');
    assert(panel.children.includes(persistenceSection),'protection is visible in Settings');
    assert(persistenceStatus.textContent==='Protected from automatic eviction','Settings reports granted protection');
    assert(persistenceSection.children.length===3,'protection section has only heading, status and short explanation');
    navigator.storage.persisted=async()=>false;
    panel.hidden=false;
    button.click();
    await flush();
    assert(persistenceStatus.textContent.includes('Not granted'),'opening Settings refreshes live status');
    assert(requests===1,'read-only refresh never prompts');
    navigator.storage.persisted=async()=>true;
    panel.hidden=true;
    button.click();
    await flush();
    assert(persistenceStatus.textContent.includes('Not granted'),'closing Settings does not check again');
    panel.hidden=false;
    button.click();
    await flush();
    assert(persistenceStatus.textContent.includes('Protected'),'reopening Settings rechecks protection');
    assert(timers.size===0,'completed actions clear timeouts');
    globalThis.testResult='PASS';
})().catch(error=>{globalThis.testResult=String(error)+'\n'+(error.stack||'');});
"""

if __name__ == '__main__':
    syntax = re.sub(r'^import .*?;\n', '', settings, flags=re.M).replace('export ', '')
    evaluate('new Function(' + json.dumps(syntax) + ');\n' + MOCKS + controller + ui + TESTS)
    print('PASS: Settings syntax/integration; automatic nonblocking request; grant/denial/unsupported/partial APIs; refresh/retry; concurrent calls; exceptions/timeouts; live status; no data or microphone access')
