const mongoose = require('mongoose');

const messaggioSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'request', index: true },
  partecipanti: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }], 
  mittenteId: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
  testo: { type: String, required: true },
  progressivo: { type: Number },
  dataInvio: { type: Date, default: Date.now }
});

module.exports = mongoose.model('message', messaggioSchema);