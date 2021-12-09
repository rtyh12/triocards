// Dependencies
var express = require('express');
var http = require('http');
var path = require('path');
// const { exitCode } = require('process');
var socketIO = require('socket.io');
var assert = require('assert');
const { setFlagsFromString } = require('v8');
const e = require('cors');

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


// helper functions
function randomString(characters, length) {
    var result = '';
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function randomCharacter(characters) {
    // replace with more efficient implementation later if necessary
    return randomString(characters, 1);
}

function generateRoomCode() {
    return randomString('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 4);
}

function generatePlayerID() {
    return randomString('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890', 20);
}

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

class Card {
    static numbers = '0112233445566778899zzrr++#c';

    constructor() { }

    init_random() {
        // z = skip, r = reverse, + = +2, # = +4, c = change color
        this.number = randomCharacter(Card.numbers);
        if ('#c'.includes(this.number))
            this.color = 4;
        else
            this.color = getRandomInt(4);
    }
}

function compareCards(a, b) {
    an = Card.numbers.indexOf(a.number);
    bn = Card.numbers.indexOf(b.number);
    if (an != bn) {
        return an - bn;
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

    sortCards() {
        this.cards.sort(compareCards);
    }

    deal_random(count) {
        this.cards.length = 0;

        for (let i = 0; i < count; i++) {
            this.cards[i] = new Card();
            this.cards[i].init_random();
        }
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

function cardsStrictlyCompatible(a, b) {
    return a.number == b.number
        || ('+#'.includes(a.number) && '+#'.includes(b.number));
}

class Game {
    constructor(roomCode) {
        this.roomCode = roomCode;

        this.players = new Map;
        this.starting_card_number = 1;

        this.lastPlayed = new Card();
        this.lastPlayed.init_random();
        this.playedCardsCount = 0;

        this.whoseTurn = undefined;
        this.turnDirection = 1;
        this.playerDidSomethingThisTurn = false;
        this.cardsPlayedThisTurn = 0;
        this.currentPlayerNeedsToDraw = 0;
        this.nextPlayerNeedsToDraw = 0;
        this.currentPlayerNeedsToSkip = false;
        this.nextPlayerNeedsToSkip = false;

        this.timeCreated = Date.now();      // in milliseconds
    }

    startGame() {
        this.whoseTurn = 0;
    }

    // ============ turn actions ================
    currentPlayerDrawCards(count) {
        // bit hacky, but probably not _too_ inefficient lol
        for (let i = 0; i < count; i++) {
            let card = new Card();
            card.init_random();
            this.currentPlayer().cards.push(card);
        }
        this.currentPlayer().sortCards();
    }

    endTurn() {
        if (this.currentPlayerNeedsToDraw > 0) {
            this.currentPlayerDrawCards(this.currentPlayerNeedsToDraw);
            this.playerDidSomethingThisTurn = true;
        }

        if (!this.playerDidSomethingThisTurn)
            this.currentPlayerDrawCards(1);

        // find next player according to the turn direction
        this.whoseTurn += this.turnDirection;
        if (this.whoseTurn >= this.playerIDs.length)
            this.whoseTurn = 0;
        else if (this.whoseTurn < 0)
            this.whoseTurn = this.playerIDs.length - 1;

        // prepare state for next turn
        this.currentPlayerNeedsToDraw = this.nextPlayerNeedsToDraw;
        this.nextPlayerNeedsToDraw = 0;
        this.cardsPlayedThisTurn = 0;
        this.playerDidSomethingThisTurn = false;
    }

    currentPlayerNoMoreOptions() {
        // end turn if no action can be done
        let canPlayAtLeastOneCard = false;
        for (const cardInHand of this.currentPlayer().cards) {
            if (this.cardsPlayedThisTurn == 0)
                canPlayAtLeastOneCard = canPlayAtLeastOneCard || cardsCompatible(this.lastPlayed, cardInHand);
            else
                canPlayAtLeastOneCard = canPlayAtLeastOneCard || cardsStrictlyCompatible(this.lastPlayed, cardInHand);
        }
        return !canPlayAtLeastOneCard && !this.currentPlayerNeedsToDraw && this.playerDidSomethingThisTurn;
    }

    currentPlayerPlaysCard(playedCard) {
        this.cardsPlayedThisTurn++;
        this.lastPlayed = playedCard;
        this.playedCardsCount++;
        this.playerDidSomethingThisTurn = true;

        if (this.currentPlayerNoMoreOptions())
            this.endTurn();
    }

    playTurn(player_id, turn) {
        // it's not ur turn u butt
        if (player_id !== this.idOfCurrentPlayer())
            return;

        // draw card(s)
        if (turn['type'] == 'd') {
            if (this.currentPlayerNeedsToDraw > 0) {
                this.currentPlayerDrawCards(this.currentPlayerNeedsToDraw);
                this.playerDidSomethingThisTurn = true;
                this.currentPlayerNeedsToDraw = 0;
            }
            else {
                if (this.cardsPlayedThisTurn == 0)
                    this.endTurn();
            }
        }

        // ! issues
        // * can still draw card after playing a card
        // * can't draw card after playing a card, but drawing still ends turn
        // turn should end when no action can be done
        // should be able to play card immediately after drawing if compatible
        // ? draws 1 extra when end turn, ok when from pile
        // draw cards dont stack
        // * can still play cards when have to draw -> they disappear

        // play card(s)
        else if (turn['type'] == 'p') {
            let cardToPlay = this.players.get(player_id).cards[turn['card']];

            let canPlayFirstCard =
                this.cardsPlayedThisTurn == 0
                && cardsCompatible(cardToPlay, this.lastPlayed)
                && this.currentPlayerNeedsToDraw == 0

            let canPlaySubsequentCard =
                this.cardsPlayedThisTurn >= 0
                && cardsStrictlyCompatible(cardToPlay, this.lastPlayed)
                && this.currentPlayerNeedsToDraw == 0

            if (canPlayFirstCard || canPlaySubsequentCard) {
                let playedCard = this.players.get(player_id).playCard(turn['card'], this);

                // player has to play a drawing card or draw some cards
                if (this.currentPlayerNeedsToDraw > 0) {
                    if (playedCard.number == '+') {
                        this.nextPlayerNeedsToDraw = this.currentPlayerNeedsToDraw + 2;
                        this.currentPlayerNeedsToDraw = 0;
                        this.currentPlayerPlaysCard(playedCard);
                    }
                    else if (playedCard.number == '#') {
                        this.nextPlayerNeedsToDraw = this.currentPlayerNeedsToDraw + 4;
                        this.currentPlayerNeedsToDraw = 0;
                        this.currentPlayerPlaysCard(playedCard);
                    }
                }

                // no special actions are active, player can play any card
                else {
                    // drawing cards
                    if (playedCard.number == '+') {
                        this.nextPlayerNeedsToDraw = this.currentPlayerNeedsToDraw + 2;
                        this.currentPlayerNeedsToDraw = 0;
                        this.currentPlayerPlaysCard(playedCard);
                    }
                    else if (playedCard.number == '#') {
                        this.nextPlayerNeedsToDraw = this.currentPlayerNeedsToDraw + 4;
                        this.currentPlayerNeedsToDraw = 0;
                        this.currentPlayerPlaysCard(playedCard);
                    }
                    // no special card
                    else {
                        this.currentPlayerPlaysCard(playedCard);
                    }
                }
            }
        }

        // end turn
        else if (turn['type'] == 'e') {
            this.endTurn();
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

    // player whose turn it is
    idOfCurrentPlayer() {
        return this.playerIDs[this.whoseTurn];
    }

    currentPlayer() {
        return this.players.get(this.playerIDs[this.whoseTurn]);
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

            sendStateAll(roomCode);

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
