let app = require('express')(); // Récuperation du module Express
let fs = require('fs');
// Création du serveur et du Socket
var port = process.env.port || 3001;
let http = require('http').Server(app);

let io = require('socket.io')(http);

var mysql = require('mysql'); // Création de la connexion à la BDD
var db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  database: 'sockchat'
});


var membres = []; // Tableau qui va contenir la liste des membres connectés

io.on('connection', (socket) => { // Création de l'écouteur et écriture des méthodes

  socket.on('connexion', (infos) => {
    db.query({
      sql: 'SELECT * FROM membres WHERE mail=?',
      values: [infos.mail]
    }, function (error, results) {
      if (error) {
        throw error;
      }
      if (results.length == 0) {
        io.sockets.connected[socket.id].emit('status-connexion', { status: false, error: "Utilisateur inexistant" });
      } else {
        if (infos.password == results[0].mdp) {
          if (results[0].status != 'online') {
            socket.nickname = results[0].pseudo;
            var q = "UPDATE membres SET status='online', socketId='" + socket.id + "' WHERE pseudo='" + socket.nickname + "';";
            db.query(q, function (error, results) {
              if (error) throw error;
              db.query({
                sql: "SELECT base64Image, mail FROM images, membres WHERE images.idImage=membres.avatar AND pseudo=?",
                values: [socket.nickname]
              }, function (error, results, fields) {
                socket.mail = results[0].mail;
                socket.image = results[0].base64Image;
                membres.push({ id: socket.id, pseudo: socket.nickname, image: results[0].base64Image, mail: results[0].mail }); // Ajout du membres dans la liste des utilisateurs connectés                 
                console.log(socket.nickname + " connecté à " + new Date());
                io.sockets.connected[socket.id].emit('status-connexion', { status: true, pseudo: socket.nickname }); // Emission du résultat uniquement au client concerné
                socket.broadcast.emit('user-connected', socket.nickname + ' s\'est connecté');
              });
            });
          } else {
            io.sockets.connected[socket.id].emit('status-connexion', {status: false, error: "L'utilisateur esr déjà connecté"});
          }
        } else {
          io.sockets.connected[socket.id].emit('status-connexion', { status: false, error: "Mot de passe incorrect" });
        }
      }
    });
  });

  socket.on('disconnect', function () { // Déconnexion d'un utilisateur
    db.query({
      sql: "UPDATE membres SET status='offline' WHERE pseudo=?",
      values: [socket.nickname]
    }, function (error, results, fields) {
      console.log(socket.nickname + " déconnecté à " + new Date());
      membres.splice(membres.indexOf({ id: socket.id, pseudo: socket.nickname }), 1);
    });
  });

  socket.on('inscription', (infos) => { // Inscription d'un utilisateur
    db.query({ // On vérifie que le mail n'est pas déja présent dans la BDD
      sql: 'SELECT * FROM membres WHERE mail=?', // Requete SQL
      values: [infos.mail] // Paramètres
    }, function (error, results, fields) {
      if (error) {
        throw error;
      }
      if (results.length > 0) { // Si un ligne est retourné, erreur car utilisateur déja existant
        io.sockets.connected[socket.id].emit('status-inscription', { status: false });
      } else { // Sinon, inscription de l'utilsiateur
        db.query({
          sql: 'INSERT INTO images SET ?',
          values: [{
            base64Image: infos.image
          }]
        }, (error, results, fields) => {
          if(error) {
            throw error;
          }
          if (results.length == 0) { 
            fs.readFile('base64Default.txt', 'utf-8', (err,data) => {
              if (err) throw err;
              infos.image = data;
            });
          }
          db.query({
            sql: 'SELECT idImage FROM images WHERE base64Image=?',
            values: [infos.image]
          }, function (error, results, fields) {
            if (error) throw error;
            db.query({
              sql: 'INSERT INTO membres SET ?',
              values: [{
                mail: infos.mail,
                avatar: results[0].idImage,
                pseudo: infos.pseudo,
                mdp: infos.mdp
              }]
            }, (error, results, fields) => {
              if (error) {
                throw error;
              }
              if (results.affectedRows > 0) {
                io.sockets.connected[socket.id].emit('status-inscription', { status: true });
              }
            });
          });
        });
        
      }
    });
  });

  socket.on('general-message', (data) => { // Réception d'un message
    db.query({
      sql: 'SELECT base64Image FROM images, membres WHERE images.idImage=membres.avatar AND pseudo=?',
      values: [socket.nickname]
    }, function(error,results, fields) {
      if (error) {
        throw error;
      }
      io.emit('g-message', { text: data, from: socket.nickname, type: 'text', avatar: results[0].base64Image, created: new Date() });
    });
  });

  socket.on("private-message", (data) => {
    db.query({
      sql: 'SELECT base64Image FROM images, membres WHERE images.idImage=membres.avatar AND pseudo=?',
      values: [socket.nickname]
    }, function(error,results, fields) {
      if (error) {
        throw error;
      }
      io.to(data.id).emit("p-message", { text: data.text, from: socket.nickname, type: 'text', avatar: results[0].base64Image, created: new Date() });
      io.to(socket.id).emit("p-message", { text: data.text, from: socket.nickname,type: 'text', avatar: results[0].base64Image, created: new Date() })    });
  });

  socket.on("add-image", (data) => {
    db.query({
      sql: 'SELECT base64Image FROM images, membres WHERE images.idImage=membres.avatar AND pseudo=?',
      values: [socket.nickname]
    }, function(error,results, fields) {
      if (error) {
        throw error;
      }
      io.emit("g-message", { image: data, from: socket.nickname, type: 'image', avatar: results[0].base64Image, created: new Date() });
    });
  });

  socket.on("add-pimage", (data) => {
    db.query({
      sql: 'SELECT base64Image FROM images, membres WHERE images.idImage=membres.avatar AND pseudo=?',
      values: [socket.nickname]
    }, function(error,results, fields) {
      if (error) {
        throw error;
      }
      io.emit("p-message", { image: data, from: socket.nickname, type: 'image', avatar: results[0].base64Image, created: new Date() });
    });
  });

  socket.on('start-typing', () => { // Un utilisateur est entrain d'écrire
    io.emit('typing', socket.nickname);
  });

  socket.on('stop-typing', () => { // L'utilisateur a arreté d'écrire
    io.emit('s-typing', socket.nickname);
  });

  socket.on('get-users', () => {
    io.emit('users', membres);
  });

  socket.on('get-contacts', () => {
    db.query({
      sql: "SELECT receiver FROM contacts WHERE sender=?",
      values: [socket.mail]
    }, function (error, results, fields) {
      if (error) throw error;
      for(var i = 0; i < results.length; i++) {
        var receiver = results[i].receiver;
        db.query({
          sql: "SELECT base64Image FROM images, membres WHERE images.idImage=membres.avatar AND mail=?",
          values: [results[i].receiver]
        }, function(error, results, fields){
          if (error) throw error;
          var image = results[0].base64Image;
          db.query({
            sql: "SELECT * FROM membres WHERE mail=?",
            values: [receiver]
          }, function (error, results, fields) {
            if (error) throw error;
          });
        });
      }
      io.emit('contacts', membres);
    });
  });

  socket.on('get-infos-contact', (data) => {
    db.query({
      sql: 'SELECT * FROM membres WHERE pseudo=?',
      values: [data.pseudo]
    }, function (error,results,fields) {
      if (error) {
        throw error;
      }
      io.emit('infos-contact', { status: results[0].status, resume: results[0].resume, dateInscr: results[0].date_inscription });
    });
  });

  socket.on('get-profile', (data) => {
    db.query({
      sql: "SELECT * FROM membres, images WHERE images.idImage=membres.avatar AND pseudo=?",
      values: [socket.nickname]
    }, function (error, results, fields) {
      if (error) throw error;
      io.emit('profile', { image: results[0].base64Image, status: results[0].status, resume: results[0].resume, dateInscr: results[0].date_inscription, mail: results[0].mail })
    })
  });

});

// Indication du port et lancement du serveur
http.listen(port, function () {
  console.log('listening in http://localhost:' + port);
});