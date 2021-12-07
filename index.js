// Dependencies
var express = require('express');
var http = require('http');
var path = require('path');
// const { exitCode } = require('process');
var socketIO = require('socket.io');
var assert = require('assert');
const { setFlagsFromString } = require('v8');

var app = express();
var server = http.Server(app);
var io = socketIO(server);

port = process.env.PORT || 8080;
app.set('port', port);
app.use(express.static(__dirname + '/static'));
// app.use(express.static('public'));
// app.use(express.static('static'));


// Routing
app.get('/', function (request, response) {
    response.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/triogame.html', function (request, response) {
    response.sendFile(path.join(__dirname, 'triogame.html'));
});


// Starts the server.
server.listen(port, function () {
    console.log('Starting server on port ' + port);
});

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}


// helper functions
function randomString(characters, length) {
    var result = '';
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function generateRoomCode() {
    return randomString('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 4);
}

function generatePlayerID() {
    return randomString('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890', 20);
}

class Card {
    constructor() { }

    init_random() {
        this.number = getRandomInt(10);
        this.color = getRandomInt(4);
    }
}

function compareCards(a, b) {
    if (a.number != b.number) {
        return a.number - b.number;
    }
    else if (a.color != b.color) {
        return a.color - b.color;
    }
    else {
        return 0;
    }
}

class Player {
    constructor() {
        this.afk = false;
        this.cards = [];
    }

    deal_random(count) {
        this.cards.length = 0;

        for (let i = 0; i < count; i++) {
            this.cards[i] = new Card();
            this.cards[i].init_random();
        }

        this.cards.sort(compareCards);
    }

    playCard(num) {
        if (num < 0 || num >= this.cards.length) {
            throw 'Player.playCard received illegal argument num ' + num;
        }
        let removed = this.cards.splice(num, 1);
        if (this.cards.length == 0) {
            this.deal_random(8);
        }
        this.cards.sort(compareCards);
        return removed[0];
    }
}

function cardsCompatible(a, b) {
    return a.color == b.color
        || a.number == b.number
        || a.color == 4
        || b.color == 4;
}

class Game {
    constructor(roomCode) {
        this.roomCode = roomCode;

        this.players = new Map;
        this.starting_card_number = 1;

        this.lastPlayed = new Card();
        this.lastPlayed.color = 4;
        this.playedCardsCount = 0;

        this.timeCreated = Date.now();      // in milliseconds
    }

    startGame() {
        this.whoseTurn = 0;
    }

    endTurn() {
        this.whoseTurn++;
        if (this.whoseTurn >= this.playerIDs.length)
            this.whoseTurn = 0;
    }

    playTurn(player_id, turn) {
        console.log(player_id, turn, this.lastPlayed.color);

        if (this.playerIDs[this.whoseTurn] !== player_id)
            return;

        if (turn['type'] == 'p') {
            let cardToPlay = this.players.get(player_id).cards[turn['card']];

            if (cardsCompatible(cardToPlay, this.lastPlayed)) {
                let playedCard = this.players.get(player_id).playCard(turn['card'], this);
                this.lastPlayed = playedCard;
                this.playedCardsCount++;
                this.endTurn();
            }
        }

        sendStateAll(this.roomCode);
    }

    getAge() {
        return Date.now() - this.timeCreated;
    }

    player_join(name, player_id, session_id) {
        let player = new Player();
        player.name = name;
        player.player_id = player_id;
        player.session_id = session_id;
        player.deal_random(this.starting_card_number);
        this.players.set(player_id, player);
        this.playerIDs = Array.from(this.players.keys());
    }

    activePlayerCount() {
        let count = 0;
        for (const [key, player] of this.players)
            if (!player.afk)
                count++;
        return count;
    }
}

var games = new Map();
var checkGameValidityInterval = 1 * 1000;
var pruneInactiveGamesAfter = 5 * 60 * 1000;

// this is an ugly hack, socket.io rooms would probably have been better
var sessionToRoom = new Map();

// prune old inactive games
// TODO change to callback using setTimeout
setInterval(() => {
    games.forEach((game, key, map) => {
        if (game.getAge() > pruneInactiveGamesAfter && game.activePlayerCount() == 0) {
            games.delete(key);
            console.log("Pruned room", key);
        }
    });
}, checkGameValidityInterval);

function sendState(roomCode, player_id) {
    let game = games.get(roomCode);
    if (game !== undefined) {
        try {
            let player = games.get(roomCode).players.get(player_id);
            player.cards;
            // if neither of these threw an exception, player exists in the correct room
            console.log('sending state to', player_id, 'in room', roomCode, 'via session', player.session_id);

            let playersState = [];
            for (let [key, value] of games.get(roomCode).players) {
                playersState.push({
                    'player_id': key,
                    'name': value.name,
                    'cardCount': value.cards.length,
                    'turn': key === game.playerIDs[game.whoseTurn]
                })
            }

            console.log(playersState[0])

            io.to(player.session_id).emit('receiveState', {
                'cards': player.cards,
                'lastPlayed': game.lastPlayed,
                'playedCardsCount': game.playedCardsCount,
                'playersState': playersState,
                // 'turn': turn
            });
        }
        catch (e) {
            console.log('Exception in sendState():', e);
        }
    }
}

function sendStateAll(roomCode) {
    games.get(roomCode).players.forEach((value, key, map) => {
        sendState(roomCode, key);
    });
}

io.on('connection', (socket) => {
    socket.on('requestRoom', (data, callback) => {
        roomCode = generateRoomCode();
        games.set(roomCode, new Game(roomCode));
        console.log('Created room ' + roomCode);

        callback({
            'success': true,
            'roomCode': roomCode
        });
    });

    socket.on('isRoomcodeValid', (data, callback) => {
        let roomCode = data.toUpperCase();
        callback(games.has(roomCode));
    });

    socket.on('requestRejoin', (data, callback) => {
        console.log('Request rejoin', data);

        if (data['roomCode'] === undefined ||
            data['player_id'] === undefined) {
            callback({ 'approved': false });
            return;
        }

        roomCode = data['roomCode'].toUpperCase();
        session_id = data['session_id'];
        player_id = data['player_id'];

        try {
            console.log(games.get(roomCode));
            console.log(games);
            assert(games.get(roomCode).players.get(player_id).afk);

            console.log(player_id, 'rejoined', roomCode);
            games.get(roomCode).players.get(player_id).afk = false;
            games.get(roomCode).players.get(player_id).session_id = data['session_id'];
            callback({ 'approved': true });
            sessionToRoom.set(session_id, roomCode);
            sendState(roomCode, player_id);
        }
        catch (e) {
            console.log(e);
            callback({ 'approved': false });
        }
    });

    socket.on('requestJoin', (data, callback) => {
        roomCode = data['roomCode'].toUpperCase();
        session_id = data['session_id'];
        name_ = data['name'];
        player_id = generatePlayerID();

        console.log(player_id + ' (session id=' + session_id + ') wants to join ' + roomCode);

        try {
            if (games.get(roomCode).players.size == 0) {
                console.log('starting game', roomCode);
                games.get(roomCode).startGame();
            }
            games.get(roomCode).player_join(name_, player_id, session_id);

            callback({
                'approved': true,
                'player_id': player_id,
                'roomCode': roomCode
            });

            sendState(roomCode, player_id);

            sessionToRoom.set(session_id, roomCode);
        }
        catch (e) {
            console.log(e);

            callback({
                'approved': false,
            });
        }
    });

    socket.on('requestState', (data) => {
        console.log('requestState received from ' + data['player_id'] + ' in room ' + data['roomCode']);
        sendState(data['roomCode'], data['player_id']);
    });

    socket.on('click', (data) => {
        let player_id = data['player_id'];
        let roomCode = data['roomCode'];
        let move = data['move'];
        let cardClicked = move['card'];

        let game = games.get(roomCode);

        console.log(player_id, 'in room', roomCode, 'wants to perform move', move);

        try {
            game.playTurn(player_id, move);
        }
        catch (e) {
            console.log(e);
        }
    });

    socket.once('disconnect', (test) => {
        if (sessionToRoom.has(socket.id)) {
            let roomCode = sessionToRoom.get(socket.id);
            let game = games.get(roomCode);

            for (let [key, value] of game.players) {
                if (value.session_id == socket.id) {
                    console.log('Player', game.players.get(key).player_id, 'from room', roomCode, 'went afk...');
                    game.players.get(key).afk = true;
                }
            }

            sessionToRoom.delete(socket.id);
        }
        console.log('disconnected', socket.id);
    });
});
