'use strict';

const ansi = require('../ansi');
const { drawHeader, cardLine, handValue, saveScore, showScores } = require('./common');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function freshDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(deck) {
  if (deck.length < 10) deck.push(...freshDeck());
  return deck.pop();
}

module.exports = async function blackjack(ctx) {
  const { term, session } = ctx;
  term.clearScreen();
  drawHeader(term, 'BLACKJACK', 'Beat the dealer. Blackjack pays 3:2.');
  showScores(term, 'blackjack');
  term.write('\r\n');

  while (true) {
    session.refreshUser();
    const credits = session.user.credits;
    if (credits < 10) {
      term.write(ansi.paint('You need at least 10 credits to play.', ansi.color.yellow) + '\r\n');
      await term.pressEnter();
      return;
    }

    const raw = await term.readLine({
      prompt: `Credits: ${credits}. Wager (10-${Math.min(500, credits)}, Q to quit): `,
      max: 6,
    });
    if (raw.trim().toLowerCase() === 'q') return;
    const bet = Number(raw);
    if (!Number.isInteger(bet) || bet < 10 || bet > Math.min(500, credits)) {
      term.write(ansi.paint('Invalid wager.', ansi.color.red) + '\r\n');
      continue;
    }

    const deck = freshDeck();
    const player = [draw(deck), draw(deck)];
    const dealer = [draw(deck), draw(deck)];
    let finished = false;

    term.write('\r\n');
    term.write(`Your hand:   ${cardLine(player)}  (${handValue(player)})\r\n`);
    term.write(`Dealer shows: ${cardLine([dealer[0], { rank: '??', suit: ' ' }])}\r\n\r\n`);

    if (handValue(player) === 21) {
      term.write(ansi.paint('Blackjack!', ansi.color.bold + ansi.color.brightGreen) + '\r\n');
      finished = true;
    }

    while (!finished) {
      const key = await term.readKey({ prompt: '[H]it  [S]tand  [Q]uit: ', valid: 'hsq', echo: true });
      if (key === 'q') return;
      if (key === 'h') {
        player.push(draw(deck));
        const total = handValue(player);
        term.write(`\r\nYou draw ${cardLine([player[player.length - 1]])}. Your hand: ${cardLine(player)}  (${total})\r\n`);
        if (total > 21) {
          term.write(ansi.paint('Bust!', ansi.color.bold + ansi.color.brightRed) + '\r\n');
          finished = true;
        }
      } else {
        finished = true;
      }
    }

    const playerTotal = handValue(player);
    const playerBlackjack = player.length === 2 && playerTotal === 21;
    while (handValue(dealer) < 17) dealer.push(draw(deck));
    const dealerTotal = handValue(dealer);

    term.write(`\r\nDealer hand: ${cardLine(dealer)}  (${dealerTotal})\r\n`);

    let delta = -bet;
    let message = '';
    let colour = ansi.color.brightRed;
    if (playerTotal > 21) {
      message = `You lose ${bet} credits.`;
    } else if (playerBlackjack && dealerTotal !== 21) {
      delta = Math.floor(bet * 1.5);
      message = `Blackjack! You win ${delta} credits.`;
      colour = ansi.color.brightGreen;
    } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
      delta = bet;
      message = `You win ${bet} credits.`;
      colour = ansi.color.brightGreen;
    } else if (playerTotal === dealerTotal) {
      delta = 0;
      message = 'Push. Your wager is returned.';
      colour = ansi.color.yellow;
    } else {
      message = `Dealer wins. You lose ${bet} credits.`;
    }

    session.changeCredits(delta);
    term.write(ansi.paint(message, ansi.color.bold + colour) + '\r\n');
    saveScore('blackjack', session.user.id, session.user.credits);
    term.write(`Balance: ${session.user.credits} credits.\r\n\r\n`);
  }
};
