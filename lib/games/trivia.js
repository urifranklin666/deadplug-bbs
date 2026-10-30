'use strict';

const ansi = require('../ansi');
const { drawHeader, saveScore, showScores } = require('./common');

const QUESTIONS = [
  {
    q: 'What does the acronym BBS stand for?',
    options: ['Basic Bulletin System', 'Bulletin Board System', 'Binary Broadcast Service', 'Board Buffer Storage'],
    answer: 1,
  },
  {
    q: 'Which protocol did most dial-up BBS file transfers use in the 1990s?',
    options: ['FTP', 'Gopher', 'ZMODEM', 'BitTorrent'],
    answer: 2,
  },
  {
    q: 'What was the standard 8-bit character set used by DOS BBSes?',
    options: ['ASCII', 'CP437', 'UTF-8', 'EBCDIC'],
    answer: 1,
  },
  {
    q: 'Which company created the original Legend of the Red Dragon door game?',
    options: ['Robinson Technologies', 'Sierra On-Line', 'MicroProse', 'Apogee'],
    answer: 0,
  },
  {
    q: 'What does ANSI stand for?',
    options: ['Advanced Network System Interface', 'American National Standards Institute', 'Automatic Node Signal Input', 'Asynchronous Serial Network Interface'],
    answer: 1,
  },
  {
    q: 'Which telnet option is used to report terminal window size?',
    options: ['ECHO', 'SGA', 'NAWS', 'LINEMODE'],
    answer: 2,
  },
  {
    q: 'In a FidoNet address such as 1:234/56, what does the number before the colon identify?',
    options: ['Zone', 'Net', 'Node', 'Point'],
    answer: 0,
  },
  {
    q: 'Which of these was a popular DOS terminal program for calling BBSes?',
    options: ['Telix', 'Lynx', 'Pine', 'Irssi'],
    answer: 0,
  },
  {
    q: 'What is a "door" in BBS terminology?',
    options: ['A physical entry to the server room', 'An external program run from the BBS menu', 'A file transfer protocol', 'Another name for a message board'],
    answer: 1,
  },
  {
    q: 'Which character encoding did ANSI art typically target?',
    options: ['CP437 code page', 'Unicode', 'ISO-8859-1', 'UTF-16'],
    answer: 0,
  },
  {
    q: 'What does the telnet IAC byte (0xFF) introduce?',
    options: ['An escaped null', 'A command sequence', 'A checksum', 'A file header'],
    answer: 1,
  },
  {
    q: 'Which speed was a common late-1990s consumer modem?',
    options: ['300 baud', '2400 baud', '56k', '10 Mbit'],
    answer: 2,
  },
];

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

module.exports = async function trivia(ctx) {
  const { term, session } = ctx;
  drawHeader(term, 'TRIVIA', 'Seven questions. 10 credits per correct answer.');
  showScores(term, 'trivia');
  term.write('\r\n');

  const picked = shuffled(QUESTIONS).slice(0, 7);
  let correct = 0;
  let index = 0;

  for (const question of picked) {
    index += 1;
    term.write(ansi.paint(`Question ${index} of ${picked.length}`, ansi.color.gray) + '\r\n');
    const lines = ansi.wrap(question.q, Math.min(70, term.cols - 4));
    for (const line of lines) term.write(`  ${line}\r\n`);
    question.options.forEach((option, i) => {
      term.write(`  ${String.fromCharCode(97 + i)}) ${option}\r\n`);
    });
    let answered = false;
    while (!answered) {
      const key = await term.readKey({ prompt: 'Answer (a-d, Q to quit): ', valid: 'abcdq' });
      if (key === 'q') return;
      const choice = key.charCodeAt(0) - 97;
      if (choice < 0 || choice >= question.options.length) continue;
      answered = true;
      if (choice === question.answer) {
        correct += 1;
        term.write(ansi.paint('  Correct!', ansi.color.brightGreen) + '\r\n\r\n');
      } else {
        term.write(ansi.paint(`  Wrong. The answer was ${String.fromCharCode(97 + question.answer)}) ${question.options[question.answer]}`, ansi.color.brightRed) + '\r\n\r\n');
      }
    }
  }

  const reward = correct * 10;
  session.changeCredits(reward);
  term.write(ansi.paint(`You scored ${correct}/${picked.length}. Reward: ${reward} credits.`, ansi.color.bold + ansi.color.brightYellow) + '\r\n');
  saveScore('trivia', session.user.id, correct * 100 + reward);
  showScores(term, 'trivia', 'Top trivia scores');
  await term.pressEnter();
};
