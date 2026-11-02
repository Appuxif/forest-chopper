// Reference actions come from the CC0 KayKit animation bank, separate from
// game models. Keep them in semantic groups for quick A/B comparison.
export const REFERENCE_MOTION_GROUPS = [
  {label:'Ходьба · KayKit', actions:[
    ['REF_KayKit_Walk_A','Ходьба A'],
    ['REF_KayKit_Walk_B','Ходьба B'],
    ['REF_KayKit_Walk_C','Ходьба C'],
  ]},
  {label:'Бег · KayKit', actions:[
    ['REF_KayKit_Run_A','Бег A'],
    ['REF_KayKit_Run_B','Бег B'],
    ['REF_KayKit_Run_StrafeLeft','Бег боком влево'],
  ]},
  {label:'Удары · KayKit', actions:[
    ['REF_KayKit_Attack_Axe1H','Удар топором одной рукой'],
    ['REF_KayKit_Attack_Axe2H','Удар двумя руками'],
    ['REF_KayKit_Attack_Diagonal','Диагональный удар'],
    ['REF_KayKit_Attack_Horizontal','Горизонтальный удар'],
  ]},
  {label:'Рубка и инструменты · KayKit', actions:[
    ['REF_KayKit_Chopping_Loop','Рубка дерева · цикл'],
    ['REF_KayKit_Chop_Sequence','Рубка дерева · серия'],
    ['REF_KayKit_Sawing_Loop','Пиление'],
    ['REF_KayKit_Hammering_Loop','Молоток'],
  ]},
  {label:'Работа за столом · KayKit', actions:[
    ['REF_KayKit_Work_Bench_A','Работа за столом A'],
    ['REF_KayKit_Work_Bench_B','Работа за столом B'],
    ['REF_KayKit_Work_Bench_C','Работа за столом C'],
  ]},
  {label:'Предметы и еда', actions:[
    ['REF_KayKit_Use_Item','Использование предмета'],
    ['REF_Experimental_Eat_HandToMouth','Еда · рука ко рту (эксперимент)'],
  ]},
];
export const REFERENCE_MOTION_NAMES = REFERENCE_MOTION_GROUPS.flatMap(group=>group.actions.map(([id])=>id));
const LOOPING_REFERENCES=new Set([
 'REF_KayKit_Walk_A','REF_KayKit_Walk_B','REF_KayKit_Walk_C',
 'REF_KayKit_Run_A','REF_KayKit_Run_B','REF_KayKit_Run_StrafeLeft',
 'REF_KayKit_Chopping_Loop','REF_KayKit_Sawing_Loop','REF_KayKit_Hammering_Loop',
 'REF_KayKit_Work_Bench_A','REF_KayKit_Work_Bench_B','REF_KayKit_Work_Bench_C',
]);
export function shouldLoopPreviewClip(name){
 if(name.startsWith('REF_'))return LOOPING_REFERENCES.has(name);
 return !['fall','jump','land'].includes(name);
}
export function referenceClipInfo(name){
 if(!name.startsWith('REF_'))return null;
 return name.startsWith('REF_Experimental_')
   ? 'Эксперимент: KayKit Use_Item + рука ко рту. Без предмета еды.'
   : 'KayKit · CC0 · предварительный ретаргетинг на 53 кости. Не игровая анимация.';
}
