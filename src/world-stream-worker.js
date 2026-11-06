import {forestChunkData,terrainGridData,grassTileData,grassAOData} from './world-stream-data.js?v=20261105-baked-ground-ao2';
const actions={forest:forestChunkData,terrain:terrainGridData,
  grass:grassTileData,grassAO:grassAOData};
self.onmessage=e=>{
  const {kind,payload,generation,revision}=e.data;
  try{
    const result=actions[kind](payload);
    const transfer=result?.samples?.buffer&&result?.ao?.ao?.buffer
      ?[result.samples.buffer,result.ao.ao.buffer]
      :result?.ao?.buffer?[result.ao.buffer]
      :result?.buffer?[result.buffer]:[];
    self.postMessage({generation,revision,result},transfer);
  }catch(error){
    self.postMessage({generation,revision,error:String(error)});
  }
};
