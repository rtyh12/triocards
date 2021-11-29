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

// Starts the server.
server.listen(port, function () {
    console.log('Starting server on port ' + port);
});

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
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
        game.lastPlayed = removed[0];
        return removed;
    }
}

class Game {
    constructor() {
        this.player_count = 0;
        this.players = [];
        this.starting_card_number = 5;

        this.lastPlayed = new Card();
    }

    player_join() {
        let player = new Player();
        player.deal_random(this.starting_card_number);
        this.players.push(player);
    }
}

var player = new Player();
player.deal_random(8);

var game = new Game();

// setTimeout(player.deal_random.bind(player), 5000, 8);
// setInterval(() => console.log(player.cards.length), 1000);

function send_state(game, id) {
    console.log(game.lastPlayed);
    io.to(id).emit('receive_cards', {
        'cards': player.cards,
        'lastPlayed': game.lastPlayed
    });
}

io.on('connection', (socket) => {
    socket.on('click', (msg) => {
        console.log('id', msg['id'], 'clicked card', msg['cardClicked']);
        player.playCard(msg['cardClicked'], game);
        send_state(game, id);
    });

    socket.on('get_cards', (msg) => {
        id = msg;
        console.log('get_cards received from ' + id);
        send_state(game, id);
    });
});
