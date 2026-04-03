const mongoose = require('mongoose');

const libroSchema = new mongoose.Schema({
    titolo: { type: String, required: true },
    autore: { type: String, required: true },
    categoria: { type: String },
    isbn: { type: String },
    annoEdizione: { type: Number, required: true },
    dataInserimento: { type: Date, default: Date.now },
    copertina: { type: String },
    visualizzazioni: { type: Number, default: 0},
    richieste: { type: Number, default: 0},
    proprietario: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'user',
        required: true 
    }
});

module.exports = mongoose.model('book', libroSchema);
