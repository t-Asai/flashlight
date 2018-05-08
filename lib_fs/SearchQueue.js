const firebase = require("firebase");
require("firebase/firestore");
conf = require('../config');

var firebase_config = {
  apiKey: conf.apiKey,
  authDomain: conf.authDomain,
  databaseURL: conf.databaseURL,
  projectId: conf.projectId,
  storageBucket: conf.storageBucket,
  messagingSenderId: conf.messagingSenderId
};
firebase.initializeApp(firebase_config);

function SearchQueue(esc, reqRef, resRef, cleanupInterval) {
   this.esc = esc;
   this.inRef = reqRef;
   this.outRef = resRef;
   this.cleanupInterval = cleanupInterval;
   this.ref_req = firebase.firestore().collection('search_request');
   this.ref_res = firebase.firestore().collection('search_response');
   this.unsubscribe = null;
   this.unsubscribe = this.ref_req.onSnapshot(this._showResults.bind(this));
}

SearchQueue.prototype = {
  _showResults: function(snap) {
    snap.forEach((doc) => {
      console.log('doc')
      console.log(doc.data())
      const { from, index, q, size, type } = doc.data();
      const query = {
        from,
        index,
        q,
        size,
        type
      }

      this.esc.search(query, function(error, response) {
        console.log(doc.id)
        console.log(response)
        // 結果を受け取った時点でresponseをrequestを破棄してresponseに書き込みに行く
        this.ref_res.doc(doc.id).set(response);
        this.ref_req.doc(doc.id).delete();
      }.bind(this));
    })
  },

};

exports.init = function(esc, reqPath, resPath, matchWholeWords, cleanupInterval) {
   new SearchQueue(esc, reqPath, resPath, matchWholeWords, cleanupInterval);
};
