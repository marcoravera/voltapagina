const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const User = require('./models/user.js');
const Book = require('./models/book.js');
const Request = require('./models/request.js');
const Message = require('./models/message.js');
const multer = require('multer');
const nodeGeocoder = require('node-geocoder');
const geocoder = nodeGeocoder({provider: 'openstreetmap'});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'images');
  },
  filename: (req, file, cb) => {
    cb(null, 'libro-' + Date.now() + path.extname(file.originalname));
  }
});

// gli permetto solo di caricare immagini
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "image/png" || file.mimetype === "image/jpg" || file.mimetype === "image/jpeg") {
      cb(null, true);
    } else {
      cb(new Error("Solo immagini ammesse!"), false);
    }
  }
});

// importa tutte le variabili d'ambiente impostate nel file .env
require('dotenv').config();

// è stato necessario, sembra per un problema con il dns (senza non permette il raggiungimento del db su mongo DB atlas)
require('dns').setServers(['8.8.8.8', '1.1.1.1']);

const app = express();

app.use(express.json());
app.use('/images', express.static('images'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));
app.set('view engine', 'ejs');
// rendo pubblico il frontend per le pagine dinamiche (ejs)
app.set('views', path.join(__dirname, 'frontend'));
// rendo pubblico il frontend per le pagine statiche
app.use(express.static(path.join(__dirname, 'frontend')));
// rendo pubblico il frontend per le pagine dinamiche (ejs)
app.set('views', path.join(__dirname, 'frontend'));

mongoose.connect(process.env.DB_CONNECTION)
.then(() => {
    console.log("Connessione stabilita con successo!");
    console.log("Stai usando il database:", mongoose.connection.name);
})
.catch(err => {
    console.error("Errore durante la connessione:");
    console.error(err.message);
});

// faccio scadere le richieste ancora in stato nuovo, non gestite da 14 giorni
const puliziaRichiesteScadute = async () => {
    try {
        await Request.updateMany(
            {stato: 'nuovo', dataInserimento: {$lt: new Date(new Date() - (process.env.REQUEST_EXPIRATION_DAYS * 24 * 60 * 60 * 1000))}},
            {$set: {stato: 'scaduto'}}
        );
    } catch (err) {
        console.error('Errore durante la pulizia delle richieste');
    }
};
puliziaRichiesteScadute();

