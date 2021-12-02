// Dependencies
var express = require('express');
var http = require('http');
var path = require('path');
var socketIO = require('socket.io');
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
    }

    playCard(num, game) {
        if (num < 0 || num >= this.cards.length) {
            throw 'Player.playCard received illegal argument num ' + num;
        }
        let removed = this.cards.splice(num, 1);
        if (this.cards.length == 0) {
            this.deal_random(8);
        }
        game.lastPlayed = removed[0];
        return removed;
    }
}

class Game {
    constructor() {
        this.players = new Map;
        this.starting_card_number = 8;

        this.lastPlayed = new Card();

        this.timeCreated = Date.now();      // in milliseconds
    }

    getAge() {
        return Date.now() - this.timeCreated;
    }

    player_join(name, player_id, session_id) {
        let player = new Player();
        player.player_id = player_id;
        player.session_id = session_id;
        player.deal_random(this.starting_card_number);
        this.players.set(player_id, player);
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
        if (game.getAge() > pruneInactiveGamesAfter && game.players.size == 0) {
            games.delete(key);
            console.log("Pruned room", key);
        }
    });
}, checkGameValidityInterval);

// var player = new Player();
// player.deal_random(8);


// setTimeout(player.deal_random.bind(player), 5000, 8);
// setInterval(() => console.log(player.cards.length), 1000);

function sendState(roomCode, player_id) {
    let game = games.get(roomCode);
    if (game !== undefined) {
        try {
            let player = games.get(roomCode).players.get(player_id);
            player.cards;
            // if neither of these threw an exception, player exists in the correct room
            console.log('sending state to', player_id, 'in room', roomCode, 'via session', player.session_id);

            io.to(player.session_id).emit('receive_cards', {
                'cards': player.cards,
                'lastPlayed': game.lastPlayed
            });
        }
        catch (e) {
            console.log('Exception in sendState():', e);
        }
    }

    // try {
    //     io.to(id).emit('receive_cards', {
    //         'cards': game.players.get(id).cards,
    //         'lastPlayed': game.lastPlayed
    //     });
    // }
    // catch (e) {
    //     console.log('Exception in sendState:\n', e);
    //     io.to(id).emit('receive_cards', {
    //         'cards': [],
    //         'lastPlayed': new Card()
    //     });
    // }
}

io.on('connection', (socket) => {
    socket.on('requestRoom', (data, callback) => {
        roomCode = generateRoomCode();
        games.set(roomCode, new Game());
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

    socket.on('requestJoin', (data, callback) => {
        roomCode = data['roomCode'].toUpperCase();
        session_id = data['session_id'];
        player_id = generatePlayerID();

        console.log(player_id + ' (session id=' + session_id + ') wants to join ' + roomCode);

        try {
            games.get(roomCode).player_join('noname', player_id, session_id);

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
        let cardClicked = data['cardClicked'];

        let game = games.get(roomCode);

        console.log(player_id, 'in room', roomCode, 'wants to click card', data['cardClicked']);

        try {
            game.players.get(player_id).playCard(data['cardClicked'], game);
            game.players.forEach((value, key, map) => {
                sendState(roomCode, key);
            });
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
                    console.log('Deleting player', game.players.get(key).player_id, 'from room', roomCode);
                    game.players.delete(key);
                }
            }

            sessionToRoom.delete(socket.id);
        }
        console.log('disconnected', socket.id);
    });
});
