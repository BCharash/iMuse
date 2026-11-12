// Shadow verification only. No microphone access or recording/command decisions.
export function wakePhrasePresent(text,engine) {
 const words=String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/);
 const phrase=engine==='heed'?['hey','imuse']:engine==='voicute'?['hey','friday']:null;
 return !!phrase&&words.some((word,index)=>word===phrase[0]&&words[index+1]===phrase[1]);
}
export function createWakeVerifier({transcribe,onUpdate,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,budgetMs=500,timeoutMs=15000}) {
 let busy=false;
 return {
  get busy(){return busy;},
  async submit(event,samples,{engine,transportMs=0,shortPreRoll=false}={}) {
   if(busy){onUpdate(event,{status:'skipped-busy'});return;}
   if(!samples.length){onUpdate(event,{status:'no-audio'});return;}
   busy=true;const began=now();let timedOut=false;
   const base={engine,expectedPhrase:engine==='heed'?'Hey iMuse':'Hey Friday',sampleSeconds:samples.length/16000,transportMs,shortPreRoll,budgetMs};
   onUpdate(event,{...base,status:'checking'});
   // A deadline never frees the lane while the worker is still computing.
   const timer=setTimer(()=>{timedOut=true;onUpdate(event,{...base,status:'timed-out',elapsedMs:now()-began});},timeoutMs);
   try {
    const result=await transcribe(samples),elapsedMs=now()-began,totalMs=elapsedMs+transportMs;
    onUpdate(event,{...base,status:timedOut?'late-result':'complete',text:result.text,phrasePresent:wakePhrasePresent(result.text,engine),inferenceMs:result.inferenceMs,elapsedMs,totalMs,withinBudget:totalMs<=budgetMs});
   }catch(error){onUpdate(event,{...base,status:'error',message:error.message,elapsedMs:now()-began});}
   finally{clearTimer(timer);busy=false;}
  }
 };
}