app.get('/dashboard', async (req, res) => {
    // in caso di login non ancora effettuata rimando alla login
    if(req.session.userId == null) { return res.redirect('/login') };
    res.render('dashboard');
});
app.get('/searchuser', async (req, res) => {
    // in caso di login non ancora effettuata rimando alla login
    if(req.session.userId == null){ return res.redirect('/login'); }
    // ricerco tutti gli utenti per visualizzarli nell'elenco
    const usersList = await User.find({_id : { "$ne": req.session.userId }});
    res.render('users_ele', { users: usersList });
});
app.post('/searchuser', async (req, res) => {
    // in caso di login non ancora effettuata rimando alla login
    if(req.session.userId == null){ return res.redirect('/login'); }

    const userLogged = await User.findOne({_id : req.session.userId});
    
    var ricerca = {_id : { "$ne": req.session.userId}};
    if(req.body.distanza){
        ricerca.location = {
            $near: {
                $geometry: {
                    type: "Point",
                    coordinates: [userLogged.location.coordinates[1], userLogged.location.coordinates[0]]
                },
                $maxDistance: parseInt(req.body.distanza) * 1000 // la ricerca funziona in metri
            }
        }
    }
    if(req.body.nomecognome){
        ricerca.$or = [
            {username: {$regex: req.body.nomecognome, $options: 'i'}},
            {nome: {$regex: req.body.nomecognome, $options: 'i'}},
            {cognome: {$regex: req.body.nomecognome, $options: 'i'}}
        ];
    }
    const searchLibri = await User.find(ricerca);
    res.render('users_ele', { users: searchLibri });
});
app.get('/searchbook', async (req, res) => {
    // in caso di login non ancora effettuata rimando alla login
    if(req.session.userId == null){ return res.redirect('/login'); }

    const userLogged = await User.findOne({_id : req.session.userId});
    // ricerco tutti gli utenti per visualizzarli nell'elenco
    const usersList = await User.find({_id: {$ne: req.session.userId}});
    const searchLibri = await User.aggregate([
        {
            $geoNear: {
                near: { type: "Point", coordinates: [userLogged.location.coordinates[0],userLogged.location.coordinates[1]] },
                distanceField: "distanza",
                spherical: true
            }
        },
        { $match: { _id: { $ne: userLogged._id } } },
        {
            $lookup: {
                from: "books",
                localField: "_id",
                foreignField: "proprietario",
                as: "info_libro"
            }
        },
        {$unwind: "$info_libro"}
    ]);
    res.render('books_ele', { users: usersList, books: searchLibri, userLogged: userLogged });
});
app.post('/searchbook', async (req, res) => {
    // in caso di login non ancora effettuata rimando alla login
    if(req.session.userId == null){ return res.redirect('/login'); }

    const userLogged = await User.findOne({_id : req.session.userId});

    var match = { "$expr": { "$eq": ["$proprietario", "$$id_utente"] }};
    // in caso di filtro sulla distanza aggiungo il filtro
    //if(req.body.distanza) match.distanza = { $lte: parseInt(req.body.distanza) * 1000 };
    if(req.body.titolo) match.titolo = { $regex: req.body.titolo, $options: "i" };
    if(req.body.autore) match.autore = { $regex: req.body.autore, $options: "i" };
    if(req.body.annoediz) match.annoedizione = { $eq: req.body.annoediz };
    if(req.body.categoria) match.categoria = { $eq: req.body.categoria };

    // nella ricerca estraggo anche il campo "distanza" che contiene la distanza dalla libreria dell'utente loggato
    var ricerca = [
        {
            $geoNear: {
                near: { type: "Point", coordinates: [userLogged.location.coordinates[0],userLogged.location.coordinates[1]] },
                distanceField: "distanza",
                spherical: true
            }
        }
    ];

    // new mongoose.Types.ObjectId è necessario per la ricerca 
    // perché mongoose farebbe una ricerca per "stringa id" == ObjectId('stringa id') non restituendo mai nulla
    var matchUser = {};
    if(req.body.proprietario) 
        matchUser._id = {$eq: new mongoose.Types.ObjectId(req.body.proprietario)};
    else
        matchUser._id = {$ne: userLogged._id};
    if(req.body.distanza) matchUser.distanza = { $lte: parseInt(req.body.distanza) * 1000 };
    
    if(Object.keys(matchUser).length !== 0){
        ricerca.push({$match: matchUser});
    }
    
    ricerca.push({
        $lookup: {
            from: "books",
            "let": { "id_utente": "$_id" },
            pipeline: [
                {$match: {$and: [match]}}
            ],
            as: "info_libro"
        }
    });
    ricerca.push({$unwind: "$info_libro"});

    const searchLibri = await User.aggregate(ricerca);
    const searchUtenti = await User.find({_id: {$ne: req.session.userId}});
    res.render('books_ele', { users: searchUtenti, books: searchLibri, userLogged: userLogged});
});
app.get('/api/getmybooks/:id', async (req, res) => {
    // in fase di scambio recupero i libri dell'utente loggato e gli passo anche l'id del libro selezionato
    const searchLibri = await Book.find({proprietario: req.session.userId});
    res.json({libri: searchLibri, selectedBook: req.params.id});
});
app.get('/api/userbooks/:id', async (req, res) => {
    // in base al click sull'utente recupero i libri di quell'utente
    const searchLibri = await Book.find({proprietario: req.params.id});
    res.json(searchLibri);
});
app.get('/mylibrary', async (req, res) => {
    if(req.session.userId == null) { return res.redirect('/login'); }
    const searchLibri = await Book.find({proprietario: req.session.userId});
    res.render('mylibrary', { books: searchLibri });
});
app.post('/mylibrary', async (req, res) => {
    if(req.session.userId == null) { return res.redirect('/login'); }
    
    var searchLibri = [];
    var ricerca = {proprietario: req.session.userId};
    if(req.body.categoria) ricerca.categoria = req.body.categoria;
    if(req.body.annoediz) ricerca.annoEdizione = parseInt(req.body.annoediz);
    if(req.body.titoloautore){
        ricerca.$or = [{
            titolo: {$regex: req.body.titoloautore, $options: 'i'}
        },
        {
            autore: {$regex: req.body.titoloautore, $options: 'i'}
        }];
    }
    searchLibri = await Book.find(ricerca);
    res.render('mylibrary', { books: searchLibri });
});
app.get('/', (req, res) => {
    res.redirect('/login');
});
app.get('/login', (req, res) => {
    if(req.session.userId != null) { res.redirect('/dashboard'); }
    res.render('login');
});
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) { return console.log(err); }
        res.redirect('/login'); 
    });
});
app.get('/signin', (req, res) => {
    res.render('signin');
});
app.post('/accedi', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    
    // verifico le credenziali inserite
    if (user && await bcrypt.compare(password, user.password)) {
        // salvo l'id dello user nella sessione (se non presente non ho ancora effettuato la login)
        req.session.userId = user._id;
        res.redirect('/dashboard');
    } else {
        res.redirect('/login?error=auth_failed');
    }
});
app.post('/registrati', async (req, res) => {
    try {
        const { username, password, confpassword, nome, cognome, mail, cellulare, indirizzo, citta, cap, nazione } = req.body;
        const utenteEsistente = await User.findOne({ username: username });
        // se esiste già un utente con quel username allora do errore
        if (utenteEsistente) { return res.redirect('/signin?error=exists'); }
        // se la password non coincide con il conferma password allora do errore
        if (password != confpassword) { return res.redirect('/signin?error=pwd'); }

        // salvo la password inserita ma criptata (il 10 rappresenta il livello di hashing utilizzato)
        const passwordCriptata = await bcrypt.hash(password, 10);

        // recupero le coordinate in base a indirizzo, città e nazione
        const resGeocode = await geocoder.geocode(indirizzo + "," + cap + " " + citta + "," + nazione);
        var coords = [0, 0];
        if (resGeocode.length > 0) {
            coords = [resGeocode[0].latitude, resGeocode[0].longitude];
        }
        // creazione nuovo utente
        const nuovoUtente = new User({
            username: username,
            password: passwordCriptata,
            nome: nome,
            cognome: cognome,
            mail: mail, 
            cellulare: cellulare,
            indirizzo: indirizzo,
            citta: citta,
            cap: cap,
            nazione: nazione,
            location: {type: 'Point', coordinates: coords}
        });

        await nuovoUtente.save();
        // faccio visualizzare il messaggio di corretta registrazione
        res.redirect('/login?error=signinok');
    } catch (error) {
        console.error(error);
        res.redirect('/login?error=ko');
    }
});

