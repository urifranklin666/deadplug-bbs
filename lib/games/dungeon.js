'use strict';

const ansi = require('../ansi');
const { drawHeader, saveScore, showScores } = require('./common');

const MONSTERS = [
  ['a cave rat', 4, 1, 6],
  ['a rusted servitor', 7, 2, 12],
  ['a data wraith', 9, 2, 18],
  ['a bone collector', 12, 3, 26],
  ['the vault guardian', 20, 4, 60],
];

function roll(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = async function dungeon(ctx) {
  const { term, session } = ctx;
  drawHeader(term, 'THE DUNGEON', 'Five levels down. Bring back what you can.');
  showScores(term, 'dungeon', 'Deepest runs');
  term.write('\r\n');

  const hero = {
    hp: 24,
    maxHp: 24,
    gold: 0,
    potions: 1,
    depth: 1,
    rooms: 0,
    monster: null,
  };

  const render = () => {
    term.clearScreen();
    drawHeader(term, `THE DUNGEON — LEVEL ${hero.depth}`, `${hero.rooms} rooms explored`);
    term.write(`HP ${ansi.paint(String(hero.hp), ansi.color.brightRed)}/${hero.maxHp}   Gold ${ansi.paint(String(hero.gold), ansi.color.brightYellow)}   Potions ${hero.potions}\r\n`);
    term.write(ansi.color.gray + '─'.repeat(Math.min(60, term.cols - 2)) + ansi.color.reset + '\r\n');
    if (hero.monster) {
      term.write(`A ${ansi.paint(hero.monster[0], ansi.color.brightMagenta)} blocks the way. `);
      term.write(`(${hero.monster[1]} HP)\r\n\r\n`);
      term.write('[F]ight   [P]otion   [R]un\r\n');
    } else {
      term.write('The corridor is quiet.\r\n\r\n');
      term.write('[E]xplore   [P]otion   [L]eave\r\n');
    }
  };

  const usePotion = () => {
    if (hero.potions <= 0) {
      term.write(ansi.paint('No potions left.', ansi.color.yellow) + '\r\n');
      return;
    }
    hero.potions -= 1;
    const healed = Math.min(hero.maxHp - hero.hp, 10);
    hero.hp += healed;
    term.write(ansi.paint(`You drink a potion and recover ${healed} HP.`, ansi.color.brightGreen) + '\r\n');
  };

  const finish = async (won) => {
    const reward = won ? hero.gold : Math.floor(hero.gold / 2);
    session.changeCredits(reward);
    saveScore('dungeon', session.user.id, hero.depth * 1000 + hero.gold);
    term.write('\r\n');
    term.write(
      ansi.paint(
        won ? `You escape with ${reward} credits.` : `You crawl out with ${reward} credits and a story.`,
        ansi.color.bold + ansi.color.brightYellow
      ) + '\r\n'
    );
    showScores(term, 'dungeon', 'Deepest runs');
    await term.pressEnter();
  };

  while (true) {
    render();
    const valid = hero.monster ? 'fpr' : 'epl';
    const key = await term.readKey({ prompt: '> ', valid });

    if (key === 'p') {
      usePotion();
      await term.pressEnter('');
      continue;
    }

    if (key === 'l') {
      await finish(true);
      return;
    }

    if (key === 'r' && hero.monster) {
      if (roll(1, 100) <= 55) {
        term.write('You slip away into the dark.\r\n');
        hero.monster = null;
      } else {
        term.write(ansi.paint('You cannot escape!', ansi.color.brightRed) + '\r\n');
        const damage = roll(1, hero.monster[2]);
        hero.hp -= damage;
        term.write(`The ${hero.monster[0]} hits you for ${damage}.\r\n`);
      }
      await term.pressEnter('');
      if (hero.hp <= 0) {
        term.write(ansi.paint('You fall in the dark...', ansi.color.bold + ansi.color.brightRed) + '\r\n');
        await finish(false);
        return;
      }
      continue;
    }

    if (key === 'e') {
      hero.rooms += 1;
      if (hero.rooms % 5 === 0 && hero.depth < 5) {
        hero.depth += 1;
        term.write(ansi.paint(`You find stairs down. Level ${hero.depth}.`, ansi.color.brightCyan) + '\r\n');
        if (hero.depth === 5) hero.monster = [...MONSTERS[4]];
        await term.pressEnter('');
        continue;
      }
      const event = roll(1, 100);
      if (event <= 65) {
        const pool = hero.depth >= 4 ? MONSTERS.slice(2) : MONSTERS.slice(0, Math.min(4, hero.depth + 1));
        const base = pool[roll(0, pool.length - 1)];
        hero.monster = [base[0], base[1] + hero.depth * 2, base[2] + Math.floor(hero.depth / 2), base[3] + hero.depth * 4];
        term.write(`You disturb ${ansi.paint(hero.monster[0], ansi.color.brightMagenta)}.\r\n`);
      } else if (event <= 82) {
        const found = roll(4, 12 + hero.depth * 5);
        hero.gold += found;
        term.write(ansi.paint(`You find ${found} gold in a broken chest.`, ansi.color.brightYellow) + '\r\n');
      } else if (event <= 92) {
        hero.potions += 1;
        term.write(ansi.paint('You find a healing potion.', ansi.color.brightGreen) + '\r\n');
      } else {
        term.write('Dust. Cobwebs. Nothing else.\r\n');
      }
      await term.pressEnter('');
      continue;
    }

    if (key === 'f' && hero.monster) {
      const damage = roll(2, 6) + Math.floor(hero.depth / 2);
      hero.monster[1] -= damage;
      term.write(`You hit the ${hero.monster[0]} for ${damage}.\r\n`);
      if (hero.monster[1] <= 0) {
        const gold = hero.monster[3];
        hero.gold += gold;
        term.write(ansi.paint(`It falls. You loot ${gold} gold.`, ansi.color.brightGreen) + '\r\n');
        hero.monster = null;
        if (hero.depth === 5) {
          term.write(ansi.paint('The vault guardian is dead. The dungeon is yours.', ansi.color.bold + ansi.color.brightYellow) + '\r\n');
          await finish(true);
          return;
        }
      } else {
        const hit = roll(1, hero.monster[2]);
        hero.hp -= hit;
        term.write(`It strikes back for ${hit}.\r\n`);
        if (hero.hp <= 0) {
          term.write(ansi.paint('You fall in the dark...', ansi.color.bold + ansi.color.brightRed) + '\r\n');
          await finish(false);
          return;
        }
      }
      await term.pressEnter('');
    }
  }
};
