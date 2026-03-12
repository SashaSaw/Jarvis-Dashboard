const https = require('https');

const API_KEY = process.env.TRELLO_API_KEY;
const TOKEN = process.env.TRELLO_TOKEN;
const BASE = 'https://api.trello.com/1';

const BOARDS = {
  adventune: '699ef10c1a3742abadd9ddb5',
  habitat: '698334175bb84024b4a23f6b'
};

function trelloFetch(url) {
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

function trelloRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const separator = path.includes('?') ? '&' : '?';
    const fullPath = `${path}${separator}key=${API_KEY}&token=${TOKEN}`;
    const url = new URL(`${BASE}${fullPath}`);
    const postData = body ? new URLSearchParams(body).toString() : '';

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getFullBoard(boardId, boardName) {
  try {
    const lists = await trelloFetch(`${BASE}/boards/${boardId}/lists?key=${API_KEY}&token=${TOKEN}&fields=name,id,pos`);
    const [cards, archivedCards] = await Promise.all([
      trelloFetch(`${BASE}/boards/${boardId}/cards?key=${API_KEY}&token=${TOKEN}&fields=name,desc,idList,due,labels,pos,dateLastActivity`),
      trelloFetch(`${BASE}/boards/${boardId}/cards?key=${API_KEY}&token=${TOKEN}&filter=closed&fields=name,desc,idList,due,labels,pos,dateLastActivity&limit=20`)
    ]);

    const listMap = {};
    for (const list of lists) {
      listMap[list.id] = { id: list.id, name: list.name, pos: list.pos, cards: [] };
    }
    for (const card of cards) {
      if (listMap[card.idList]) {
        listMap[card.idList].cards.push({
          id: card.id,
          name: card.name,
          desc: card.desc || '',
          due: card.due,
          pos: card.pos,
          labels: (card.labels || []).map(l => ({ id: l.id, name: l.name, color: l.color })),
          lastActivity: card.dateLastActivity
        });
      }
    }

    // Sort lists by position, cards by position within each list
    const sortedLists = Object.values(listMap).sort((a, b) => a.pos - b.pos);
    for (const list of sortedLists) {
      list.cards.sort((a, b) => a.pos - b.pos);
    }

    const archived = (archivedCards || []).map(c => ({
      id: c.id,
      name: c.name,
      desc: c.desc || '',
      due: c.due,
      pos: c.pos,
      labels: (c.labels || []).map(l => ({ id: l.id, name: l.name, color: l.color })),
      lastActivity: c.dateLastActivity
    }));

    return {
      name: boardName,
      id: boardId,
      lists: sortedLists,
      archivedCards: archived,
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
    getFullBoard(BOARDS.adventune, 'Adventune 🎵'),
    getFullBoard(BOARDS.habitat, 'Sown 🌱')
  ]);

  return { boards };
}

// Card operations
async function createCard(listId, name, desc) {
  return trelloRequest('POST', '/cards', { idList: listId, name, desc: desc || '' });
}

async function moveCard(cardId, newListId) {
  return trelloRequest('PUT', `/cards/${cardId}`, { idList: newListId });
}

async function archiveCard(cardId) {
  return trelloRequest('PUT', `/cards/${cardId}`, { closed: 'true' });
}

async function updateCard(cardId, fields) {
  return trelloRequest('PUT', `/cards/${cardId}`, fields);
}

async function getBoardLabels(boardId) {
  return trelloFetch(`${BASE}/boards/${boardId}/labels?key=${API_KEY}&token=${TOKEN}&fields=id,name,color`);
}

module.exports = { getAllBoards, getFullBoard, createCard, moveCard, archiveCard, updateCard, getBoardLabels, BOARDS };