app.get('/insertbook', async (req, res) => {
    if(req.session.userId == null) { return res.redirect('/login'); }
    res.render('insertbook');
});
app.post('/caricalibro', upload.single('copertina'), async (req, res) => {
    if(req.session.userId == null) { return res.redirect('/login'); }

    // se è già presente l'isbn allora blocco l'inserimento
    const isbn = await Book.findOne({ isbn: req.body.isbn, proprietario: req.session.userId });
    if(isbn){
        return res.redirect('/insertbook?error=exists');
    } else {
        try {
            var copertina = 'images/default.png';
            if(req.file) copertina = req.file.path
            // inserimento nuovo libro
            const nuovoLibro = new Book({
                titolo: req.body.titolo,
                autore: req.body.autore,
                categoria: req.body.categoria,
                isbn: req.body.isbn,
                annoEdizione: req.body.annoedizione,
                copertina: copertina,
                proprietario: req.session.userId
            });

            await nuovoLibro.save();
            return res.redirect('/mylibrary?error=ok');
        } catch (error) {
            console.log(error);
        }
    }
});

// da mylibrary: mi permette di cancellare un libro selezionato
app.get('/cancellalibro/:id', async (req, res) => {
    try {
        const libro = await Book.findById(req.params.id);
        if (libro && libro.urlCopertina) {
            const fs = require('fs');
            const path = './images/' + libro.copertina;
            if (fs.existsSync(path)) fs.unlinkSync(path);
        }

        await Book.findByIdAndDelete(req.params.id);

        res.redirect('/mylibrary');
    } catch (err) {
        console.log(err);
    }
});

// visualizzo la mappa
app.get('/map', async (req, res) => {
    if(req.session.userId == null) { return res.redirect('/login'); }
    const usersList = await User.find();
    const userLogged = await User.findOne({_id : req.session.userId});
    res.render('map', { users: usersList, userLogged : userLogged, search : []});
});

