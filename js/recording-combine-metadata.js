// Versioned provenance uses encoded AAC packet boundaries, not decoded PCM offsets.
const UUID = Uint8Array.from([0x69,0x4d,0x75,0x73,0x65,0x43,0x6f,0x6d,0x62,0x69,0x6e,0x65,0,0,0,1]);
const MAX_JSON = 1024 * 1024;
const check = (value, message) => { if (!value) throw Error(message); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const copy = value => JSON.parse(JSON.stringify(value));

export function validateCombineMetadata(meta) {
    check(meta?.format === 'imuse-combined-recording' && meta.version === 1, 'Unknown combined recording history.');
    check(typeof meta.id === 'string' && meta.id && date(meta.createdAt), 'Invalid combined recording identity.');
    check(integer(meta.sampleRate) && meta.sampleRate > 0 && integer(meta.channels) && meta.channels > 0, 'Invalid audio configuration.');
    check(integer(meta.packetCount) && meta.packetCount > 0 && integer(meta.sampleCount) && meta.sampleCount > 0, 'Invalid audio length.');
    check(Array.isArray(meta.sources) && Array.isArray(meta.segments) && Array.isArray(meta.parents), 'Missing source history.');
    const sources = new Map(), occurrences = new Set();
    for (const source of meta.sources) {
        check(typeof source.id === 'string' && source.id && !sources.has(source.id) && date(source.capturedAt) && typeof source.filename === 'string' && integer(source.packetCount) && source.packetCount > 0, 'Invalid source snapshot.');
        sources.set(source.id, source);
    }
    let packets = 0, samples = 0;
    for (const segment of meta.segments) {
        const source = sources.get(segment.sourceId);
        check(source && typeof segment.occurrenceId === 'string' && segment.occurrenceId && !occurrences.has(segment.occurrenceId), 'Invalid source occurrence.');
        check(integer(segment.packetCount) && segment.packetCount > 0 && integer(segment.sourcePacketStart) && segment.sourcePacketStart + segment.packetCount <= source.packetCount, 'Invalid source packet range.');
        check(segment.outputPacketStart === packets && integer(segment.sampleCount) && segment.sampleCount > 0 && segment.capturedAt === source.capturedAt, 'Incomplete combined timeline.');
        if (meta.parents.length) check(meta.parents.some(parent => parent.id === segment.parentId && integer(parent.packetCount) && integer(segment.parentPacketStart) && segment.parentPacketStart + segment.packetCount <= parent.packetCount), 'Invalid parent packet range.');
        occurrences.add(segment.occurrenceId); packets += segment.packetCount; samples += segment.sampleCount;
    }
    check(packets === meta.packetCount && samples === meta.sampleCount && packets > 0, 'Source history does not match audio length.');
    return meta;
}

export function originalCombineMetadata(session, audio, filename, uuid) {
    const capturedAt = session.startedAt;
    check(date(capturedAt), 'A recording has no valid capture date.');
    return validateCombineMetadata({format:'imuse-combined-recording', version:1, id:session.id, createdAt:capturedAt,
        ...audio, parents:[], sources:[{id:session.id, capturedAt, filename, mimeType:session.mimeType,
            packetCount:audio.packetCount, sampleCount:audio.sampleCount}],
        segments:[{occurrenceId:uuid(), sourceId:session.id, capturedAt, sourcePacketStart:0,
            outputPacketStart:0, packetCount:audio.packetCount, sampleCount:audio.sampleCount}]});
}

export function planCombinedRecording(inputs, {uuid, createdAt = new Date().toISOString()}) {
    check(inputs.length >= 2, 'Select at least two recordings.');
    const sources = new Map(), parents = [], pieces = [], first = inputs[0].metadata;
    for (const [inputIndex, input] of inputs.entries()) {
        const meta = validateCombineMetadata(input.metadata);
        check(meta.sampleRate === first.sampleRate && meta.channels === first.channels, 'Recordings must have matching sample rates and channels.');
        parents.push({id:meta.id, filename:input.filename, createdAt:meta.createdAt, packetCount:meta.packetCount});
        for (const source of meta.sources) {
            const previous = sources.get(source.id);
            check(!previous || JSON.stringify(previous) === JSON.stringify(source), 'Conflicting history for the same source recording.');
            sources.set(source.id, copy(source));
        }
        for (const [segmentIndex, segment] of meta.segments.entries()) pieces.push({...copy(segment), inputIndex, segmentIndex,
            inputPacketStart:segment.outputPacketStart, parentId:meta.id, parentOccurrenceId:segment.occurrenceId});
    }
    // Nested results are flattened before sorting. Repeated sources remain repeated.
    pieces.sort((a,b) => Date.parse(a.capturedAt)-Date.parse(b.capturedAt) || a.inputIndex-b.inputIndex || a.segmentIndex-b.segmentIndex);
    let packetCount=0, sampleCount=0;
    const segments=pieces.map(piece => {
        const segment={occurrenceId:uuid(), sourceId:piece.sourceId, capturedAt:piece.capturedAt,
            sourcePacketStart:piece.sourcePacketStart, outputPacketStart:packetCount,
            packetCount:piece.packetCount, sampleCount:piece.sampleCount,
            parentId:piece.parentId, parentOccurrenceId:piece.parentOccurrenceId, parentPacketStart:piece.inputPacketStart};
        packetCount+=piece.packetCount; sampleCount+=piece.sampleCount; return segment;
    });
    const metadata=validateCombineMetadata({format:'imuse-combined-recording',version:1,id:uuid(),createdAt,
        sampleRate:first.sampleRate, channels:first.channels, packetCount,sampleCount,parents,sources:[...sources.values()],segments});
    return {metadata,pieces};
}

export function provenanceBox(metadata) {
    validateCombineMetadata(metadata);
    const json=new TextEncoder().encode(JSON.stringify(metadata));
    check(json.length<=MAX_JSON,'Combined source history is too large.');
    const bytes=new Uint8Array(24+json.length), view=new DataView(bytes.buffer);
    view.setUint32(0,bytes.length); bytes.set([117,117,105,100],4);bytes.set(UUID,8);bytes.set(json,24);return bytes;
}

export async function readCombineMetadata(blob) {
    let offset=0, result=null;
    while(offset<blob.size) {
        check(offset+8<=blob.size,'Truncated M4A box.');
        const header=new Uint8Array(await blob.slice(offset,offset+32).arrayBuffer()),view=new DataView(header.buffer);
        let size=view.getUint32(0),start=8;
        if(size===1) {check(header.length>=16,'Truncated extended M4A box.');size=view.getUint32(8)*4294967296+view.getUint32(12);start=16;}
        if(size===0)size=blob.size-offset;
        check(Number.isSafeInteger(size)&&size>=start&&offset+size<=blob.size,'Invalid M4A box length.');
        if(String.fromCharCode(...header.slice(4,8))==='uuid' && size>=start+16 && UUID.every((byte,i)=>header[start+i]===byte)) {
            check(!result && size-start-16<=MAX_JSON,'Duplicate or oversized combined history.');
            result=validateCombineMetadata(JSON.parse(await blob.slice(offset+start+16,offset+size).text()));
        }
        offset+=size;
    }
    return result;
}
