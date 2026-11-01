// One catalog for the current craftable recipes and illustrated building guides.
// "planned" entries are informational; they never dispatch a craft request.
export const RECIPE_TABS=[
 {id:'tools',name:'Инструменты',icon:'🪓'},
 {id:'alchemy',name:'Алхимия',icon:'🧪'},
 {id:'structures',name:'Постройки',icon:'🏕️'},
 {id:'free',name:'Свободное строительство',icon:'🪵'},
];
export const RECIPE_PAGES=[
 {id:'axe',tab:'tools',name:'Базовый топор',icon:'🪓',description:'Нужен для рубки деревьев и разборки построек.',ingredients:{branch:3,stone:2},craftable:true,effects:['Урон: 1','Скорость: 1×']},
 {id:'bench',tab:'structures',name:'Скамейка',icon:'🪑',description:'Деревянная скамейка для обустройства лагеря.',ingredients:{log:3},craftable:true,effects:['Можно установить и разобрать']},
 {id:'chest',tab:'structures',name:'Сундук',icon:'📦',description:'Стационарный инвентарь на 24 слота и 300 кг. Поставить перед персонажем.',ingredients:{log:2,branch:4},craftable:true,placement:true},
 {id:'rack',tab:'structures',name:'Склад брёвен',icon:'🪵',description:'Уложить до 48 брёвен в штабеля. Поставить перед персонажем.',ingredients:{log:2},craftable:true,placement:true},
 {id:'potion:health',tab:'alchemy',name:'Зелье здоровья',icon:'❤️',description:'Восстанавливает 2 единицы здоровья.',ingredients:{'flower:daisy':2,'mushroom:boletus':1},craftable:true,effects:['Лечение +2']},
 {id:'potion:stamina',tab:'alchemy',name:'Зелье выносливости',icon:'🧪',description:'Восстанавливает 2 единицы выносливости и усиливает её восстановление на 30 секунд.',ingredients:{'flower:blue_wildflower':2,'dry_grass':2},craftable:true,effects:['Выносливость +2','Регенерация ×1.7 на 30 секунд']},
 {id:'campfire',tab:'structures',name:'Костёр',icon:'🔥',description:'Освещает лагерь. Подойди и нажми F, чтобы зажечь или погасить.',ingredients:{log:2,stone:3},craftable:true,placement:true,effects:['Не требует топлива']},
 {id:'torch',tab:'structures',name:'Стационарный факел',icon:'🕯️',description:'Постоянный факел для освещения дорожек. F включает и выключает.',ingredients:{branch:1,stone:3,dry_grass:1},craftable:true,placement:true},
 {id:'table',tab:'structures',name:'Стол',icon:'🪑',description:'Деревянная площадка с коллизией — можно запрыгнуть.',ingredients:{log:3},craftable:true,placement:true},
 {id:'fence',tab:'structures',name:'Ограда',icon:'🚧',description:'Деревянные стойки и перекладины, перекрывают проход.',ingredients:{log:2,branch:2},craftable:true,placement:true},
 {id:'workbench',tab:'structures',name:'Верстак',icon:'🛠️',description:'Рабочая поверхность для будущего производственного крафта.',ingredients:{log:4,stone:2},craftable:true,placement:true},
 {id:'signpost',tab:'structures',name:'Указатель',icon:'🪧',description:'Деревянный знак с надписью для тропы или лагеря.',planned:true,effects:['Надпись · в разработке']},
 {id:'column',tab:'free',name:'Столб из брёвен',icon:'🪵',description:'Выбери бревно в хотбаре, поворачивай постройку и укладывай брёвна друг на друга. Подсказка показывает доступную высоту.',guide:true},
 {id:'wall',tab:'free',name:'Стена из брёвен',icon:'🧱',description:'Поставь несколько брёвен рядом, повторяй слои. Поворачивай элементы перед укладкой. Схема не расходует дополнительные ресурсы.',guide:true},
 {id:'floor',tab:'free',name:'Настил из брёвен',icon:'🏗️',description:'Расположи брёвна параллельно в одном уровне. Для выравнивания используй полуметровую сетку размещения.',guide:true},
 {id:'stairs',tab:'free',name:'Лестница',icon:'🪜',description:'Чередуй уровни укладки брёвен, делая ступени с горизонтальным шагом 0,5–1 м. Для подъёма ставь брёвна поперёк направления движения.',guide:true},
 {id:'roof',tab:'free',name:'Перекрытие',icon:'🏠',description:'Выстрой две опорные стены, затем уложи горизонтальные брёвна вплотную друг к другу. Проверь доступность ступеней для прыжка.',guide:true},
];
export const recipeById=id=>RECIPE_PAGES.find(entry=>entry.id===id)??null;
export const recipeAvailable=(entry,inventory)=>!!entry?.craftable&&Object.entries(entry.ingredients??{}).every(([id,count])=>inventory.count(id)>=count);
