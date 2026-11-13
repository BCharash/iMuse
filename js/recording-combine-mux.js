import {Input, MP4, BlobSource, EncodedPacketSink, Output, Mp4OutputFormat,
    StreamTarget, EncodedAudioPacketSource} from './vendor/mediabunny-1.65.2.mjs';
import {readCombineMetadata, originalCombineMetadata, planCombinedRecording, provenanceBox} from './recording-combine-metadata.js';

const check=(value,message)=>{if(!value)throw Error(message);};
const signature=config=>JSON.stringify([config.codec,config.sampleRate,config.numberOfChannels,
    Array.from(config.description ? new Uint8Array(config.description.buffer || config.description,
        config.description.byteOffset || 0,config.description.byteLength) : [])]);
const samples=(packet,rate)=>{
    const count=Math.round(packet.duration*rate);
    check(count>0 && Math.abs(packet.duration*rate-count)<.1,'An M4A packet has unsupported timing.');return count;
};

// Keep compressed chunks as Blobs. Header patches replace only the affected
// ranges; no full PCM decode or full-file ArrayBuffer is needed.
export function createCombineBlobWriter() {
    let parts=[],length=0;
    return {
        write({data,position}) {
            check(Number.isSafeInteger(position)&&position>=0&&position<=length,'Invalid M4A output position.');
            const end=position+data.byteLength,next=[];
            for(const part of parts) {
                if(part.end<=position||part.start>=end)next.push(part);
                else {
                    if(part.start<position)next.push({start:part.start,end:position,blob:part.blob.slice(0,position-part.start)});
                    if(part.end>end)next.push({start:end,end:part.end,blob:part.blob.slice(end-part.start)});
                }
            }
            next.push({start:position,end,blob:new Blob([data])});parts=next.sort((a,b)=>a.start-b.start);length=Math.max(length,end);
        },
        blob() {let offset=0;for(const part of parts){check(part.start===offset,'M4A output has a missing range.');offset=part.end;}return new Blob(parts.map(part=>part.blob),{type:'audio/mp4'});}
    };
}

export async function combineM4a(recordings, onProgress=()=>{}) {
    const opened=[];
    let output;
    try {
        let configKey=null;
        for(const [index,recording] of recordings.entries()) {
            onProgress(`Reading recording ${index+1} of ${recordings.length}…`);
            const input=new Input({source:new BlobSource(recording.blob),formats:[MP4]});opened.push({input});
            const tracks=await input.getAudioTracks();
            check(tracks.length===1 && !(await input.getVideoTracks()).length,'Combine supports recordings with one AAC audio track in M4A format.');
            const track=tracks[0],config=await track.getDecoderConfig();
            check(await track.getCodec()==='aac'&&config,'Combine currently supports M4A/AAC recordings.');
            const key=signature(config);check(configKey===null||configKey===key,'These recordings have different AAC formats, sample rates, or channels and cannot be combined.');configKey=key;
            const embedded=await readCombineMetadata(recording.blob);
            const starts=new Map(), boundaries=new Set(embedded ? embedded.segments.map(segment=>segment.outputPacketStart) : [0]);
            const sink=new EncodedPacketSink(track);let packetCount=0,sampleCount=0;
            for await(const packet of sink.packets(undefined,undefined,{metadataOnly:true})) {
                if(boundaries.has(packetCount))starts.set(packetCount,packet);
                packetCount++;sampleCount+=samples(packet,config.sampleRate);
            }
            check(packetCount>0,'A selected recording has no audio packets.');
            if(recording.session.combineMetadata)check(embedded&&JSON.stringify(embedded)===JSON.stringify(recording.session.combineMetadata),'Stored and embedded source histories disagree.');
            const metadata=embedded || originalCombineMetadata(recording.session,{sampleRate:config.sampleRate,
                channels:config.numberOfChannels,packetCount,sampleCount},recording.filename,()=>crypto.randomUUID());
            check(metadata.id===recording.session.id&&metadata.packetCount===packetCount&&metadata.sampleCount===sampleCount&&metadata.sampleRate===config.sampleRate&&metadata.channels===config.numberOfChannels,'Source history does not match the selected M4A audio.');
            Object.assign(opened[index],{sink,starts,config,metadata,filename:recording.filename});
        }
        const plan=planCombinedRecording(opened,{uuid:()=>crypto.randomUUID()});
        const writer=createCombineBlobWriter();
        output=new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(new WritableStream({write:chunk=>writer.write(chunk)}),{chunked:true,chunkSize:1024*1024})});
        const source=new EncodedAudioPacketSource('aac');output.addAudioTrack(source);await output.start();
        let position=0,packetCount=0;
        for(const [index,piece] of plan.pieces.entries()) {
            onProgress(`Combining source ${index+1} of ${plan.pieces.length}…`);
            const parent=opened[piece.inputIndex];let copied=0,pieceSamples=0;
            const boundary=parent.starts.get(piece.inputPacketStart);
            check(boundary,'A source boundary is missing.');
            const first=await parent.sink.getPacket(boundary.timestamp);
            check(first&&first.sequenceNumber===boundary.sequenceNumber,'A source boundary cannot be located exactly.');
            for await(const packet of parent.sink.packets(first)) {
                if(copied===piece.packetCount)break;
                const count=samples(packet,parent.config.sampleRate);
                await source.add(packet.clone({timestamp:position/parent.config.sampleRate,duration:count/parent.config.sampleRate}),packetCount===0?{decoderConfig:parent.config}:undefined);
                copied++;packetCount++;position+=count;pieceSamples+=count;
            }
            check(copied===piece.packetCount&&pieceSamples===piece.sampleCount,'A source segment is incomplete.');
        }
        check(packetCount===plan.metadata.packetCount&&position===plan.metadata.sampleCount,'Combined output length mismatch.');
        source.close();await output.finalize();
        const blob=new Blob([writer.blob(),provenanceBox(plan.metadata)],{type:'audio/mp4'});
        onProgress('Checking combined recording…');
        // Parse the actual output independently before it can become a saved item.
        const verification=new Input({source:new BlobSource(blob),formats:[MP4]});
        try {
            const track=await verification.getPrimaryAudioTrack();check(track,'Combined audio track is missing.');
            check(signature(await track.getDecoderConfig())===configKey,'Combined AAC configuration changed.');
            let count=0,total=0;
            for await(const packet of new EncodedPacketSink(track).packets(undefined,undefined,{metadataOnly:true})) {count++;total+=samples(packet,plan.metadata.sampleRate);}
            check(count===packetCount&&total===position,'Combined M4A failed packet readback.');
            check(JSON.stringify(await readCombineMetadata(blob))===JSON.stringify(plan.metadata),'Combined source history failed readback.');
        } finally {verification.dispose();}
        return {blob,metadata:plan.metadata};
    } catch(error) {
        if(output&&output.state!=='finalized')await output.cancel().catch(()=>{});
        throw error;
    } finally {for(const {input} of opened)input.dispose();}
}
