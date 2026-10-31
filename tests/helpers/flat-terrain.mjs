// Flat terrain for legacy game-system fixtures. Hills, ponds and lakes have
// separate geometry/server-parity integration tests.
export function flatTerrain(){
  return {
    heightAt(){return 0;},
    waterDepthAt(){return 0;},
    surfaceAt(){return 'ground';},
    normalAt(){return {x:0,y:1,z:0};},
    update(){},
  };
}
