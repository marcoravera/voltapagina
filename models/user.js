const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {type: String, required: true, unique: true},
    password: {type: String, required: true},
    nome: {type: String, required: true},
    cognome: {type: String, required: true},
    mail: {type: String, required: true},
    cellulare: {type: String, required: true},
    indirizzo: {type: String, required: true},
    citta: {type: String, required: true},
    cap: {type: String, required: true},
    nazione: {type: String, required: true},
    location: {
        type: {type: String, enum: ['Point'], default: 'Point'},
        coordinates: {type: [Number], required: true}
    }
});

UserSchema.index({ location: '2dsphere' });
module.exports = mongoose.model('user', UserSchema);