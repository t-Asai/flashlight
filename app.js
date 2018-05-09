/*
 * 元々のflashlightと差分を少なくするために
 * 引数とかなるべく変えずに行ってるが、
 * そろそろ整理しないと使ってないものが溢れてきている
*/

/*
 * 残タスク *
  * reactから渡されたデータに応じて、queryを作成する
  * configを書き直す
  * 引数を整理する
  * 関数ごとにファイル分割する
  * subscribeするcollectionを管理する(合わせて、張るインデクスとtypeも管理)
  * 消した例外処理の中から必要な分を復活させる
  * フラグ管理でelasticへの更新をかけに行くなら、firestoreのフラグ更新も必要になる
  * reactに返すデータの整形
  * firestoreでデータ削除が必要になったときの処理を決める
*/

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
 * firebaseのデータにqueryが登録されたときに
 * ElasticSearchへ検索を投げて、結果をfirebaseの方に返す
 * 今は、requestにqueryに必要なデータをそのまま突っ込んでいるが、
 * そのうち、ロジックをこっちに持ってくる
 * 返却するときのデータ整形もあとで決める
 * というか、ロジックはこっちに持ってこないと、アプリの変更ができないから
 * まともなサービス作る時にはこっちだな
 * react側からは、リストをくれってリクエストを飛ばすことだけにして
 * クエリを作るのはGAEで
 * 結果を返すのもGAE
 * renderingする時に整形する段階で再びreactに任せる
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

      /*
      * msearchとかいうものがある模様
      * 複数のindexに対して、複数の条件で調べることが出来るやつ
      * 現状、いる未来が見えないけど、覚えておこう
      * https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html#api-msearch
      * searchをelasticsearchに投げる時に、指定したindexが登録されてないとエラー吐くっぽい
      * ローカルで遊ぶ時に注意が必要だった
      */
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
 * subscribeするときのcollection名とindexのセットは別で持っておいて、
 * それを渡すことでうまい感じにごにょごにょしたい
*/
function Registration(esc, reqRef, resRef, cleanupInterval) {
  this.esc = esc;
  this.cleanupInterval = cleanupInterval;
  this.ref = firebase.firestore().collection('users').where("ES_STATE", "==", "STAY");;
  this.unsubscribe = null;
  this.unsubscribe = this.ref.onSnapshot(this._showResults.bind(this));
}

//////////////////////////////////////////////////

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
      /*
      * この段階でelasticsearchの方に更新をかけるかどうかを判断する
      * 基準は、フラグをfirestoreの方に用意しておく or データの更新日時
      * フラグ管理にすると、書き込み回数がどんどん増えるので微妙かもしれないが
      * データの更新日時だと、このやり方には向いてないかもしれない
      * 更新のトリガーを、firestoreの更新ではなく、cronにするべき
      * その場合の問題は、cronの設定と管理をどうするか and firestoreのupdatedAtの管理方法
      * firestoreのデータは残念ながら、docと同階層に保存されてるから、ちょっと面倒かもしれない
      * プロパティをかなり辿るといけた気もする。
      * batchで更新するなら一つずつ更新ではなく、bulkを使う
      * https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html#api-bulk
      * firestoreのsubscribeするときに、whereが使えるのであれば、
      * 更新時に書き換えの方が向いてるかもしれない
      * なぜなら、firestoreからgaeに渡すデータ量が減らせるから
      * timestampでwhereがかけたらそれでも良いのかもしれないが、難しい
      * フラグ管理にすると、書き込み待機状態から書き込んだ直後にも二回発火するかもしれない
      * 読み取り
      * subscribe=null
      * 書き込み
      * re subscribeで良いのか？？？
      * ちょっとローカルで試すか
      * -> キタコレ。フラグでsubscribeできる
      * ってことで、elasticsearchの検索対象になるデータが更新されたときに、statusをstayにして、
      * elasticsearchの方を更新できたらdoneにする運用で良いかもしれない
      * 
      * firestoreからデータが削除された時ってどうすれば良いんだろうか？
      * fieldが消えたくらいなら良いけど、doc自体が消えると不安
      */
      // await this._delData(doc.id)  // 消し終わってから書き込みに行かないと、ElasticSearchの方で重複書き込みエラーになる
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
    /*
    * this.esc.indexの方が良いかもしれない
    * これだと、add or updateだから、大丈夫そう
    * When you specify an id either a new document will be created, or an existing document will be updated. To enforce "put-if-absent" behavior set the opType to "create" or use the create() method.
    * https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html#api-index
    * https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html#api-indices-create
    */
    this.esc.index(send_data, function (error, response) {
      console.log('error in sending data to ElasticSearch')
      // console.log(error)
    }.bind(this));
  },

};
