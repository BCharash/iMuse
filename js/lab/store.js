// Independent journal for this lab. Never opens an iMuse production database.
export function createLabStore(factory=globalThis.indexedDB) {
 let connection;
 const open=()=>connection||(connection=new Promise((resolve,reject)=>{
  if(!factory){reject(Error('Browser storage is unavailable'));return;}
  const request=factory.open('imuse-simple-recorder-lab',1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('recordings',{keyPath:'id'});const chunks=db.createObjectStore('chunks',{keyPath:['id','sequence']});chunks.createIndex('recording','id');};
  let abandoned=false;request.onblocked=()=>{abandoned=true;reject(Error('Close other copies of the recorder lab'));};
  request.onerror=()=>reject(request.error);request.onsuccess=()=>{if(abandoned){request.result.close();return;}resolve(request.result);};
 }));
 async function write(stores,operation) {const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(stores,'readwrite');operation(tx);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('Storage transaction aborted'));});}
 async function all(store,index,key) {const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),source=index?tx.objectStore(store).index(index):tx.objectStore(store),request=source.getAll(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
 return {
  open,
  list:()=>all('recordings'),
  clear:()=>write(['recordings','chunks'],tx=>{tx.objectStore('recordings').clear();tx.objectStore('chunks').clear();}),
  clearLogs:()=>write(['recordings'],tx=>{
   const request=tx.objectStore('recordings').openCursor();
   request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.update({...cursor.value,reviews:[]});cursor.continue();}};
  }),
  chunks:id=>all('chunks','recording',id),
  put:record=>write(['recordings'],tx=>tx.objectStore('recordings').put(record)),
  append:(id,sequence,audio)=>write(['chunks'],tx=>tx.objectStore('chunks').put({id,sequence,audio})),
  finalize:record=>write(['recordings','chunks'],tx=>{tx.objectStore('recordings').put(record);const request=tx.objectStore('chunks').index('recording').openKeyCursor(IDBKeyRange.only(record.id));request.onsuccess=()=>{const cursor=request.result;if(cursor){tx.objectStore('chunks').delete(cursor.primaryKey);cursor.continue();}};}),
  delete:id=>write(['recordings','chunks'],tx=>{tx.objectStore('recordings').delete(id);const request=tx.objectStore('chunks').index('recording').openKeyCursor(IDBKeyRange.only(id));request.onsuccess=()=>{const cursor=request.result;if(cursor){tx.objectStore('chunks').delete(cursor.primaryKey);cursor.continue();}};})
 };
}
