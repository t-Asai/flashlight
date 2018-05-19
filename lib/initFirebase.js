const conf = require('../config');
const firebase = require('firebase');

//////////////////////////////////////////////////
/*
 * firebaseと接続し、データの受け渡しを行う
 * ために、まずはfirebaseのsdkを初期化する
*/

const firebase_config = {
    apiKey: conf.apiKey,
    authDomain: conf.authDomain,
    databaseURL: conf.databaseURL,
    projectId: conf.projectId,
    storageBucket: conf.storageBucket,
    messagingSenderId: conf.messagingSenderId
};
firebase.initializeApp(firebase_config);