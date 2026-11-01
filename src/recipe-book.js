// One catalog for the current craftable recipes and illustrated building guides.
// "planned" entries are informational; they never dispatch a craft request.
export const RECIPE_TABS=[
 {id:'tools',name:'Инструменты',icon:'🪓'},
 {id:'structures',name:'Постройки',icon:'🏕️'},
 {id:'free',name:'Свободное строительство',icon:'🪵'},
];
export const RECIPE_PAGES=[
 {id:'axe',tab:'tools',name:'Базовый топор',icon:'🪓',description:'Нужен для рубки деревьев и разборки построек.',ingredients:{branch:3,stone:2},craftable:true,effects:['Урон: 1','Скорость: 1×']},
 {id:'bench',tab:'structures',name:'Скамейка',icon:'🪑',description:'Деревянная скамейка для обустройства лагеря.',ingredients:{log:3},craftable:true,effects:['Можно установить и разобрать']},
 {id:'campfire',tab:'structures',name:'Костёр',icon:'🔥',description:'Очаг для освещения лагеря. Рецепт появится при введении управляемого костра.',planned:true,effects:['Зажечь / погасить · в разработке']},
 {id:'signpost',tab:'structures',name:'Указатель',icon:'🪧',description:'Деревянный знак с надписью для тропы или лагеря.',planned:true,effects:['Надпись · в разработке']},
 {id:'column',tab:'free',name:'Столб из брёвен',icon:'🪵',description:'Выбери бревно в хотбаре, поворачивай постройку и укладывай брёвна друг на друга. Подсказка показывает доступную высоту.',guide:true},
 {id:'wall',tab:'free',name:'Стена из брёвен',icon:'🧱',description:'Поставь несколько брёвен рядом, повторяй слои. Поворачивай элементы перед укладкой. Схема не расходует дополнительные ресурсы.',guide:true},
 {id:'floor',tab:'free',name:'Настил из брёвен',icon:'🏗️',description:'Расположи брёвна параллельно в одном уровне. Для выравнивания используй полуметровую сетку размещения.',guide:true},
];
export const recipeById=id=>RECIPE_PAGES.find(entry=>entry.id===id)??null;
export const recipeAvailable=(entry,inventory)=>!!entry?.craftable&&Object.entries(entry.ingredients??{}).every(([id,count])=>inventory.count(id)>=count);
