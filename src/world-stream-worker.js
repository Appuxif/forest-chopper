import {forestChunkData,terrainGridData,grassTileData} from './world-stream-data.js';
const actions={forest:forestChunkData,terrain:terrainGridData,grass:grassTileData};
self.onmessage=e=>{
  const {kind,payload,generation,revision}=e.data;
  try{
    const result=actions[kind](payload);
    self.postMessage({generation,revision,result},[result.buffer]);
  }catch(error){
    self.postMessage({generation,revision,error:String(error)});
  }
};
