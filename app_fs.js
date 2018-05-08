const firebase = require("firebase");
require("firebase/firestore");

const elasticsearch = require('elasticsearch');
const conf = require('./config');

//////////////////////////////////////////////////
/*
* ElasticSearchの初期化
*/
const escOptions = {
  hosts: [{
    host: conf.ES_HOST,
    port: conf.ES_PORT,
    auth: (conf.ES_USER && conf.ES_PASS) ? conf.ES_USER + ':' + conf.ES_PASS : null
  }]
};

for (let attrname in conf.ES_OPTS) {
  if( conf.ES_OPTS.hasOwnProperty(attrname) ) {
    escOptions[attrname] = conf.ES_OPTS[attrname];
  }
}

//////////////////////////////////////////////////
/*
* ElasticSearchへの接続
*/
let esc = new elasticsearch.Client(escOptions);
console.log('Connecting to ElasticSearch host %s:%s'.grey, conf.ES_HOST, conf.ES_PORT);

let timeoutObj = setInterval(function() {
  esc.ping()
    .then(function() {
      console.log('Connected to ElasticSearch host %s:%s'.grey, conf.ES_HOST, conf.ES_PORT);
      clearInterval(timeoutObj);
      new SearchQueue(esc, conf.FB_REQ, conf.FB_RES, conf.CLEANUP_INTERVAL);
      new Registration(esc, conf.FB_REQ, conf.FB_RES, conf.CLEANUP_INTERVAL);
    });
}, 5000);

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

//////////////////////////////////////////////////
/*
* firebaseと接続し、subscribeの登録を行う
*/
function SearchQueue(esc, reqRef, resRef, cleanupInterval) {
  this.esc = esc;
  this.cleanupInterval = cleanupInterval;
  this.ref_req = firebase.firestore().collection('search_request');
  this.ref_res = firebase.firestore().collection('search_response');
  this.unsubscribe = null;
  this.unsubscribe = this.ref_req.onSnapshot(this._showResults.bind(this));
}

//////////////////////////////////////////////////
/*
* firebaseのデータに変更が加えられたときに、
* ElasticSearchへ検索を投げて、結果をfirebaseの方に返す
* 今は、requestにqueryに必要なデータをそのまま突っ込んでいるが、
* そのうち、ロジックをこっちに持ってくる
* 返却するときのデータ整形もあとで決める
*/
SearchQueue.prototype = {
  _showResults: function(snap) {
    snap.forEach((doc) => {
      const { from, index, q, size, type } = doc.data();
      const query = {
        from,
        index,
        q,
        size,
        type
      }

      this.esc.search(query, function(error, response) {
        if(error === undefined){
          let return_data = {}
          response.hits.hits.forEach(((data) => {
            return_data[data._id] = {
              id: data._id,
              source: data._source,
              score: data._score,
            }
          }))
          this.ref_res.doc(doc.id).set(return_data);
          this.ref_req.doc(doc.id).delete();
        }else{
          console.log('error in ElasticSearch search')
          // console.log(error)
        }
      }.bind(this));
    })
  },

};

//////////////////////////////////////////////////
/*
* firebaseのデータに変更が加えられたときに、
* ElasticSearchの方にデータを送るやつ
* 今は、全部更新するようにしているけど、
* 普通に考えるなら、フラグ管理orタイムスタンプで管理をすべきもの
* まだ色々確定していないので、未開発
*/
function Registration(esc, reqRef, resRef, cleanupInterval) {
  this.esc = esc;
  this.cleanupInterval = cleanupInterval;
  this.ref = firebase.firestore().collection('users');
  this.unsubscribe = null;
  this.unsubscribe = this.ref.onSnapshot(this._showResults.bind(this));
}

//////////////////////////////////////////////////
/*
*/
Registration.prototype = {
  _showResults: function(snap) {
    snap.forEach(async (doc) => {
      const send_data = {
        index: 'firebase_user',
        type: 'user',
        id: doc.id,
        body: {
          name: doc.data().name,
          doc: doc.data().doc,
        },
      }
      await this._delData(doc.id)  // 消し終わってから書き込みに行かないと、ElasticSearchの方で重複書き込みエラーになる
      this._sendData(send_data)
    })
  },

  _delData: function(id) {
    this.esc.delete({
      index: 'firebase_user',
      type: 'user',
      id: id,
    }, function (error, response) {
    });
  },

  _sendData: function(send_data) {
    this.esc.create(send_data, function (error, response) {
    }.bind(this));
  },

};
