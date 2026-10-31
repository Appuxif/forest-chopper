/** Logical surfaces for one shared 53-bone skeleton. Skin is default equipment.
 * Renderers may batch all exposed skin regions into one SkinnedMesh.
 * Clothes must provide compatible seam geometry rather than simply overlap skin.
 */
export const BODY_PARTS=Object.freeze([
 'head','neck','torso','pelvis',
 'sleeveL','sleeveR','upperArmL','upperArmR','forearmL','forearmR','handL','handR',
 'thighL','thighR','calfL','calfR','footL','footR'
]);
export const SKIN_DEFAULTS=Object.freeze(Object.fromEntries(BODY_PARTS.map(p=>[p,'skin:'+p])));
export const APPAREL_REPLACEMENTS=Object.freeze({
 shirt:{replace:['torso','sleeveL','sleeveR','upperArmL','upperArmR','forearmL','forearmR'],
        joints:['neck','wristL','wristR','waist']},
 // The short sleeves are loose: keep *skin* on the whole upper arm and let
 // the T-shirt shell overlay it. Otherwise coarse triangles create jagged
 // artificial cloth-colored spikes below the short sleeve hem.
 tshirt:{replace:['torso'],
         joints:['neck','upperArmL','upperArmR','waist']},
 hoodie:{replace:['torso','sleeveL','sleeveR','upperArmL','upperArmR','forearmL','forearmR'],
         joints:['neck','wristL','wristR','waist']},
 dress:{replace:['torso','sleeveL','sleeveR','pelvis','thighL','thighR'],
        joints:['neck','upperArmL','upperArmR','thighL','thighR']},
 jeans:{replace:['pelvis','thighL','thighR','calfL','calfR'],
        joints:['waist','ankleL','ankleR']},
 // Loose shorts cover the proximal thigh with their own shell. The upper
 // leg skin remains intact behind the opening; cutting it by entire bone
 // regions creates visibly jagged cloth triangles below the hem.
 shorts:{replace:['pelvis'],
         joints:['waist','thighL','thighR']},
 skirt:{replace:['pelvis'],
        joints:['waist','thighL','thighR']},
 shoes:{replace:['footL','footR'],joints:['ankleL','ankleR']},
 boots:{replace:['footL','footR'],joints:['ankleL','ankleR']},
 // These are layered on top of another garment, not replacements for skin.
 jacket:{replace:[],joints:['neck','wristL','wristR','waist']},
 trenchcoat:{replace:[],joints:['neck','wristL','wristR']},
 panties:{replace:[]},briefs:{replace:[]},bra:{replace:[]}
});

/** Output maps each anatomical surface to its owner. No duplicated skin.
 * Shared armature stays active regardless of which surfaces are visible.
 */
export function resolveSkinAssembly(equipped={}){
 const owners={...SKIN_DEFAULTS},joints={};
 for(const [slot,id] of Object.entries(equipped)){
   if(!id||id==='none')continue;
   const config=APPAREL_REPLACEMENTS[id];
   if(!config)continue; // hair, weapons, backpacks do not change bare skin
   for(const part of config.replace){
     if(!(part in owners))throw Error('Unknown body part: '+part);
     if(owners[part].startsWith('garment:'))
       throw Error('Overlapping surface replacement: '+part);
     owners[part]='garment:'+id;
   }
   if(config.joints?.length)joints[slot]=config.joints;
 }
 return {owners,joints,exposedSkin:BODY_PARTS.filter(p=>owners[p].startsWith('skin:'))};
}
