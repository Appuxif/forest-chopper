import {createCorpseLootPanel} from './corpse-loot-ui.js';

const HEN_ITEM_LABELS={chicken_meat:'🍗 Мясо',feather:'🪶 Перья'};
export function createHenLootPanel(options){
 const panel=createCorpseLootPanel({...options,itemLabel:id=>HEN_ITEM_LABELS[id]??id});
 const render=panel.render;
 panel.render=value=>render(value?.displayName||value?.name?value:{...value,displayName:'Курица'});
 // Preserve the old accessible label for existing hen UI/tests.
 panel.panel.setAttribute('aria-label','Добыча курицы');
 return panel;
}
