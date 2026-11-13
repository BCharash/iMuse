import {combineM4a} from './recording-combine-mux.js';
self.onmessage=async({data})=>{
    try {const result=await combineM4a(data.recordings,message=>self.postMessage({progress:message}));self.postMessage({result});}
    catch(error){self.postMessage({error:error.message||String(error)});}
};
