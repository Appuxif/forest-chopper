// Single source for Russian item labels and fallback icons in game UI.
// IDs remain stable (and language-neutral) in saves and network messages.
import {DECOR_ITEM_NAMES} from './collectible-decor.js';

export const ITEM_DISPLAY_NAMES=Object.freeze({
  log:'Бревно',branch:'Ветка',stone:'Камень',axe:'Топор',bench:'Скамейка',
  alchemy_table:'Алхимический стол',chest:'Сундук',rack:'Склад брёвен',campfire:'Костёр',torch:'Стационарный факел',
  table:'Стол',fence:'Ограда',workbench:'Верстак',dry_grass:'Сухая трава',
  'potion:health':'Зелье здоровья','potion:stamina':'Зелье выносливости',
  'potion:lumberjack':'Эликсир дровосека','potion:light_feet':'Зелье лёгких ног',
  'potion:night_vision':'Сумеречное зрение',
  'food:mushroom_stew':'Грибное рагу',
  'food:herbal_mushroom_stew':'Грибное рагу с травами',
  ...DECOR_ITEM_NAMES,
});
export const ITEM_DISPLAY_ICONS=Object.freeze({
  log:'🪵',branch:'🌿',stone:'🪨',axe:'🪓',bench:'🪑',
  chest:'📦',rack:'🪵',campfire:'🔥',torch:'🕯️',table:'🪑',fence:'🚧',workbench:'🛠️',dry_grass:'🌾',
  'potion:health':'❤️','potion:stamina':'🧪',
  'potion:lumberjack':'🪓','potion:light_feet':'🪽','potion:night_vision':'🌙',
  'food:mushroom_stew':'🍲','food:herbal_mushroom_stew':'🍲','alchemy_table':'⚗️',
  'mushroom:fly_agaric':'🍄','mushroom:boletus':'🍄',
  'mushroom:death_cap':'🍄','mushroom:milkcap':'🍄',
  'flower:daisy':'🌼','flower:buttercup':'🌻',
  'flower:pink_wildflower':'🌸','flower:blue_wildflower':'🪻',
});
export const itemDisplayName=id=>ITEM_DISPLAY_NAMES[id]??'Неизвестный предмет';
export const itemDisplayIcon=id=>ITEM_DISPLAY_ICONS[id]??'📦';
