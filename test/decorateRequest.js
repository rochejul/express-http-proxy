var assert = require('assert');
var express = require('express');
var request = require('supertest');
var proxy = require('../');

describe('decorateRequest', function() {
  'use strict';

  this.timeout(10000);

  var app;

  beforeEach(function() {
    app = express();
    app.use(proxy('httpbin.org'));
  });

  it('decorateRequest', function(done) {
    var app = express();
    app.use(proxy('httpbin.org', {
      decorateRequest: function(req) {
        req.path = '/ip';
        req.bodyContent = 'data';
      }
    }));

    request(app)
      .get('/user-agent')
      .end(function(err, res) {
        if (err) { return done(err); }
        assert(res.body.origin);
        done();
      });
  });

  it('test decorateRequest has access to calling ip', function(done) {
    var app = express();
    app.use(proxy('httpbin.org', {
      decorateRequest: function(reqOpts, req) {
        assert(req.ip);
        return reqOpts;
      }
    }));

    request(app)
      .get('/')
      .end(function(err) {
        if (err) { return done(err); }
        done();
      });

  });

  it('test decorateRequest can be a promise', function(done) {
    // working on this test
    var app = express();
    app.use(proxy('httpbin.org', {
      decorateRequest: function (reqOpts, req) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            reqOpts.decorated = true;
            resolve(reqOpts);
          }, 200);
        });
      }
    }));

    request(app)
      .get('/')
      .end(function(err, res) {
        debugger;
        if (err) { return done(err); }
        done();
      });

  });

});

