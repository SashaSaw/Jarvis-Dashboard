const https = require('https');

const API_KEY = process.env.TRELLO_API_KEY;
const TOKEN = process.env.TRELLO_TOKEN;
const BASE = 'https://api.trello.com/1';

const BOARDS = {
  adventune: '699ef10c1a3742abadd9ddb5',
  habitat: '698334175bb84024b4a23f6b'
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function getBoardSummary(boardId, boardName) {
  try {
    const lists = await fetch(`${BASE}/boards/${boardId}/lists?key=${API_KEY}&token=${TOKEN}&fields=name,id`);
    const cards = await fetch(`${BASE}/boards/${boardId}/cards?key=${API_KEY}&token=${TOKEN}&fields=name,idList,due,labels`);

    const listMap = {};
    for (const list of lists) {
      listMap[list.id] = { name: list.name, cards: [] };
    }
    for (const card of cards) {
      if (listMap[card.idList]) {
        listMap[card.idList].cards.push({
          name: card.name,
          due: card.due,
          labels: (card.labels || []).map(l => l.name).filter(Boolean)
        });
      }
    }

    return {
      name: boardName,
      id: boardId,
      lists: Object.values(listMap),
      totalCards: cards.length
    };
  } catch (err) {
    return { name: boardName, id: boardId, error: err.message, lists: [], totalCards: 0 };
  }
}

async function getAllBoards() {
  if (!API_KEY || !TOKEN) {
    return { error: 'Trello credentials not configured', boards: [] };
  }

  const boards = await Promise.all([
    getBoardSummary(BOARDS.adventune, 'Adventune 🎵'),
    getBoardSummary(BOARDS.habitat, 'Habitat 🏠')
  ]);

  return { boards };
}

module.exports = { getAllBoards, BOARDS };
