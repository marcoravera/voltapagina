const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
    tipo: {type: String, enum: ['scambio', 'consultazione'], required: true},
    stato: {type: String, enum: ['nuovo', 'accettato', 'rifiutato', 'annullato', 'scaduto'], default: 'nuovo'},
    richiedente: {type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true},
    destinatario: {type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true},
    libroDaDare: {type: mongoose.Schema.Types.ObjectId, ref: 'book'},
    libroDaRicevere: {type: mongoose.Schema.Types.ObjectId, ref: 'book', required: true},
    messaggio: {type: String, maxlength: 1500},
    dataInserimento: { type: Date, default: Date.now }
});

module.exports = mongoose.model('request', requestSchema);