// visualizzo la mappa visualizzando il punto ricercato dall'utente
app.post('/searchmap', async (req, res) => {
    if(req.session.userId == null) { return res.redirect('/login'); }
    const usersList = await User.find();
    const userLogged = await User.findOne({_id : req.session.userId});
    // mando alla geocode direttamente quello che ha inserito l'utente
    const resGeocode = await geocoder.geocode(req.body.via);
    var coords = [0, 0];
    //v se ha trovato l'indirizzo mando le coordinate alla pagina ejs che visualizzerà il punto
    if (resGeocode.length > 0) {
        coords = [resGeocode[0].latitude, resGeocode[0].longitude];
    }
    res.render('map', { users: usersList, userLogged : userLogged, search : coords});
});

// creo lo scambio
app.post('/api/scambia', async (req, res) => {
    try {
        const { idLibroOfferto, idLibroDesiderato, messaggio } = req.body;

        // recupero le info del libro offerto
        const libroOfferto = await Book.findById(idLibroOfferto);
        
        // recupero le info del libro desiderato
        const libroDesiderato = await Book.findById(idLibroDesiderato);

        // verifico se l'utente ha richiesto un'altra richiesta per lo stesso libro
        const existsRequest = await Request.find({
            richiedente: req.session.userId,
            libroDaRicevere: libroDesiderato,
            stato: 'nuovo'
        });

        if (existsRequest && existsRequest.length > 0) {
            return res.json({msg: 'exists'});
        }

        // creo la struttura dello scambio
        const nuovoScambio = new Request({
            tipo: 'scambio',
            richiedente: libroOfferto.proprietario,
            destinatario: libroDesiderato.proprietario,
            libroDaDare: idLibroOfferto,
            libroDaRicevere: idLibroDesiderato,
            messaggio: messaggio || "Vorrei effettuare uno scambio con il tuo libro!"
        });
        await nuovoScambio.save();

        const inizioChat = new Message({
            chatId: nuovoScambio._id,
            partecipanti: [libroOfferto.proprietario, libroDesiderato.proprietario],
            mittenteId: libroOfferto.proprietario,
            testo: messaggio || "Vorrei effettuare uno scambio con il tuo libro!",
            progressivo: 1
        });
        await inizioChat.save();

        res.json({msg: 'scambiook'});
    } catch (error) {
        console.log(error);
        res.json({msg: 'ko'});
    }
});

app.get('/richieste', async (req, res) => {
    if(req.session.userId == null) { return res.redirect('/login'); }
    const searchRichieste = await Request.find({destinatario: req.session.userId, tipo: "scambio"})
        .populate('libroDaDare')
        .populate('libroDaRicevere')
        .populate('richiedente')
        .exec();
    const searchRichiesteSent = await Request.find({richiedente: req.session.userId, tipo: "scambio"})
        .populate('libroDaDare')
        .populate('libroDaRicevere')
        .populate('destinatario')
        .exec();
    res.render('richieste_ele', {requests: searchRichieste, reqsent: searchRichiesteSent, tipo: "scambio"});
});

app.get('/consultazioni', async (req, res) => {
    if(req.session.userId == null) { return res.redirect('/login'); }
    const searchRichieste = await Request.find({destinatario: req.session.userId, tipo: "consultazione"})
        .populate('libroDaDare')
        .populate('libroDaRicevere')
        .populate('richiedente')
        .exec();
    const searchRichiesteSent = await Request.find({richiedente: req.session.userId, tipo: "consultazione"})
        .populate('libroDaDare')
        .populate('libroDaRicevere')
        .populate('destinatario')
        .exec();
    res.render('richieste_ele', {requests: searchRichieste, reqsent: searchRichiesteSent, tipo: "consultazione"});
});

app.post('/accept/:id', async (req, res) => {
    try {
        await Request.findByIdAndUpdate(req.params.id, { stato: 'accettato' });
    } catch (err) {
        console.error(err);
        return res.redirect('/richieste?newstate=ko');
    }

    const richiesta = await Request.find({_id: new mongoose.Types.ObjectId(req.params.id)});
    if(richiesta[0].tipo == "scambio"){
        return res.redirect('/richieste?newstate=accettato');
    } else {
        return res.redirect('/consultazioni?newstate=accettato');
    }
});

app.post('/refuse/:id', async (req, res) => {
    try {
        await Request.findByIdAndUpdate(req.params.id, { stato: 'rifiutato' });
    } catch (err) {
        console.error(err);
        return res.redirect('/richieste?newstate=ko');
    }
    const richiesta = await Request.find({_id: new mongoose.Types.ObjectId(req.params.id)});
    if(richiesta[0].tipo == "scambio"){
        return res.redirect('/richieste?newstate=rifiutato');
    } else {
        return res.redirect('/consultazioni?newstate=rifiutato');
    }
});

