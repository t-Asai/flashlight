'use strict';

const firebase = require("firebase");
require('colors');

exports.init = function(databaseURL, serviceAccount) {
   var config = {
   };
};

exports.fbRef = function(path) {
  console.log('path?');
  console.log(path);
  console.log('tmp?');
  const tmp = firebase.firestore().collection('search_response').then((val) => {
    console.log(val)
  }).catch((val) => {
    console.log(val)
  });
  console.log(tmp);
  console.log('tmp?');
   return firebase.firestore().collection(path);
};

exports.pathName = function(ref) {
  return '本来ならpath名を返すところだけど、console.logでしか使ってないので後回し';
};

exports.isString = function(s) {
  return typeof s === 'string';
};

exports.isObject = function(o) {
  return o && typeof o === 'object';
};

exports.unwrapError = function(err) {
  if( err && typeof err === 'object' ) {
    return err.toString();
  }
  return err;
};

exports.isFunction = function(f) {
  return typeof f === 'function';
};
