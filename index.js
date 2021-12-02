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
        console.log('dealing', count, 'cards')
        console.log(this.afk);
        this.cards.length = 0;

        for (let i = 0; i < count; i++) {
            this.cards[ i ] = new Card();
            this.cards[ i ].init_random();
        }
    }

    playCard(num, game) {
        console.log(this.cards);
        if (num < 0 || num >= this.cards.length) {
            throw 'Player.playCard received illegal argument num ' + num;
        }
        let removed = this.cards.splice(num, 1);
        if (this.cards.length == 0) {
            this.deal_random(8);
        }
        game.lastPlayed = removed[ 0 ];
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

    player_join(name, id) {
        let player = new Player();
        player.deal_random(this.starting_card_number);
        this.players.set(id, player);
    }
}

var games = new Map();
var checkGameValidityInterval = 1000;
var pruneInactiveGamesAfter = 15000;

// prune old inactive games
// TODO change to callback using setTimeout
setInterval(() => {
    console.log(games);

    games.forEach((game, key, map) => {
        if (game.getAge() > pruneInactiveGamesAfter && game.players.size == 0) {
            console.log("Pruning game", key);
            games.delete(key);
        }
    });
}, checkGameValidityInterval);

// var player = new Player();
// player.deal_random(8);


// setTimeout(player.deal_random.bind(player), 5000, 8);
// setInterval(() => console.log(player.cards.length), 1000);

function send_state(game, id) {
    console.log(game.lastPlayed);

    try {
        io.to(id).emit('receive_cards', {
            'cards': game.players.get(id).cards,
            'lastPlayed': game.lastPlayed
        });
    }
    catch (e) {
        console.log('Exception in send_state:\n', e);
        io.to(id).emit('receive_cards', {
            'cards': [],
            'lastPlayed': new Card()
        });
    }
}

io.on('connection', (socket) => {
    socket.on('click', (msg) => {
        id = msg[ 'id' ];
        console.log('id', id, 'clicked card', msg[ 'cardClicked' ]);
        try {
            game.players.get(id).playCard(msg[ 'cardClicked' ], game);

            game.players.forEach((value, key, map) => {
                send_state(game, key);
            });
        }
        catch (e) {
            console.log(e);
        }
    });

    socket.on('get_cards', (msg) => {
        id = msg;
        console.log('get_cards received from ' + id);
        send_state(game, id);
    });

    socket.on('join_game', (msg) => {
        roomCode = msg[ 'roomCode' ].toUpperCase();
        id = msg['id'];
        playerID = console.log(generatePlayerID());
        console.log(playerID + ' (session id=' + id + ') wants to join ' + roomCode);

        try {
            games.get(roomCode).player_join('noname', id);
            send_state(games.get(msg['roomCode']), id);
        }
        catch (e) {
            console.log(e);
        }
    });

    socket.on('isRoomcodeValid', (data, callback) => {
        let roomCode = data.toUpperCase();
        callback(games.has(roomCode));
    });

    socket.on('requestRoom', (data, callback) => {
        roomCode = generateRoomCode();
        games.set(roomCode, new Game());
        console.log(games);

        callback({
            'success': true,
            'roomCode': roomCode
        });
    });
});