app.post('/cancel/:id', async (req, res) => {
    try {
        await Request.findByIdAndUpdate(req.params.id, { stato: 'annullato' });
    } catch (err) {
        console.error(err);
        return res.redirect('/richieste?newstate=ko');
    }
    const richiesta = await Request.find({_id: new mongoose.Types.ObjectId(req.params.id)});
    if(richiesta[0].tipo == "scambio"){
        return res.redirect('/richieste?newstate=annullato');
    } else {
        return res.redirect('/consultazioni?newstate=annullato');
    }
});

app.post('/creaconsultazione/:id', async (req, res) => {
    try {
        // recupero le info del libro desiderato
        const libroDesiderato = await Book.findById(req.params.id);

        // verifico se l'utente ha richiesto un'altra richiesta per lo stesso libro
        const existsRequest = await Request.find({
            stato: 'nuovo',
            richiedente: req.session.userId,
            libroDaRicevere: req.params.id
        });

        if (existsRequest && existsRequest.length > 0) {
            return res.redirect('/searchbook?error=existscons');
        }

        // creo la struttura dello scambio
        const nuovaConsultazione = new Request({
            tipo: 'consultazione',
            richiedente: req.session.userId,
            destinatario: libroDesiderato.proprietario,
            libroDaRicevere: req.params.id,
            messaggio: req.body.messaggio || "Vorrei consultare questo libro"
        });
        await nuovaConsultazione.save();

        const inizioChat = new Message({
            chatId: nuovaConsultazione._id,
            partecipanti: [req.session.userId, libroDesiderato.proprietario],
            mittenteId: req.session.userId,
            testo: req.body.messaggio || "Vorrei consultare questo libro",
            progressivo: 1
        });
        await inizioChat.save();

        return res.redirect('/searchbook?error=consok');
    } catch (error) {
        console.log(error);
        return res.redirect('/searchbook?error=ko');
    }
});

app.get('/chat/:richiestaId', async (req, res) => {
  try {
    // in caso di login non ancora effettuata rimando alla login
    if(req.session.userId == null) { return res.redirect('/login') };

    // recupero i messaggi della richiesta
    const messaggi = await Message.find({chatId: req.params.richiestaId}).sort({ dataInvio: 1 });

    // recupero i dettagli della richiesta
    const richiesta = await Request.findById(req.params.richiestaId).populate('libroDaRicevere').populate('libroDaDare');

    // se l'utente loggato non fa parte della chat lo blocco e gli mostro il messaggio riportandolo alla dashboard
    const isPartecipant = await Message.find({
        chatId: req.params.richiestaId,
        partecipanti: req.session.userId
    });
    if (!isPartecipant || isPartecipant.length == 0) {
      return res.redirect('/dashboard?error=errchat');
    }

    // carico la chat
    res.render('chat', { messaggi, richiesta, utenteLoggato: req.session.userId, tipo: richiesta.tipo });
  } catch (error) {
    console.log(error);
    return res.redirect('/richieste?error=chaterr');
  }
});

app.post('/chat/:richiestaId/invia', async (req, res) => {
  try {
    const messaggi = await Message.find({chatId: req.params.richiestaId}).sort({ progressivo: -1 });

    const inviaMess = new Message({
        chatId: req.params.richiestaId,
        partecipanti: messaggi[0].partecipanti,
        mittenteId: req.session.userId,
        testo: req.body.messaggio,
        progressivo: messaggi[0].progressivo + 1
    });
    await inviaMess.save();

    // una volta inviato il messaggio, ricarico la chat
    return res.redirect('/chat/' + req.params.richiestaId);
  } catch (error) {
    console.log(error);
    return res.redirect('/chat/' + req.params.richiestaId);
  }
});

app.post('/visualizza/:id', async (req, res) => {
    try {
        await Book.findByIdAndUpdate(
            req.params.id,
            { $inc: { visualizzazioni: 1 } }
        );
    } catch (err) {
        console.log(err);
    }
});

app.post('/richiedi/:id', async (req, res) => {
    try {
        await Book.findByIdAndUpdate(
            req.params.id,
            { $inc: { richieste: 1 } }
        );
    } catch (err) {
        console.log(err);
    }
});

// rendo il server raggiungibile sulla porta 8499
app.listen(8499, () => {
    console.log('In ascolto sulla porta 8499');
});
